import Anthropic from '@anthropic-ai/sdk';
import { env } from './env.js';

export const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

// Modelos por tarefa: Sonnet para o briefing principal, Haiku para variações
// em massa. O BrandBook é enviado com prompt caching (cache_control) — wiring
// completo no módulo de generation (Fase 2).
export const ANTHROPIC_MODELS = {
  briefing: env.ANTHROPIC_MODEL_BRIEFING,
  variations: env.ANTHROPIC_MODEL_VARIATIONS,
} as const;

// Preço em USD por milhão de tokens (MTok). Usado para estimar custo por job.
export interface ModelPricing {
  readonly inputPerMTok: number;
  readonly outputPerMTok: number;
  readonly cacheWritePerMTok: number;
  readonly cacheReadPerMTok: number;
}

const SONNET_45_PRICING: ModelPricing = {
  inputPerMTok: 3,
  outputPerMTok: 15,
  cacheWritePerMTok: 3.75,
  cacheReadPerMTok: 0.3,
};

const HAIKU_45_PRICING: ModelPricing = {
  inputPerMTok: 1,
  outputPerMTok: 5,
  cacheWritePerMTok: 1.25,
  cacheReadPerMTok: 0.1,
};

export const ANTHROPIC_PRICING: Record<string, ModelPricing> = {
  [ANTHROPIC_MODELS.briefing]: SONNET_45_PRICING,
  [ANTHROPIC_MODELS.variations]: HAIKU_45_PRICING,
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Custo estimado em micro-centavos de USD (1 microcent = 1e-8 USD; sem float). */
export function estimateCostMicrocents(model: string, usage: TokenUsage): number {
  const pricing = ANTHROPIC_PRICING[model] ?? SONNET_45_PRICING;
  const usd =
    (usage.inputTokens * pricing.inputPerMTok +
      usage.outputTokens * pricing.outputPerMTok +
      usage.cacheReadTokens * pricing.cacheReadPerMTok +
      usage.cacheWriteTokens * pricing.cacheWritePerMTok) /
    1_000_000;
  return Math.round(usd * 1e8);
}
