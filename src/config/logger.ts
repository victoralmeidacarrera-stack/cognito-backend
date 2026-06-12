import { pino, type LoggerOptions } from 'pino';
import { env, isProduction } from './env.js';

export const loggerOptions: LoggerOptions = {
  level: env.LOG_LEVEL,
  // Em prod: JSON estruturado (consumido por Railway/Sentry).
  // Em dev: pino-pretty para leitura humana.
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        },
      }),
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
