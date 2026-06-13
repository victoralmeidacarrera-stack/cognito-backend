import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getTenantDb } from '../../shared/context.js';
import { NotFoundError } from '../../shared/errors.js';
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
