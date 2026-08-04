import { beforeEach, describe, expect, it, vi } from 'vitest';

// O client do fal é mockado: nenhuma chamada real (o any-llm cobra por request
// e o contrato já foi validado à mão contra a API).
const { subscribeMock } = vi.hoisted(() => ({
  subscribeMock:
    vi.fn<
      (model: string, opts: { input: Record<string, unknown> }) => Promise<{ data: unknown }>
    >(),
}));

vi.mock('@fal-ai/client', () => ({
  fal: { config: vi.fn(), subscribe: subscribeMock, storage: { upload: vi.fn() } },
}));

// Cinto de segurança: mesmo que COPY_PROVIDER venha errado do ambiente, nenhum
// caminho consegue discar para api.anthropic.com — a chamada explode local.
const { anthropicCreateMock } = vi.hoisted(() => ({
  anthropicCreateMock: vi.fn(() => {
    throw new Error('teste tentou chamar a API da Anthropic de verdade');
  }),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class AnthropicMock {
    messages = { create: anthropicCreateMock };
  },
}));

import { buildVariations, generateCopy } from '../src/modules/generation/generation.service.js';
import type { GenerationContext } from '../src/modules/generation/generation.prompt.js';
import { estimateCostMicrocents } from '../src/config/anthropic.js';
import { env } from '../src/config/env.js';
import { DomainError } from '../src/shared/errors.js';
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

const ctx: GenerationContext = {
  briefing: {
    id: 'b1',
    title: 'Oferta Nivus',
    format: 'FEED',
    input: { oferta: 'IPVA grátis' },
    requestedVariations: 6,
  },
  brandBook: null,
  vehicle: null,
  factoryRestrictions: {},
};

describe('generateCopy — provedor fal (default)', () => {
  beforeEach(() => {
    subscribeMock.mockReset();
  });

  // Guarda: o vitest.config.ts fixa COPY_PROVIDER=fal. Se este teste falhar,
  // os demais estariam exercitando outro provedor com o mock do fal inútil.
  it('roda no provedor fal', () => {
    expect(env.COPY_PROVIDER).toBe('fal');
  });

  it('chama fal-ai/any-llm e parseia o {output} da resposta', async () => {
    subscribeMock.mockResolvedValue({ data: { output: JSON.stringify(output), error: null } });

    const result = await generateCopy(ctx);

    const call = subscribeMock.mock.calls[0];
    expect(call?.[0]).toBe('fal-ai/any-llm');
    const input = call?.[1].input;
    expect(input?.model).toBe(env.FAL_LLM_MODEL);
    expect(input?.max_tokens).toBe(2048);
    expect(input?.temperature).toBe(0.7);
    // system + user vão como campos separados, em texto puro.
    expect(typeof input?.system_prompt).toBe('string');
    expect(String(input?.prompt)).toContain('Oferta Nivus');

    expect(result.output).toEqual(output);
    expect(result.model).toBe(`fal:${env.FAL_LLM_MODEL}`);
    // O any-llm cobra por request e não devolve tokens.
    expect(result.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    // FAL_LLM_COST_MICROCENTS=0 significa "preço real não preenchido": o custo
    // vai como null (não medido), nunca como 0 (que seria "saiu de graça").
    expect(env.FAL_LLM_COST_MICROCENTS).toBe(0);
    expect(result.costMicrocents).toBeNull();
  });

  it('aceita JSON embrulhado em cercas markdown', async () => {
    subscribeMock.mockResolvedValue({
      data: { output: '```json\n' + JSON.stringify(output) + '\n```' },
    });

    const result = await generateCopy(ctx);
    expect(result.output.headline).toBe('H0');
  });

  it('trata error no corpo mesmo com HTTP 200', async () => {
    subscribeMock.mockResolvedValue({ data: { output: '', error: 'model overloaded' } });

    await expect(generateCopy(ctx)).rejects.toBeInstanceOf(DomainError);
  });

  it('trata resposta truncada (partial) sem culpar o JSON', async () => {
    // Estourou o max_tokens: HTTP 200, error null e JSON cortado ao meio.
    subscribeMock.mockResolvedValue({
      data: { output: JSON.stringify(output).slice(0, 40), partial: true, error: null },
    });

    await expect(generateCopy(ctx)).rejects.toThrow(/truncou a resposta/);
  });

  it('trata output ausente/vazio', async () => {
    subscribeMock.mockResolvedValue({ data: { error: null } });

    await expect(generateCopy(ctx)).rejects.toBeInstanceOf(DomainError);
  });

  it('rejeita saída que não bate com o schema', async () => {
    subscribeMock.mockResolvedValue({ data: { output: '{"headline":"só isso"}' } });

    await expect(generateCopy(ctx)).rejects.toBeInstanceOf(DomainError);
  });
});
