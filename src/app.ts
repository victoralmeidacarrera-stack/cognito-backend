import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import { fastify, type FastifyInstance } from 'fastify';
import { loggerOptions } from './config/logger.js';
import { registerErrorHandler } from './shared/middleware/error-handler.js';
import { registerHealthRoutes } from './modules/health/health.routes.js';

/**
 * Monta a instância Fastify com plugins base, error handler e rotas.
 * Não inicia o listen — isso é responsabilidade do server.ts (testável).
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = fastify({
    logger: loggerOptions,
    disableRequestLogging: false,
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024, // 5 MB
  });

  // Segurança / infra HTTP
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(sensible);

  // Tratamento de erros global (antes das rotas)
  registerErrorHandler(app);

  // Rotas (Fase 1: apenas health; demais módulos entram na Fase 2)
  registerHealthRoutes(app);

  return app;
}
