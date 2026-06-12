import { type Job, Worker } from 'bullmq';
import { logger } from '../config/logger.js';
import { disconnectPrisma } from '../config/prisma.js';
import { closeBrowser } from '../config/puppeteer.js';
import { QUEUE_NAMES } from '../config/queue.js';
import { redisConnectionOptions } from '../config/redis.js';
import { initSentry } from '../config/sentry.js';
import { processGenerateCreative } from './generate-creative.js';
import { processRenderImage } from './render-image.js';
import { processSendEmail } from './send-email.js';

initSentry();

const connection = redisConnectionOptions();

const workers: Worker[] = [
  new Worker(QUEUE_NAMES.generateCreative, processGenerateCreative, { connection, concurrency: 2 }),
  new Worker(QUEUE_NAMES.renderImage, processRenderImage, { connection, concurrency: 2 }),
  new Worker(QUEUE_NAMES.sendEmail, processSendEmail, { connection, concurrency: 5 }),
];

for (const worker of workers) {
  worker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error({ queue: worker.name, jobId: job?.id, err }, 'job falhou');
  });
  worker.on('completed', (job: Job) => {
    logger.debug({ queue: worker.name, jobId: job.id }, 'job concluído');
  });
}

logger.info('🛠️  workers iniciados: generate-creative, render-image, send-email');

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'encerrando workers...');

  void (async () => {
    try {
      await Promise.all(workers.map((worker) => worker.close()));
      await closeBrowser();
      await disconnectPrisma();
      logger.info('workers encerrados');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'erro no shutdown dos workers');
      process.exit(1);
    }
  })();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
