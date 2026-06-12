import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getTenantDb } from '../../shared/context.js';
import { NotFoundError } from '../../shared/errors.js';
import { idParamSchema } from '../../shared/schemas.js';

const listTemplatesQuerySchema = z.object({
  format: z.enum(['FEED', 'STORIES']).optional(),
  activeOnly: z.coerce.boolean().optional(),
});

export function registerTemplateRoutes(app: FastifyInstance): void {
  app.get('/templates', async (request) => {
    const query = listTemplatesQuerySchema.parse(request.query);
    const items = await getTenantDb(request).template.findMany({
      where: {
        ...(query.format ? { format: query.format } : {}),
        ...(query.activeOnly ? { isActive: true } : {}),
      },
      orderBy: [{ format: 'asc' }, { name: 'asc' }],
    });
    return { items };
  });

  app.get('/templates/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const template = await getTenantDb(request).template.findFirst({ where: { id } });
    if (!template) throw new NotFoundError('Template');
    return template;
  });
}
