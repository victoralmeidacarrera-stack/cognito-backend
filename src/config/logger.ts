import { pino, type LoggerOptions } from 'pino';
import { env } from './env.js';

// pino-pretty é devDependency e NÃO existe no runner de produção (npm ci --omit=dev).
// Opt-in explícito via LOG_PRETTY=true — nunca inferido de NODE_ENV. O default
// precisa ser `false`: NODE_ENV tem default 'development' (env.ts), então cair em
// `!isProduction` fazia um serviço no Railway sem NODE_ENV=production explícito
// (worker, job pontual) tentar carregar pino-pretty e morrer no boot — exatamente
// o bug que o opt-in existe para matar. O .env.example já traz LOG_PRETTY=true
// para o desenvolvimento local.
const usePretty = env.LOG_PRETTY === 'true';

export const loggerOptions: LoggerOptions = {
  level: env.LOG_LEVEL,
  // pino-pretty para leitura humana; caso contrário JSON estruturado (Railway/Sentry).
  ...(usePretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
  // Nunca logar segredos.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["idempotency-key"]',
      '*.apiKey',
      '*.secret',
      '*.password',
    ],
    remove: true,
  },
  base: { service: 'cognito-backend' },
};

// Instância standalone para logs fora do ciclo de request (boot, workers, etc.).
// Dentro do Fastify, usamos as mesmas options para que ele crie o próprio
// logger (tipado como FastifyBaseLogger).
export const logger = pino(loggerOptions);
export type Logger = typeof logger;
