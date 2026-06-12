import { UserRole } from '@prisma/client';
import { type FastifyInstance } from 'fastify';
import { Webhook } from 'svix';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { slugify } from '../../shared/utils.js';

const orgCreatedSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string().optional(),
});

const membershipSchema = z.object({
  organization: z.object({ id: z.string(), name: z.string(), slug: z.string().optional() }),
  public_user_data: z.object({
    user_id: z.string(),
    identifier: z.string().email().optional(),
    first_name: z.string().nullish(),
    last_name: z.string().nullish(),
  }),
  role: z.string(),
});

const eventSchema = z.object({
  type: z.string(),
  data: z.record(z.unknown()),
});

function mapRole(clerkRole: string): UserRole {
  return clerkRole.includes('admin') ? UserRole.ADMIN : UserRole.MEMBER;
}

async function ensureOrganization(input: {
  clerkOrgId: string;
  name: string;
  slug?: string | undefined;
}): Promise<string> {
  const slug = input.slug ?? slugify(input.name);
  const org = await prisma.organization.upsert({
    where: { clerkOrgId: input.clerkOrgId },
    update: { name: input.name },
    create: { clerkOrgId: input.clerkOrgId, name: input.name, slug },
  });
  return org.id;
}

/**
 * Webhook do Clerk. Usa um parser de body cru (string) para que a assinatura
 * svix possa ser verificada antes de qualquer parse.
 */
export function registerClerkWebhook(app: FastifyInstance): void {
  app.register((instance, _opts, done) => {
    instance.removeContentTypeParser('application/json');
    instance.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, onDone) =>
      onDone(null, body),
    );

    instance.post('/webhooks/clerk', async (request, reply) => {
      if (!env.CLERK_WEBHOOK_SIGNING_SECRET) {
        return reply
          .status(503)
          .send({ error: { code: 'INTERNAL', message: 'Webhook não configurado.' } });
      }

      const payload = typeof request.body === 'string' ? request.body : '';
      const headers = {
        'svix-id': String(request.headers['svix-id'] ?? ''),
        'svix-timestamp': String(request.headers['svix-timestamp'] ?? ''),
        'svix-signature': String(request.headers['svix-signature'] ?? ''),
      };

      let verified: unknown;
      try {
        verified = new Webhook(env.CLERK_WEBHOOK_SIGNING_SECRET).verify(payload, headers);
      } catch {
        return reply
          .status(400)
          .send({ error: { code: 'UNAUTHORIZED', message: 'Assinatura inválida.' } });
      }

      const event = eventSchema.parse(verified);

      switch (event.type) {
        case 'organization.created':
        case 'organization.updated': {
          const data = orgCreatedSchema.parse(event.data);
          await ensureOrganization({ clerkOrgId: data.id, name: data.name, slug: data.slug });
          break;
        }
        case 'organizationMembership.created':
        case 'organizationMembership.updated': {
          const data = membershipSchema.parse(event.data);
          const organizationId = await ensureOrganization({
            clerkOrgId: data.organization.id,
            name: data.organization.name,
            slug: data.organization.slug,
          });
          const name = [data.public_user_data.first_name, data.public_user_data.last_name]
            .filter(Boolean)
            .join(' ')
            .trim();
          await prisma.user.upsert({
            where: { clerkUserId: data.public_user_data.user_id },
            update: { role: mapRole(data.role), ...(name ? { name } : {}) },
            create: {
              clerkUserId: data.public_user_data.user_id,
              organizationId,
              email:
                data.public_user_data.identifier ?? `${data.public_user_data.user_id}@clerk.local`,
              ...(name ? { name } : {}),
              role: mapRole(data.role),
            },
          });
          break;
        }
        default:
          logger.debug({ type: event.type }, 'clerk webhook ignorado');
      }

      return reply.status(200).send({ received: true });
    });

    done();
  });
}
