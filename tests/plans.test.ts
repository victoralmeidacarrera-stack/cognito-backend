import { Plan } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { PLAN_QUOTAS, resolveQuota } from '../src/config/plans.js';

describe('PLAN_QUOTAS', () => {
  it('define os 4 planos com os limites combinados', () => {
    expect(PLAN_QUOTAS[Plan.STARTER]).toMatchObject({
      variationsPerBriefing: 6,
      monthlyVariations: 100,
      priceCentsBRL: 99000,
    });
    expect(PLAN_QUOTAS[Plan.GROWTH].monthlyVariations).toBe(300);
    expect(PLAN_QUOTAS[Plan.PRO].priceCentsBRL).toBe(449000);
    expect(PLAN_QUOTAS[Plan.ENTERPRISE].priceCentsBRL).toBeNull();
  });
});

describe('resolveQuota', () => {
  it('usa o default do plano quando não há override', () => {
    const quota = resolveQuota({ plan: Plan.GROWTH });
    expect(quota.variationsPerBriefing).toBe(12);
    expect(quota.monthlyVariations).toBe(300);
  });

  it('aplica overrides (Enterprise sob consulta)', () => {
    const quota = resolveQuota({
      plan: Plan.ENTERPRISE,
      customMonthlyVariations: 2000,
      customVariationsPerBriefing: 50,
    });
    expect(quota.monthlyVariations).toBe(2000);
    expect(quota.variationsPerBriefing).toBe(50);
  });

  it('ignora override null/undefined e mantém o default', () => {
    const quota = resolveQuota({ plan: Plan.PRO, customMonthlyVariations: null });
    expect(quota.monthlyVariations).toBe(600);
  });
});
