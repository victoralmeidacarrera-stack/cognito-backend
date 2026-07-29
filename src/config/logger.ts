import { pino, type LoggerOptions } from 'pino';
import { env, isProduction } from './env.js';

// pino-pretty é devDependency e NÃO existe no runner de produção (npm ci --omit=dev).
// Opt-in explícito via LOG_PRETTY=true — nunca inferido de NODE_ENV, senão um serviço
// sem NODE_ENV=production (ex.: worker) tenta carregar pino-pretty e morre no boot.
// Default: liga em dev (fora de produção), desliga em prod.
const usePretty = env.LOG_PRETTY ? env.LOG_PRETTY === 'true' : !isProduction;

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
