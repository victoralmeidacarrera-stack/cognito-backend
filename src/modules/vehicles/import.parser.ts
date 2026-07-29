import ExcelJS from 'exceljs';
import { type z } from 'zod';
import { DomainError, isAppError, ValidationError } from '../../shared/errors.js';
import { type CreateVehicleInput, createVehicleSchema } from './vehicles.schemas.js';

/**
 * Parser puro da planilha de catálogo (.xlsx) — sem Prisma e sem Fastify.
 * Toda a normalização (cabeçalho + valor) mora aqui; o service só persiste.
 *
 * Import é PARCIAL por definição: linha ruim vira erro no relatório, nunca
 * derruba o arquivo inteiro.
 */

/** Linha aprovada — validada pelo MESMO schema do POST /vehicles. */
export type VehicleImportRow = CreateVehicleInput;

export interface ImportRowError {
  /** Número real da linha no Excel (cabeçalho = 1, dados começam em 2). */
  row: number;
  /** Campo canônico do erro, ou null quando o erro é da linha toda. */
  field: string | null;
  message: string;
}

export interface ParsedVehicleImport {
  rows: { row: number; data: VehicleImportRow }[];
  errors: ImportRowError[];
}

/** Teto de linhas de dados: o import roda síncrono na request. */
export const MAX_IMPORT_ROWS = 2000;
/** Nenhum layout comporta mais que isso; o resto é ruído do DMS. */
const MAX_HIGHLIGHTS = 8;
const HEADER_ROW = 1;
// Quem lê isso é o dono da concessionária, não um dev: a dica aponta para o
// botão da tela, nunca para a rota da API.
const TEMPLATE_HINT = 'Use o botão "Baixar planilha modelo" como referência.';

type VehicleField = keyof VehicleImportRow;

/**
 * Cada DMS/ERP nomeia as colunas do seu jeito. O match é EXATO sobre o
 * cabeçalho normalizado (nunca `includes`), senão "ano" comeria "ano modelo",
 * "final" comeria "final de placa" e "id" comeria "id externo".
 */
const HEADER_ALIASES: Record<VehicleField, readonly string[]> = {
  make: ['marca', 'montadora', 'fabricante', 'make', 'brand'],
  model: ['modelo', 'model'],
  trim: ['versao', 'acabamento', 'trim'],
  year: ['ano', 'ano fabricacao', 'ano de fabricacao', 'year'],
  modelYear: ['ano modelo', 'ano do modelo', 'model year'],
  priceCents: ['preco', 'valor', 'preco de venda', 'valor de venda', 'price'],
  mileageKm: ['km', 'kms', 'quilometragem', 'odometro', 'mileage'],
  color: ['cor', 'color'],
  fuel: ['combustivel', 'fuel'],
  transmission: ['cambio', 'transmissao', 'transmission'],
  plateEnding: ['final de placa', 'final da placa', 'placa final', 'final'],
  condition: ['condicao', 'estado', 'situacao', 'condition'],
  highlights: ['destaques', 'diferenciais', 'opcionais', 'highlights'],
  externalId: ['id externo', 'id', 'codigo', 'cod', 'estoque', 'external id', 'id dms'],
};

const FIELD_BY_HEADER = new Map<string, VehicleField>();
for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
  // Object.entries perde o tipo da chave; o Record acima já garante o domínio.
  for (const alias of aliases) FIELD_BY_HEADER.set(alias, field as VehicleField);
}

/** Campos que entram no banco como texto puro (sem conversão). */
const TEXT_FIELDS = [
  'make',
  'model',
  'trim',
  'color',
  'fuel',
  'transmission',
  'plateEnding',
  'externalId',
] as const satisfies readonly VehicleField[];

const CONDITION_BY_LABEL = new Map<string, 'NEW' | 'USED'>([
  ['novo', 'NEW'],
  ['new', 'NEW'],
  ['0km', 'NEW'],
  ['0 km', 'NEW'],
  ['zero km', 'NEW'],
  ['usado', 'USED'],
  ['seminovo', 'USED'],
  ['semi novo', 'USED'],
  ['used', 'USED'],
]);

/**
 * Chave comparável: trim → minúsculo → sem acento → espaço/underscore/hífen
 * colapsados. Serve para cabeçalho e para o valor de "condição".
 */
function normalizeKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_-]+/g, ' ')
    .trim();
}

interface CellText {
  /** Sempre já trimado; string vazia significa célula ausente. */
  text: string;
  /** Valor numérico quando a célula é numérica de verdade (evita reparse). */
  number: number | null;
}

const EMPTY_CELL: CellText = { text: '', number: null };

