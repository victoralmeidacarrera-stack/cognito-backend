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
