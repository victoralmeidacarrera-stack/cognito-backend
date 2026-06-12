import { BriefingStatus, JobType, type Prisma } from '@prisma/client';
import { type TenantPrisma } from '../../config/tenant.js';
import { QUEUE_NAMES } from '../../config/queue.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';
import { type RequestContext } from '../../shared/types.js';
import { type Pagination } from '../../shared/schemas.js';
import { assertCanGenerate } from '../usage/usage.service.js';
import { createJobRecord, enqueueGenerateCreative } from '../jobs/jobs.service.js';
import { type CreateBriefingInput } from './briefings.schemas.js';

export async function createBriefing(
  db: TenantPrisma,
  input: CreateBriefingInput,
): Promise<{ id: string }> {
  // Garante que a campanha existe e é da org (tenant injeta organizationId).
  const campaign = await db.campaign.findFirst({
    where: { id: input.campaignId },
    select: { id: true },
  });
  if (!campaign) throw new NotFoundError('Campanha');

  return db.briefing.create({
    // organizationId é injetado pela tenant extension (cast p/ input unchecked).
    data: {
      campaignId: input.campaignId,
      title: input.title,
      format: input.format,
      requestedVariations: input.requestedVariations,
      input: input.input as Prisma.InputJsonValue,
      ...(input.vehicleId ? { vehicleId: input.vehicleId } : {}),
      ...(input.brandBookId ? { brandBookId: input.brandBookId } : {}),
    } as Prisma.BriefingUncheckedCreateInput,
    select: { id: true },
  });
}

export async function getBriefing(db: TenantPrisma, id: string) {
  const briefing = await db.briefing.findFirst({
    where: { id },
    include: { creatives: { orderBy: { variationIndex: 'asc' } } },
  });
  if (!briefing) throw new NotFoundError('Briefing');
  return briefing;
}

export async function listBriefings(
  db: TenantPrisma,
  query: Pagination & { campaignId?: string | undefined },
) {
  const where = query.campaignId ? { campaignId: query.campaignId } : {};
  const [items, total] = await Promise.all([
    db.briefing.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
    }),
    db.briefing.count({ where }),
  ]);
  return { items, total, page: query.page, perPage: query.perPage };
}

export interface GenerateResult {
  briefingId: string;
  jobId: string;
  status: BriefingStatus;
  idempotentReplay: boolean;
}

/**
 * Dispara a geração de criativos para um briefing.
 * - Idempotência via header Idempotency-Key (replay devolve o mesmo job).
 * - Checa quota antes de enfileirar (estouro bloqueia).
 */
export async function generateBriefing(
  db: TenantPrisma,
  ctx: RequestContext,
  briefingId: string,
  idempotencyKey: string | undefined,
): Promise<GenerateResult> {
  const briefing = await db.briefing.findFirst({
    where: { id: briefingId },
    select: { id: true, status: true, requestedVariations: true, idempotencyKey: true },
  });
  if (!briefing) throw new NotFoundError('Briefing');

  // Replay idempotente: mesma chave já registrada → devolve o último job.
  if (idempotencyKey && briefing.idempotencyKey === idempotencyKey) {
    const lastJob = await db.job.findFirst({
      where: { briefingId, type: JobType.GENERATE_CREATIVE },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return {
      briefingId,
      jobId: lastJob?.id ?? '',
      status: briefing.status,
      idempotentReplay: true,
    };
  }

  if (briefing.status === BriefingStatus.GENERATING) {
    throw new ConflictError('Já existe uma geração em andamento para este briefing.');
  }

  // Bloqueia se a quota mensal/por-briefing estiver estourada.
  await assertCanGenerate(ctx.organizationId, briefing.requestedVariations);

  await db.briefing.updateMany({
    where: { id: briefingId },
    data: {
      status: BriefingStatus.GENERATING,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      failedAt: null,
      errorMessage: null,
    },
  });

  const jobId = await createJobRecord({
    organizationId: ctx.organizationId,
    type: JobType.GENERATE_CREATIVE,
    queue: QUEUE_NAMES.generateCreative,
    briefingId,
    payload: { briefingId, organizationId: ctx.organizationId },
  });

  await enqueueGenerateCreative({ jobId, organizationId: ctx.organizationId, briefingId });

  return {
    briefingId,
    jobId,
    status: BriefingStatus.GENERATING,
    idempotentReplay: false,
  };
}
