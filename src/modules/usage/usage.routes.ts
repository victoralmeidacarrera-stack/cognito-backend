import { type FastifyInstance } from 'fastify';
import { getCtx } from '../../shared/context.js';
import { getQuotaSnapshot } from './usage.service.js';

export function registerUsageRoutes(app: FastifyInstance): void {
  // Quota atual da org (consumo do mês + limites do plano).
  app.get('/usage/quota', async (request) => {
    const ctx = getCtx(request);
    return getQuotaSnapshot(ctx.organizationId);
  });
}
