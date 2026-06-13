import { describe, expect, it } from 'vitest';
import { assertNever, currentPeriod, slugify } from '../src/shared/utils.js';

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
