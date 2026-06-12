import { Plan } from '@prisma/client';

/**
 * Definição de quota e preço por plano.
 *
 * - variationsPerBriefing: nº máximo de variações por geração de briefing.
 * - monthlyVariations: teto de variações geradas no mês (janela YYYY-MM).
 * - priceCentsBRL: mensalidade em centavos de BRL (null = sob consulta).
 *
 * Enterprise é "sob consulta": os tetos podem ser sobrescritos por org via
 * Organization.customMonthlyVariations / customVariationsPerBriefing.
 */
export interface PlanQuota {
  readonly variationsPerBriefing: number;
  readonly monthlyVariations: number;
  readonly priceCentsBRL: number | null;
}

export const PLAN_QUOTAS: Record<Plan, PlanQuota> = {
  [Plan.STARTER]: {
    variationsPerBriefing: 6,
    monthlyVariations: 100,
    priceCentsBRL: 99000,
  },
  [Plan.GROWTH]: {
    variationsPerBriefing: 12,
    monthlyVariations: 300,
    priceCentsBRL: 249000,
  },
  [Plan.PRO]: {
    variationsPerBriefing: 20,
    monthlyVariations: 600,
    priceCentsBRL: 449000,
  },
  [Plan.ENTERPRISE]: {
    variationsPerBriefing: 30,
    monthlyVariations: Number.MAX_SAFE_INTEGER,
    priceCentsBRL: null,
  },
};

/** Quota efetiva da org, aplicando overrides sobre o default do plano. */
export function resolveQuota(input: {
  plan: Plan;
  customMonthlyVariations?: number | null;
  customVariationsPerBriefing?: number | null;
}): PlanQuota {
  const base = PLAN_QUOTAS[input.plan];
  return {
    variationsPerBriefing: input.customVariationsPerBriefing ?? base.variationsPerBriefing,
    monthlyVariations: input.customMonthlyVariations ?? base.monthlyVariations,
    priceCentsBRL: base.priceCentsBRL,
  };
}
