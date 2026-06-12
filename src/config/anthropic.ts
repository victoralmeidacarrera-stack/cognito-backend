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
