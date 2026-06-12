import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getCtx, getTenantDb } from '../../shared/context.js';
import { idParamSchema } from '../../shared/schemas.js';
import { decideApproval } from './approvals.service.js';

const decisionSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().max(1000).optional(),
});

export function registerApprovalRoutes(app: FastifyInstance): void {
  // Self-service: o cliente aprova/rejeita o próprio criativo.
  app.post('/creatives/:id/decision', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = decisionSchema.parse(request.body);
    return decideApproval(getTenantDb(request), getCtx(request), {
      creativeId: id,
      status: body.status,
      note: body.note,
    });
  });

  app.get('/approvals', async (request) => {
    const items = await getTenantDb(request).approval.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { creative: { select: { id: true, variationIndex: true, imageUrl: true } } },
    });
    return { items };
  });
}
