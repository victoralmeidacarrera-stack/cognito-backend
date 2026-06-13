import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { prisma } from '../../config/prisma.js';
import { getCtx, getTenantDb } from '../../shared/context.js';
import { getQuotaSnapshot } from '../usage/usage.service.js';

export function registerMeRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Bootstrap do frontend: quem sou eu, minha org e minha quota.
  r.get(
    '/me',
    { schema: { tags: ['Auth'], summary: 'Usuário, organização e quota atuais' } },
    async (request) => {
      const ctx = getCtx(request);
      const [user, organization, quota] = await Promise.all([
        getTenantDb(request).user.findFirst({
          where: { id: ctx.userId },
          select: { id: true, email: true, name: true, role: true },
        }),
        prisma.organization.findUnique({
          where: { id: ctx.organizationId },
          select: { id: true, name: true, slug: true, plan: true },
        }),
        getQuotaSnapshot(ctx.organizationId),
      ]);
      return { user, organization, quota };
    },
  );
}
