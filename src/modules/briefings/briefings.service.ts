import { BriefingStatus, JobType, type Prisma } from '@prisma/client';
import { logger } from '../../config/logger.js';
import { type TenantPrisma } from '../../config/tenant.js';
import { QUEUE_NAMES } from '../../config/queue.js';
import { ConflictError, NotFoundError, ServiceUnavailableError } from '../../shared/errors.js';
import { type RequestContext } from '../../shared/types.js';
import { type Pagination } from '../../shared/schemas.js';
import { assertCanGenerate } from '../usage/usage.service.js';
import { createJobRecord, enqueueGenerateCreative, markJobFailed } from '../jobs/jobs.service.js';
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
 * A mensagem crua de quem recusou o job é o dado mais valioso do incidente —
 * é ela que aparece no briefing FAILED e no 503. No estouro de cota do Upstash,
 * por exemplo, ela é `ERR max requests limit exceeded. Limit: 500000, Usage:
 * 500000`; num DNS errado, `getaddrinfo ENOTFOUND ...`. Aqui só normalizamos
 * (uma linha, tamanho sob controle) — nunca substituímos por texto genérico.
 */
function enqueueFailureReason(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const single = raw.replace(/\s+/g, ' ').trim();
  if (single === '') return err instanceof Error ? err.name : 'erro desconhecido';
  return single.length > 300 ? `${single.slice(0, 299)}…` : single;
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

  try {
    await enqueueGenerateCreative({ jobId, organizationId: ctx.organizationId, briefingId });
  } catch (err) {
    // Sem este rollback o briefing ficava GENERATING para sempre (errorMessage
    // null) e toda retentativa batia no ConflictError acima — não há rota para
    // destravar. Aconteceu em produção quando o BullMQ não conseguiu enfileirar.
    const reason = enqueueFailureReason(err);
    logger.error({ err, briefingId, jobId }, 'falha ao enfileirar a geração');

    // As duas escritas do rollback são best-effort e INDEPENDENTES: cada uma no
    // seu try/catch, senão uma falha na primeira deixaria o Job em QUEUED para
    // sempre. Nenhuma delas pode mascarar o erro do enqueue (a causa real).
    try {
      await db.briefing.updateMany({
        where: { id: briefingId },
        data: {
          status: BriefingStatus.FAILED,
          failedAt: new Date(),
          errorMessage: `Falha ao enfileirar a geração: ${reason}`,
          // Esta tentativa não chegou a existir, então a chave tem que ser
          // liberada: sem isso, o retry com a MESMA Idempotency-Key — que é
          // exatamente o que o 503 ("tente novamente") pede — cairia no replay
          // lá em cima e devolveria 200 com o job morto, sem nunca reenfileirar.
          idempotencyKey: null,
        },
      });
    } catch (rollbackErr) {
      logger.error({ err: rollbackErr, briefingId, jobId }, 'rollback do briefing falhou');
    }

    try {
      await markJobFailed(jobId, reason);
    } catch (rollbackErr) {
      logger.error({ err: rollbackErr, briefingId, jobId }, 'rollback do job falhou');
    }

    throw new ServiceUnavailableError(
      `Não foi possível enfileirar a geração: ${reason}. Tente novamente em instantes.`,
    );
  }

  return {
    briefingId,
    jobId,
    status: BriefingStatus.GENERATING,
    idempotentReplay: false,
  };
}
