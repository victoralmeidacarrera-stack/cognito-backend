import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getTenantDb } from '../../shared/context.js';
import { NotFoundError } from '../../shared/errors.js';
import { cuidSchema, idParamSchema } from '../../shared/schemas.js';

const listCreativesQuerySchema = z.object({
  briefingId: cuidSchema.optional(),
  status: z.enum(['PENDING', 'COPY_READY', 'RENDERING', 'RENDERED', 'FAILED']).optional(),
});

const TAGS = ['Criativos'];

export function registerCreativeRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/creatives',
    { schema: { querystring: listCreativesQuerySchema, tags: TAGS, summary: 'Lista criativos' } },
    async (request) => {
      const { briefingId, status } = request.query;
      const items = await getTenantDb(request).creative.findMany({
        where: {
          ...(briefingId ? { briefingId } : {}),
          ...(status ? { status } : {}),
        },
        orderBy: [{ briefingId: 'asc' }, { variationIndex: 'asc' }],
        include: { approval: true },
      });
      return { items };
    },
  );

  r.get(
    '/creatives/:id',
    { schema: { params: idParamSchema, tags: TAGS, summary: 'Detalha criativo' } },
    async (request) => {
      const creative = await getTenantDb(request).creative.findFirst({
        where: { id: request.params.id },
        include: { approval: true, template: true },
      });
      if (!creative) throw new NotFoundError('Criativo');
      return creative;
    },
  );
}