/** `Array.isArray` sobre `unknown` estreita para `any[]`; isto estreita para `unknown[]`. */
function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/** Concatena os pedaços de um rich text. O trim é do texto inteiro, nunca por pedaço. */
function joinRichText(parts: unknown): string {
  if (!isUnknownArray(parts)) return '';
  let text = '';
  for (const part of parts) {
    if (typeof part === 'string') text += part;
    else if (typeof part === 'object' && part !== null && 'text' in part) {
      if (typeof part.text === 'string') text += part.text;
    }
  }
  return text;
}

/**
 * O exceljs devolve objeto rico em vários casos (fórmula, hyperlink, rich text,
 * data). Sem reduzir a texto, o banco recebe "[object Object]".
 *
 * O parâmetro é `unknown` de propósito: o `index.d.ts` do exceljs MENTE sobre o
 * hyperlink (declara `text: string`, mas o leitor devolve `{ richText: [...] }`
 * quando o rótulo do link tem formatação — planilha de DMS que passou por
 * Google Sheets/LibreOffice). Daí o narrowing manual e a recursão no `text`.
 */
function readCell(value: unknown): CellText {
  if (value === null || value === undefined) return EMPTY_CELL;
  if (typeof value === 'number') return { text: String(value), number: value };
  if (typeof value === 'string') return { text: value.trim(), number: null };
  if (typeof value === 'boolean') return { text: String(value), number: null };
  if (value instanceof Date) {
    // `Date` inválida existe: célula numérica fora da faixa de data (código de
    // estoque de 14 dígitos) numa coluna que herdou `numFmt` de data. Sem a
    // guarda, `toISOString()` lança RangeError e derruba o arquivo inteiro.
    return Number.isNaN(value.getTime()) ? EMPTY_CELL : { text: value.toISOString(), number: null };
  }
  if (typeof value !== 'object') return EMPTY_CELL;

  if ('richText' in value) return { text: joinRichText(value.richText).trim(), number: null };
  // Recursão: o rótulo pode ser string ou rich text — os dois casos já estão acima.
  if ('hyperlink' in value) return 'text' in value ? readCell(value.text) : EMPTY_CELL;
  if ('formula' in value || 'sharedFormula' in value) {
    return 'result' in value ? readCell(value.result) : EMPTY_CELL;
  }
  // Célula em erro (#N/A, #REF!, ...) conta como ausente.
  return EMPTY_CELL;
}

/**
 * Número em pt-BR ou en-US. Com os dois separadores, o ÚLTIMO é o decimal;
 * com só um tipo repetido, é separador de milhar; ponto sozinho seguido de
 * exatamente 3 dígitos até o fim também é milhar ("89.900" = oitenta e nove mil).
 */
function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[\s\u00a0]/g, '').replace(/[^0-9,.-]/g, '');
  if (!/\d/.test(cleaned)) return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized =
      lastComma > lastDot
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
  } else if (lastComma >= 0) {
    normalized =
      cleaned.indexOf(',') === lastComma ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '');
  } else if (lastDot >= 0) {
    const isThousands = cleaned.indexOf('.') !== lastDot || /\.\d{3}$/.test(cleaned);
    normalized = isThousands ? cleaned.replace(/\./g, '') : cleaned;
  } else {
    normalized = cleaned;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Mensagem em português para o relatório (o default do zod é em inglês). */
function describeIssue(issue: z.ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined'
        ? 'Campo obrigatório.'
        : `Tipo inválido (esperado ${issue.expected}).`;
    case 'too_small':
      return issue.type === 'string'
        ? 'Campo obrigatório.'
        : `Valor abaixo do mínimo permitido (${issue.minimum}).`;
    case 'too_big':
      return issue.type === 'string'
        ? `Texto acima do limite de ${issue.maximum} caracteres.`
        : `Valor acima do máximo permitido (${issue.maximum}).`;
    case 'invalid_enum_value':
      return 'Valor não reconhecido.';
    default:
      return 'Valor inválido.';
  }
}

function issueField(issue: z.ZodIssue): string | null {
  const [first] = issue.path;
  return typeof first === 'string' ? first : null;
}

/** Cabeçalho → coluna do Excel. Coluna desconhecida ou repetida é ignorada. */
function mapHeader(sheet: ExcelJS.Worksheet): Map<number, VehicleField> {
  const columns = new Map<number, VehicleField>();
  const taken = new Set<VehicleField>();

  sheet.getRow(HEADER_ROW).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const field = FIELD_BY_HEADER.get(normalizeKey(readCell(cell.value).text));
    if (!field || taken.has(field)) return;
    taken.add(field);
    columns.set(colNumber, field);
  });

  if (!taken.has('make') && !taken.has('model')) {
    throw new DomainError(
      `Cabeçalho não reconhecido: a primeira linha da planilha precisa conter ao menos as colunas "Marca" e "Modelo". ${TEMPLATE_HINT}`,
    );
  }
  return columns;
}

function readRow(
  row: ExcelJS.Row,
  columns: Map<number, VehicleField>,
): Map<VehicleField, CellText> {
  const cells = new Map<VehicleField, CellText>();
  for (const [colNumber, field] of columns) {
    cells.set(field, readCell(row.getCell(colNumber).value));
  }
  return cells;
}

