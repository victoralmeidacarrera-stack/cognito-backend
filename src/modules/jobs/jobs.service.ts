import { JobStatus, type JobType, type Prisma } from '@prisma/client';
import { type Job } from 'bullmq';
import { isProduction } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../config/prisma.js';
import { getQueue, QUEUE_NAMES } from '../../config/queue.js';
import { checkRedis } from '../../config/redis.js';
import {
  type GenerateCreativePayload,
  type RenderImagePayload,
  type SendEmailPayload,
} from './job-payloads.js';

/** Cria o registro persistente de um job (espelho do BullMQ). */
export async function createJobRecord(input: {
  organizationId: string;
  type: JobType;
  queue: string;
  briefingId?: string | undefined;
  payload: Prisma.InputJsonValue;
}): Promise<string> {
  const job = await prisma.job.create({
    data: {
      organizationId: input.organizationId,
      type: input.type,
      queue: input.queue,
      ...(input.briefingId ? { briefingId: input.briefingId } : {}),
      payload: input.payload,
      status: JobStatus.QUEUED,
    },
    select: { id: true },
  });
  return job.id;
}

export async function markJobActive(jobId: string): Promise<void> {
  await prisma.job.updateMany({
    where: { id: jobId },
    data: { status: JobStatus.ACTIVE, startedAt: new Date(), attempts: { increment: 1 } },
  });
}

export async function markJobCompleted(jobId: string): Promise<void> {
  await prisma.job.updateMany({
    where: { id: jobId },
    data: { status: JobStatus.COMPLETED, finishedAt: new Date() },
  });
}

export async function markJobFailed(jobId: string, errorMessage: string): Promise<void> {
  await prisma.job.updateMany({
    where: { id: jobId },
    data: { status: JobStatus.FAILED, finishedAt: new Date(), errorMessage },
  });
}

// ── Enfileiramento ─────────────────────────────────────────────
//
// Fora de produção, se o Redis estiver indisponível o job roda INLINE no
// processo da API (fire-and-forget), preservando o contrato assíncrono dos
// endpoints. Em produção o BullMQ/Redis é sempre obrigatório.

/** Job "fake" mínimo para rodar um processor fora do BullMQ (só usa .data). */
function inlineJob(data: unknown): Job {
  return { data } as Job;
}

async function enqueueOrRunInline(
  queueName: string,
  enqueue: () => Promise<void>,
  runInline: () => Promise<void>,
): Promise<void> {
  if (isProduction || (await checkRedis(800))) {
    await enqueue();
    return;
  }
  logger.warn({ queue: queueName }, 'Redis indisponível — rodando job inline (modo dev)');
  void runInline().catch((err: unknown) => {
    // O processor já persiste a falha (briefing/creative/job) — aqui só logamos.
    logger.error({ err, queue: queueName }, 'job inline falhou');
  });
}

export async function enqueueGenerateCreative(payload: GenerateCreativePayload): Promise<void> {
  await enqueueOrRunInline(
    QUEUE_NAMES.generateCreative,
    () =>
      getQueue(QUEUE_NAMES.generateCreative)
        .add('generate', payload, { jobId: payload.jobId })
        .then(() => undefined),
    async () => {
      const { processGenerateCreative } = await import('../../workers/generate-creative.js');
      await processGenerateCreative(inlineJob(payload));
    },
  );
}

export async function enqueueRenderImage(payload: RenderImagePayload): Promise<void> {
  await enqueueOrRunInline(
    QUEUE_NAMES.renderImage,
    () =>
      getQueue(QUEUE_NAMES.renderImage)
        .add('render', payload)
        .then(() => undefined),
    async () => {
      const { processRenderImage } = await import('../../workers/render-image.js');
      await processRenderImage(inlineJob(payload));
    },
  );
}

export async function enqueueSendEmail(payload: SendEmailPayload): Promise<void> {
  await enqueueOrRunInline(
    QUEUE_NAMES.sendEmail,
    () =>
      getQueue(QUEUE_NAMES.sendEmail)
        .add('send', payload)
        .then(() => undefined),
    async () => {
      const { processSendEmail } = await import('../../workers/send-email.js');
      await processSendEmail(inlineJob(payload));
    },
  );
}
