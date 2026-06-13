import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getCtx, getTenantDb } from '../../shared/context.js';
import { idParamSchema } from '../../shared/schemas.js';
import { decideApproval } from './approvals.service.js';

const decisionSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().max(1000).optional(),
});

const TAGS = ['Aprovações'];

export function registerApprovalRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Self-service: o cliente aprova/rejeita o próprio criativo.
  r.post(
    '/creatives/:id/decision',
    {
      schema: {
        params: idParamSchema,
        body: decisionSchema,
        tags: TAGS,
        summary: 'Aprova ou rejeita um criativo',
      },
    },
    async (request) =>
      decideApproval(getTenantDb(request), getCtx(request), {
        creativeId: request.params.id,
        status: request.body.status,
        note: request.body.note,
      }),
  );

  r.get('/approvals', { schema: { tags: TAGS, summary: 'Lista aprovações' } }, async (request) => {
    const items = await getTenantDb(request).approval.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { creative: { select: { id: true, variationIndex: true, imageUrl: true } } },
    });
    return { items };
  });
}
