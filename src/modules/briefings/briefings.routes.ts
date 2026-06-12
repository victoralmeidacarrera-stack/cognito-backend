import { type FastifyInstance } from 'fastify';
import { getCtx, getTenantDb } from '../../shared/context.js';
import { idParamSchema } from '../../shared/schemas.js';
import {
  createBriefing,
  generateBriefing,
  getBriefing,
  listBriefings,
} from './briefings.service.js';
import { createBriefingSchema, listBriefingsQuerySchema } from './briefings.schemas.js';

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function registerBriefingRoutes(app: FastifyInstance): void {
  app.post('/briefings', async (request, reply) => {
    const input = createBriefingSchema.parse(request.body);
    const briefing = await createBriefing(getTenantDb(request), input);
    return reply.status(201).send(briefing);
  });

  app.get('/briefings', async (request) => {
    const query = listBriefingsQuerySchema.parse(request.query);
    return listBriefings(getTenantDb(request), query);
  });

  app.get('/briefings/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    return getBriefing(getTenantDb(request), id);
  });

  // Dispara a geração de criativos (assíncrona). Idempotente via header.
  app.post('/briefings/:id/generate', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const idempotencyKey = headerValue(request.headers['idempotency-key']);
    const result = await generateBriefing(
      getTenantDb(request),
      getCtx(request),
      id,
      idempotencyKey,
    );
    return reply.status(result.idempotentReplay ? 200 : 202).send(result);
  });
}
