import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getTenantDb } from '../../shared/context.js';
import { NotFoundError } from '../../shared/errors.js';
import { cuidSchema, idParamSchema } from '../../shared/schemas.js';

const listCreativesQuerySchema = z.object({
  briefingId: cuidSchema.optional(),
  status: z.enum(['PENDING', 'COPY_READY', 'RENDERING', 'RENDERED', 'FAILED']).optional(),
});

export function registerCreativeRoutes(app: FastifyInstance): void {
  app.get('/creatives', async (request) => {
    const query = listCreativesQuerySchema.parse(request.query);
    const items = await getTenantDb(request).creative.findMany({
      where: {
        ...(query.briefingId ? { briefingId: query.briefingId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: [{ briefingId: 'asc' }, { variationIndex: 'asc' }],
      include: { approval: true },
    });
    return { items };
  });

  app.get('/creatives/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const creative = await getTenantDb(request).creative.findFirst({
      where: { id },
      include: { approval: true, template: true },
    });
    if (!creative) throw new NotFoundError('Criativo');
    return creative;
  });
}
