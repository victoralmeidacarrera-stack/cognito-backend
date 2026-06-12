import { Queue, type QueueOptions } from 'bullmq';
import { redisConnectionOptions } from './redis.js';

// Nomes canônicos das filas — mapeiam 1:1 com src/workers/*.
export const QUEUE_NAMES = {
  generateCreative: 'generate-creative',
  renderImage: 'render-image',
  sendEmail: 'send-email',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const defaultJobOptions: QueueOptions['defaultJobOptions'] = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 60 * 60 * 24, count: 1000 },
  removeOnFail: { age: 60 * 60 * 24 * 7 },
};

const queues = new Map<QueueName, Queue>();

/**
 * Obtém (lazy) a fila pelo nome. A conexão Redis só é criada no primeiro uso,
 * mantendo o boot do server leve.
 */
export function getQueue(name: QueueName): Queue {
  const existing = queues.get(name);
  if (existing) return existing;

  const queue = new Queue(name, {
    connection: redisConnectionOptions(),
    defaultJobOptions,
  });
  queues.set(name, queue);
  return queue;
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  queues.clear();
}
