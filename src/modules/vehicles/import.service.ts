import ExcelJS from 'exceljs';
import { type Prisma } from '@prisma/client';
import { type TenantPrisma } from '../../config/tenant.js';
import { type ImportRowError, parseVehicleImport } from './import.parser.js';

export interface VehicleImportReport {
  /** Linhas de dados não-vazias encontradas na planilha. */
  total: number;
  inserted: number;
  updated: number;
  /** Linhas que não entraram (erro de validação ou de escrita). */
  skipped: number;
  errors: ImportRowError[];
}

/**
 * Importa o catálogo a partir do .xlsx.
 *
 * Upsert por `externalId` (id do DMS/ERP): Vehicle não tem unique em
 * (organizationId, externalId), então é findFirst + update/create — o tenant
 * client injeta o organizationId em todas as três queries.
 *
 * `dryRun` só lê: serve para o front mostrar a prévia antes de confirmar.
 */
export async function importVehiclesFromXlsx(
  db: TenantPrisma,
  file: Buffer,
  options: { dryRun: boolean },
): Promise<VehicleImportReport> {
  const parsed = await parseVehicleImport(file);

  const errors: ImportRowError[] = [...parsed.errors];
  // Uma linha pode acumular mais de um erro; o total conta linhas, não erros.
  const total = parsed.rows.length + new Set(parsed.errors.map((error) => error.row)).size;

  // externalId repetido dentro do próprio arquivo: o último vence. Fora do
  // dry-run o findFirst já reencontra o que a linha anterior criou; no dry-run
  // nada foi gravado, então este Set é o que mantém a prévia fiel.
  const seenExternalIds = new Set<string>();
  let inserted = 0;
  let updated = 0;

  for (const { row, data } of parsed.rows) {
    try {
      const { externalId } = data;
      const existing = externalId
        ? await db.vehicle.findFirst({ where: { externalId }, select: { id: true } })
        : null;

      if (existing) {
        if (!options.dryRun) {
          await db.vehicle.updateMany({ where: { id: existing.id }, data });
        }
        updated += 1;
      } else if (externalId && seenExternalIds.has(externalId)) {
        updated += 1;
      } else {
        if (!options.dryRun) {
          // organizationId é injetado pela tenant extension (cast p/ unchecked).
          await db.vehicle.create({
            data: data as unknown as Prisma.VehicleUncheckedCreateInput,
            select: { id: true },
          });
        }
        inserted += 1;
      }

      if (externalId) seenExternalIds.add(externalId);
    } catch {
      // Falha de escrita de uma linha não derruba o import inteiro.
      errors.push({ row, field: null, message: 'Não foi possível salvar esta linha.' });
    }
  }

  return { total, inserted, updated, skipped: total - inserted - updated, errors };
}

/** Colunas do modelo, na ordem canônica — os títulos batem com os aliases do parser. */
const TEMPLATE_COLUMNS: readonly { header: string; width: number }[] = [
  { header: 'Marca', width: 16 },
  { header: 'Modelo', width: 18 },
  { header: 'Versão', width: 20 },
  { header: 'Ano', width: 8 },
  { header: 'Ano Modelo', width: 12 },
  { header: 'Preço', width: 14 },
  { header: 'KM', width: 10 },
  { header: 'Cor', width: 12 },
  { header: 'Combustível', width: 14 },
  { header: 'Câmbio', width: 14 },
  { header: 'Final de Placa', width: 14 },
  { header: 'Condição', width: 12 },
  { header: 'Destaques', width: 42 },
  { header: 'ID Externo', width: 14 },
];

const TEMPLATE_EXAMPLES: readonly (string | number)[][] = [
  [
    'Volkswagen',
    'Nivus',
    'Highline 1.0 TSI',
    2024,
    2025,
    'R$ 89.900,00',
    '45.000',
    'Prata',
    'Flex',
    'Automático',
    '7',
    'Usado',
    'Único dono, revisado; IPVA 2026 pago; Garantia de fábrica',
    'EST-1024',
  ],
  [
    'Fiat',
    'Pulse',
    'Drive 1.3',
    2026,
    2026,
    109900,
    0,
    'Branco',
    'Flex',
    'Automático',
    '3',
    'Novo',
    'Zero km | Pronta entrega',
    'EST-1025',
  ],
];

/** Gera a planilha modelo on-the-fly (nada de fixture binário no repo). */
export async function buildImportTemplateXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Cognito AI';
  const sheet = workbook.addWorksheet('Catálogo');

  sheet.columns = TEMPLATE_COLUMNS.map((column) => ({
    header: column.header,
    width: column.width,
  }));
  sheet.getRow(1).font = { bold: true };
  for (const example of TEMPLATE_EXAMPLES) sheet.addRow(example);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
