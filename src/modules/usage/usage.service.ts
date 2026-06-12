import { UsageKind } from '@prisma/client';
import { estimateCostMicrocents, type TokenUsage } from '../../config/anthropic.js';
import { prisma } from '../../config/prisma.js';
import { DomainError, QuotaExceededError } from '../../shared/errors.js';
import { currentPeriod } from '../../shared/utils.js';
import { resolveQuota, type PlanQuota } from '../../config/plans.js';

/** Quota efetiva da org (plano + overrides). */
export async function getOrganizationQuota(organizationId: string): Promise<PlanQuota> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { plan: true, customMonthlyVariations: true, customVariationsPerBriefing: true },
  });
  return resolveQuota(org);
}

/** Total de variações geradas no período (janela mensal YYYY-MM). */
export async function getMonthlyVariationCount(
  organizationId: string,
  period = currentPeriod(),
): Promise<number> {
  const agg = await prisma.usageLog.aggregate({
    where: { organizationId, kind: UsageKind.VARIATION_GENERATED, period },
    _sum: { quantity: true },
  });
  return agg._sum.quantity ?? 0;
}

export interface QuotaSnapshot {
  quota: PlanQuota;
  used: number;
  remaining: number;
  period: string;
}

export async function getQuotaSnapshot(organizationId: string): Promise<QuotaSnapshot> {
  const period = currentPeriod();
  const [quota, used] = await Promise.all([
    getOrganizationQuota(organizationId),
    getMonthlyVariationCount(organizationId, period),
  ]);
  return { quota, used, remaining: Math.max(0, quota.monthlyVariations - used), period };
}

/**
 * Garante que a org pode gerar `requestedVariations` agora.
 * Lança DomainError (limite por briefing) ou QuotaExceededError (limite mensal).
 */
export async function assertCanGenerate(
  organizationId: string,
  requestedVariations: number,
): Promise<QuotaSnapshot> {
  const snapshot = await getQuotaSnapshot(organizationId);

  if (requestedVariations > snapshot.quota.variationsPerBriefing) {
    throw new DomainError(
      `Seu plano permite até ${snapshot.quota.variationsPerBriefing} variações por briefing.`,
      { requested: requestedVariations, limit: snapshot.quota.variationsPerBriefing },
    );
  }

  if (snapshot.used + requestedVariations > snapshot.quota.monthlyVariations) {
    throw new QuotaExceededError(
      `Quota mensal excedida: ${snapshot.used}/${snapshot.quota.monthlyVariations} variações usadas.`,
      {
        used: snapshot.used,
        limit: snapshot.quota.monthlyVariations,
        requested: requestedVariations,
      },
    );
  }

  return snapshot;
}

/** Registra variações geradas (consome quota). */
export async function recordVariationUsage(input: {
  organizationId: string;
  briefingId: string;
  quantity: number;
}): Promise<void> {
  await prisma.usageLog.create({
    data: {
      organizationId: input.organizationId,
      briefingId: input.briefingId,
      kind: UsageKind.VARIATION_GENERATED,
      period: currentPeriod(),
      quantity: input.quantity,
    },
  });
}

/** Registra consumo de tokens de IA (telemetria + custo). */
export async function recordAiUsage(input: {
  organizationId: string;
  briefingId?: string | undefined;
  model: string;
  usage: TokenUsage;
}): Promise<void> {
  await prisma.usageLog.create({
    data: {
      organizationId: input.organizationId,
      ...(input.briefingId ? { briefingId: input.briefingId } : {}),
      kind: UsageKind.AI_TOKENS,
      period: currentPeriod(),
      quantity: 1,
      model: input.model,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      cacheReadTokens: input.usage.cacheReadTokens,
      cacheWriteTokens: input.usage.cacheWriteTokens,
      costMicrocents: estimateCostMicrocents(input.model, input.usage),
    },
  });
}
