import { JobStatus, type JobType, type Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { getQueue, QUEUE_NAMES } from '../../config/queue.js';
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

export async function enqueueGenerateCreative(payload: GenerateCreativePayload): Promise<void> {
  await getQueue(QUEUE_NAMES.generateCreative).add('generate', payload, { jobId: payload.jobId });
}

export async function enqueueRenderImage(payload: RenderImagePayload): Promise<void> {
  await getQueue(QUEUE_NAMES.renderImage).add('render', payload);
}

export async function enqueueSendEmail(payload: SendEmailPayload): Promise<void> {
  await getQueue(QUEUE_NAMES.sendEmail).add('send', payload);
}
