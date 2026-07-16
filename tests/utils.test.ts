import { describe, expect, it } from 'vitest';
import { assertNever, currentPeriod, formatPriceBRL, slugify } from '../src/shared/utils.js';

// Intl usa espaço não-quebrável (U+00A0) entre "R$" e o número; normaliza p/ o teste.
const norm = (s: string): string => s.replace(/\s/g, ' ');

describe('slugify', () => {
  it('remove acentos e normaliza', () => {
    expect(slugify('Concessionária Demo')).toBe('concessionaria-demo');
    expect(slugify('Feirão de Junho 2026!')).toBe('feirao-de-junho-2026');
    expect(slugify('  já --- foi  ')).toBe('ja-foi');
  });
});

describe('currentPeriod', () => {
  it('formata YYYY-MM em UTC', () => {
    expect(currentPeriod(new Date('2026-06-13T23:00:00Z'))).toBe('2026-06');
    expect(currentPeriod(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01');
  });
});

describe('assertNever', () => {
  it('lança ao ser alcançado', () => {
    expect(() => assertNever('x' as never)).toThrow();
  });
});

describe('formatPriceBRL', () => {
  it('formata centavos em BRL, omitindo centavos zerados', () => {
    expect(norm(formatPriceBRL(14_999_000))).toBe('R$ 149.990');
    expect(norm(formatPriceBRL(9_990_090))).toBe('R$ 99.900,90');
    expect(norm(formatPriceBRL(0))).toBe('R$ 0');
  });

  it('cai para "sob consulta" quando não há preço', () => {
    expect(formatPriceBRL(null)).toBe('sob consulta');
    expect(formatPriceBRL(undefined)).toBe('sob consulta');
    expect(formatPriceBRL(Number.NaN)).toBe('sob consulta');
  });
});