/** Normaliza uma linha e a valida com o schema do POST /vehicles. */
function parseRow(
  rowNumber: number,
  cells: Map<VehicleField, CellText>,
  result: ParsedVehicleImport,
): void {
  const cell = (field: VehicleField): CellText => cells.get(field) ?? EMPTY_CELL;
  const raw: Record<string, unknown> = {};
  const rowErrors: ImportRowError[] = [];
  const fail = (field: string, message: string): void => {
    rowErrors.push({ row: rowNumber, field, message });
  };

  for (const field of TEXT_FIELDS) {
    const { text } = cell(field);
    if (text) raw[field] = text;
  }

  for (const field of ['year', 'modelYear'] as const) {
    const { text, number } = cell(field);
    if (!text) continue;
    const parsed = number ?? parseNumber(text);
    if (parsed === null) fail(field, `Ano inválido: "${text}".`);
    else raw[field] = Math.round(parsed);
  }

  const price = cell('priceCents');
  if (price.text) {
    // Célula numérica do Excel vem em reais; string passa pela heurística pt-BR.
    const reais = price.number ?? parseNumber(price.text);
    if (reais === null) fail('priceCents', `Preço inválido: "${price.text}".`);
    else raw.priceCents = Math.round(reais * 100);
  }

  const mileage = cell('mileageKm');
  if (mileage.text) {
    const km = mileage.number ?? parseNumber(mileage.text);
    if (km === null) fail('mileageKm', `Quilometragem inválida: "${mileage.text}".`);
    else raw.mileageKm = Math.round(km);
  }

  const condition = cell('condition');
  if (condition.text) {
    // Vazio não vira erro: o default do schema/Prisma resolve.
    const mapped = CONDITION_BY_LABEL.get(normalizeKey(condition.text));
    if (!mapped)
      fail('condition', `Condição não reconhecida: "${condition.text}". Use novo ou usado.`);
    else raw.condition = mapped;
  }

  const highlights = cell('highlights');
  if (highlights.text) {
    // Separadores: ; | e quebra de linha. Vírgula NÃO separa — "Único dono,
    // revisado na concessionária" é um destaque só.
    const items = highlights.text
      .split(/[;|\r\n]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, MAX_HIGHLIGHTS);
    if (items.length > 0) raw.highlights = items;
  }

  if (rowErrors.length > 0) {
    result.errors.push(...rowErrors);
    return;
  }

  const parsed = createVehicleSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      result.errors.push({
        row: rowNumber,
        field: issueField(issue),
        message: describeIssue(issue),
      });
    }
    return;
  }

  result.rows.push({ row: rowNumber, data: parsed.data });
}

/** Lê o .xlsx e devolve linhas válidas + erros por linha. */
export async function parseVehicleImport(file: Buffer): Promise<ParsedVehicleImport> {
  if (file.length === 0) {
    throw new ValidationError('Arquivo vazio ou base64 inválido.');
  }

  const workbook = new ExcelJS.Workbook();
  try {
    // O exceljs tipa `load` com um Buffer próprio que estende ArrayBuffer; o
    // Buffer do Node é Uint8Array, então copiamos para um ArrayBuffer real.
    const bytes = new ArrayBuffer(file.byteLength);
    new Uint8Array(bytes).set(file);
    await workbook.xlsx.load(bytes);
  } catch {
    // Nunca vazar a exceção crua do exceljs para o cliente.
    throw new ValidationError(
      `Não foi possível ler a planilha. Envie um arquivo .xlsx válido. ${TEMPLATE_HINT}`,
    );
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new DomainError(`A planilha não tem nenhuma aba com dados. ${TEMPLATE_HINT}`);

  const columns = mapHeader(sheet);
  const result: ParsedVehicleImport = { rows: [], errors: [] };
  let dataRows = 0;

  try {
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber <= HEADER_ROW) return;

      const cells = readRow(row, columns);
      // Linha sem nenhum valor nas colunas conhecidas: ignorada em silêncio.
      if ([...cells.values()].every((value) => value.text === '')) return;

      dataRows += 1;
      if (dataRows > MAX_IMPORT_ROWS) {
        throw new DomainError(
          `A planilha tem mais de ${MAX_IMPORT_ROWS} linhas. Divida o arquivo em partes menores e importe uma de cada vez.`,
        );
      }

      parseRow(rowNumber, cells, result);
    });
  } catch (error) {
    // Cinto e suspensório: os erros do próprio domínio (teto de linhas) saem
    // como estão; qualquer surpresa do exceljs vira 400 em português, nunca 500.
    if (isAppError(error)) throw error;
    throw new ValidationError(
      `Não foi possível ler as linhas da planilha. Envie um arquivo .xlsx válido. ${TEMPLATE_HINT}`,
    );
  }

  return result;
}
