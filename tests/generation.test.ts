import { describe, expect, it } from 'vitest';
import { buildVariations } from '../src/modules/generation/generation.service.js';
import { estimateCostMicrocents } from '../src/config/anthropic.js';
import type { ClaudeOutput } from '../src/shared/schemas.js';

const output: ClaudeOutput = {
  headline: 'H0',
  sub_headline: 'sub',
  descricao: 'desc',
  cta: 'C0',
  variacoes: { headline: ['H1', 'H2'], cta: ['C1'] },
  emoji_sugerido: '🚗',
  justificativa: 'porque sim',
};

describe('buildVariations', () => {
  it('gera exatamente N variações', () => {
    expect(buildVariations(output, 6)).toHaveLength(6);
    expect(buildVariations(output, 1)).toHaveLength(1);
  });

  it('faz round-robin entre headline base + variações', () => {
    const v = buildVariations(output, 4);
    // pool de headlines = [H0, H1, H2]
    expect(v.map((x) => x.headline)).toEqual(['H0', 'H1', 'H2', 'H0']);
    // pool de ctas = [C0, C1]
    expect(v.map((x) => x.cta)).toEqual(['C0', 'C1', 'C0', 'C1']);
  });

  it('propaga sub_headline/descricao/emoji da base', () => {
    const [first] = buildVariations(output, 1);
    expect(first).toMatchObject({ sub_headline: 'sub', descricao: 'desc', emoji_sugerido: '🚗' });
  });
});

describe('estimateCostMicrocents', () => {
  it('calcula custo a partir dos tokens (Sonnet)', () => {
    // 1M input @ $3 + 1M output @ $15 = $18 = 1.8e9 microcents
    const cost = estimateCostMicrocents('claude-sonnet-4-5', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(cost).toBe(Math.round(18 * 1e8));
  });

  it('cache read é muito mais barato que input', () => {
    const cacheRead = estimateCostMicrocents('claude-sonnet-4-5', {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
    });
    expect(cacheRead).toBe(Math.round(0.3 * 1e8));
  });
});
