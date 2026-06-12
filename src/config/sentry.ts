import * as Sentry from '@sentry/node';
import { env, isProduction } from './env.js';
import { logger } from './logger.js';

let initialized = false;

/** Inicializa o Sentry se houver DSN. No-op em dev sem DSN. */
export function initSentry(): void {
  if (initialized || !env.SENTRY_DSN) return;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    enabled: isProduction,
    tracesSampleRate: 0.1,
  });
  initialized = true;
  logger.info('sentry inicializado');
}

export { Sentry };
