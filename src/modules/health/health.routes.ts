import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { checkDatabase } from '../../config/prisma.js';
import { checkRedis } from '../../config/redis.js';

const APP_VERSION = process.env.npm_package_version ?? '0.1.0';

const TAGS = ['Health'];

/**
 * `checks.redis` continua booleano (contrato antigo), mas agora significa
 * "a fila consegue operar", não "respondeu ao PING". O bloco `redis` abre a
 * diferença — foi o que faltou no incidente de 03/08/2026, em que o Upstash
 * respondia PING com a cota estourada e recusava as escritas do BullMQ.
 */
const readySchema = z.object({
  status: z.enum(['ready', 'degraded']),
  checks: z.object({ database: z.boolean(), redis: z.boolean() }),
  redis: z.object({
    responds: z.boolean(),
    acceptsWrites: z.boolean(),
    error: z.string().optional(),
  }),
  timestamp: z.string(),
});

export function registerHealthRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Liveness — o processo está de pé?
  r.get('/health', () => {
    return {
      status: 'ok',
      service: 'cognito-backend',
      version: APP_VERSION,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  });

  // Readiness — dependências externas respondem?
  r.get(
    '/health/ready',
    {
      schema: {
        response: { 200: readySchema, 503: readySchema },
        tags: TAGS,
        summary: 'Readiness (banco + fila)',
        description:
          'O check do Redis faz uma escrita com TTL curto (o que a fila precisa), ' +
          'não um PING, e o resultado fica em cache por 15s para não queimar cota. ' +
          '`redis.responds` sem `redis.acceptsWrites` = servidor no ar recusando ' +
          'escrita (cota estourada, OOM com noeviction, réplica read-only).',
      },
    },
    async (_request, reply) => {
      const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);
      const ready = database && redis.ok;

      return reply.status(ready ? 200 : 503).send({
        status: ready ? 'ready' : 'degraded',
        checks: { database, redis: redis.ok },
        redis: {
          responds: redis.responds,
          acceptsWrites: redis.acceptsWrites,
          ...(redis.error ? { error: redis.error } : {}),
        },
        timestamp: new Date().toISOString(),
      });
    },
  );
}
