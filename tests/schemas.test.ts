import { describe, expect, it } from 'vitest';
import { claudeOutputSchema, creativeCopySchema } from '../src/shared/schemas.js';

const validOutput = {
  headline: 'Nivus 2025 com IPVA grátis',
  sub_headline: 'O SUV compacto que cabe no seu orçamento',
  descricao: 'Aproveite as condições do feirão de junho.',
  cta: 'Agende test drive',
  variacoes: {
    headline: ['SUV dos sonhos', 'Nivus chegou'],
    cta: ['Fale no WhatsApp'],
  },
  emoji_sugerido: '🚗',
  justificativa: 'Foca em benefício concreto e CTA claro.',
};

describe('claudeOutputSchema', () => {
  it('aceita uma saída válida do Claude', () => {
    expect(claudeOutputSchema.parse(validOutput)).toMatchObject({ headline: validOutput.headline });
  });

  it('rejeita quando faltam variações', () => {
    const bad = { ...validOutput, variacoes: { headline: [], cta: [] } };
    expect(claudeOutputSchema.safeParse(bad).success).toBe(false);
  });

  it('rejeita headline acima do limite', () => {
    const bad = { ...validOutput, headline: 'x'.repeat(200) };
    expect(claudeOutputSchema.safeParse(bad).success).toBe(false);
  });
});

describe('creativeCopySchema', () => {
  it('exige headline e cta, demais opcionais', () => {
    expect(creativeCopySchema.parse({ headline: 'h', cta: 'c' })).toMatchObject({ headline: 'h' });
    expect(creativeCopySchema.safeParse({ headline: 'h' }).success).toBe(false);
  });
});
