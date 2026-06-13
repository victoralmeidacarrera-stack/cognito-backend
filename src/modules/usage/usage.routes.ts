import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { getCtx } from '../../shared/context.js';
import { getQuotaSnapshot } from './usage.service.js';

export function registerUsageRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Quota atual da org (consumo do mês + limites do plano).
  r.get(
    '/usage/quota',
    { schema: { tags: ['Uso'], summary: 'Consumo do mês e limites do plano' } },
    async (request) => getQuotaSnapshot(getCtx(request).organizationId),
  );
}
