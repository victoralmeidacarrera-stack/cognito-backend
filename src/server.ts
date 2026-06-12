import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { disconnectPrisma } from './config/prisma.js';
import { disconnectRedis } from './config/redis.js';
import { closeQueues } from './config/queue.js';
import { initSentry } from './config/sentry.js';

async function main(): Promise<void> {
  initSentry();

  const app = await buildApp();

  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info(`🚀 cognito-backend ouvindo em http://${env.HOST}:${env.PORT}`);

  // Graceful shutdown: drena conexões antes de sair.
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'encerrando...');

    void (async () => {
      try {
        await app.close();
        await closeQueues();
        await safeDisconnectRedis();
        await disconnectPrisma();
        logger.info('shutdown completo');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'erro no shutdown');
        process.exit(1);
      }
    })();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function safeDisconnectRedis(): Promise<void> {
  try {
    await disconnectRedis();
  } catch {
    // Redis pode não ter conectado (lazyConnect); ignorar no shutdown.
  }
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'falha no boot');
  process.exit(1);
});
