import { type FastifyInstance } from 'fastify';
import { checkDatabase } from '../../config/prisma.js';
import { checkRedis } from '../../config/redis.js';

const APP_VERSION = process.env.npm_package_version ?? '0.1.0';

export function registerHealthRoutes(app: FastifyInstance): void {
  // Liveness — o processo está de pé?
  app.get('/health', () => {
    return {
      status: 'ok',
      service: 'cognito-backend',
      version: APP_VERSION,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  });

  // Readiness — dependências externas respondem?
  app.get('/health/ready', async (_request, reply) => {
    const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);
    const ready = database && redis;

    return reply.status(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'degraded',
      checks: { database, redis },
      timestamp: new Date().toISOString(),
    });
  });
}
