/** Janela mensal de quota no formato YYYY-MM (UTC). */
export function currentPeriod(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/** Slug url-safe a partir de um nome (acentos removidos). */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Garante exaustividade em switches sobre unions/enums. */
export function assertNever(value: never): never {
  throw new Error(`Caso não tratado: ${String(value)}`);
}

function brlFormatter(fractionDigits: number): Intl.NumberFormat {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

const BRL_WHOLE = brlFormatter(0);
const BRL_CENTS = brlFormatter(2);

/**
 * Formata um preço em centavos (BRL) para exibição no criativo.
 * `null`/ausente → 'sob consulta' (nunca renderiza preço vazio/quebrado).
 * Centavos zerados são omitidos (R$ 149.990); com centavos, sempre 2 casas
 * (R$ 99.900,90 — nunca R$ 99.900,9).
 */
export function formatPriceBRL(priceCents: number | null | undefined): string {
  if (priceCents == null || !Number.isFinite(priceCents)) return 'sob consulta';
  const rounded = Math.round(priceCents);
  const fmt = rounded % 100 === 0 ? BRL_WHOLE : BRL_CENTS;
  return fmt.format(rounded / 100);
}
