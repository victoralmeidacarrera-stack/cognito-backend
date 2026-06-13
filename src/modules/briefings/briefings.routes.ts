import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getCtx, getTenantDb } from '../../shared/context.js';
import { idParamSchema } from '../../shared/schemas.js';
import {
  createBriefing,
  generateBriefing,
  getBriefing,
  listBriefings,
} from './briefings.service.js';
import { createBriefingSchema, listBriefingsQuerySchema } from './briefings.schemas.js';

// passthrough: mantém os demais headers (o Fastify substitui request.headers
// pelo resultado do schema; sem isso, perderíamos auth, etc.).
const generateHeadersSchema = z
  .object({ 'idempotency-key': z.string().min(1).optional() })
  .passthrough();

const TAGS = ['Briefings'];

export function registerBriefingRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/briefings',
    { schema: { body: createBriefingSchema, tags: TAGS, summary: 'Cria briefing' } },
    async (request, reply) => {
      const briefing = await createBriefing(getTenantDb(request), request.body);
      return reply.status(201).send(briefing);
    },
  );

  r.get(
    '/briefings',
    { schema: { querystring: listBriefingsQuerySchema, tags: TAGS, summary: 'Lista briefings' } },
    async (request) => listBriefings(getTenantDb(request), request.query),
  );

  r.get(
    '/briefings/:id',
    { schema: { params: idParamSchema, tags: TAGS, summary: 'Detalha briefing + criativos' } },
    async (request) => getBriefing(getTenantDb(request), request.params.id),
  );

  r.post(
    '/briefings/:id/generate',
    {
      schema: {
        params: idParamSchema,
        headers: generateHeadersSchema,
        tags: TAGS,
        summary: 'Dispara a geração de criativos (idempotente via Idempotency-Key)',
      },
    },
    async (request, reply) => {
      const idempotencyKey = request.headers['idempotency-key'];
      const result = await generateBriefing(
        getTenantDb(request),
        getCtx(request),
        request.params.id,
        idempotencyKey,
      );
      return reply.status(result.idempotentReplay ? 200 : 202).send(result);
    },
  );
}
