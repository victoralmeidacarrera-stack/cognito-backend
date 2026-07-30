import { UserRole } from '@prisma/client';
import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { syncOrganizationTemplates } from '../render/template-catalog.js';
import { getCtx, getTenantDb } from '../../shared/context.js';
import { ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { idParamSchema } from '../../shared/schemas.js';

const listTemplatesQuerySchema = z.object({
  format: z.enum(['FEED', 'STORIES']).optional(),
  activeOnly: z.coerce.boolean().optional(),
});

const TAGS = ['Templates'];

export function registerTemplateRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/templates',
    { schema: { querystring: listTemplatesQuerySchema, tags: TAGS, summary: 'Lista templates' } },
    async (request) => {
      const { format, activeOnly } = request.query;
      const items = await getTenantDb(request).template.findMany({
        where: {
          ...(format ? { format } : {}),
          ...(activeOnly ? { isActive: true } : {}),
        },
        orderBy: [{ format: 'asc' }, { name: 'asc' }],
      });
      return { items };
    },
  );

  r.post(
    '/templates/sync',
    {
      schema: {
        response: {
          200: z.object({ created: z.number(), updated: z.number(), total: z.number() }),
        },
        tags: TAGS,
        summary: 'Provisiona os templates do catálogo nesta organização',
        description:
          'Idempotente. Cria as peças que faltam e atualiza nome/dimensões das existentes, ' +
          'sem alterar o `isActive` — templates desativados pela loja continuam desativados. ' +
          'Usado no onboarding e quando o catálogo ganha peças novas.',
      },
    },
    async (request) => {
      const ctx = getCtx(request);
      if (ctx.role === UserRole.MEMBER) {
        throw new ForbiddenError('Só OWNER ou ADMIN pode sincronizar templates.');
      }
      // PrismaClient global com organizationId explícito: o sync roda em
      // contexto administrativo e precisa criar linhas para a org do ctx.
      return syncOrganizationTemplates(prisma, ctx.organizationId);
    },
  );

  r.get(
    '/templates/:id',
    { schema: { params: idParamSchema, tags: TAGS, summary: 'Detalha template' } },
    async (request) => {
      const template = await getTenantDb(request).template.findFirst({
        where: { id: request.params.id },
      });
      if (!template) throw new NotFoundError('Template');
      return template;
    },
  );
}
