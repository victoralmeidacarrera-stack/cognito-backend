import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { fastify, type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { env } from './config/env.js';
import { loggerOptions } from './config/logger.js';
import { registerErrorHandler } from './shared/middleware/error-handler.js';
import { registerHealthRoutes } from './modules/health/health.routes.js';
import { registerRoutes } from './routes.js';

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

  // zod como fonte única de validação + geração do OpenAPI.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // CORS: lista do env em prod; reflete a origem em dev.
  // Normaliza cada origem removendo barra final — o Origin do navegador nunca
  // tem barra, então `https://app.vercel.app/` no env quebraria o match.
  const origin = env.CORS_ORIGINS
    ? env.CORS_ORIGINS.split(',')
        .map((o) => o.trim().replace(/\/+$/, ''))
        .filter(Boolean)
    : true;

  // Segurança / infra HTTP
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin, credentials: true });
  await app.register(sensible);
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (request, context) => ({
      error: {
        code: 'RATE_LIMITED',
        message: `Muitas requisições. Tente novamente em ${context.after}.`,
        requestId: request.id,
      },
    }),
  });

  // OpenAPI + Swagger UI em /docs (contrato vivo para o frontend).
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Cognito AI — API',
        description: 'Automação de criativos para Instagram (concessionárias).',
        version: '0.1.0',
      },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  // Tratamento de erros global (antes das rotas)
  registerErrorHandler(app);

  // Rotas: health (público) + webhooks + API v1 autenticada
  registerHealthRoutes(app);
  await registerRoutes(app);

  return app;
}
