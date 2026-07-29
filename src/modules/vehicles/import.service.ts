import ExcelJS from 'exceljs';
import { type Prisma } from '@prisma/client';
import { type TenantPrisma } from '../../config/tenant.js';
import { logger } from '../../config/logger.js';
import { DomainError } from '../../shared/errors.js';
import { type ImportRowError, parseVehicleImport } from './import.parser.js';

/**
 * Falhas de escrita SEGUIDAS que fazem o import desistir. Uma linha ruim é
 * problema do dado; dez seguidas é o Postgres fora do ar — nesse caso devolver
 * 200 com "N linhas não puderam ser salvas" mente para o usuário e não alerta
 * ninguém. Abaixo desse teto o import continua parcial, como decidido.
 */
const MAX_CONSECUTIVE_WRITE_FAILURES = 10;

/**
 * Acima disso, a planilha PRECISA da coluna "ID Externo". Sem ela não há chave
 * para casar as linhas: se a conexão cair no meio (import é síncrono e pode
 * passar de um minuto em base remota) e o usuário reenviar o arquivo, tudo é
 * recriado e o estoque fica em dobro. Com o ID, reenviar é idempotente.
 */
const REQUIRE_EXTERNAL_ID_ABOVE = 200;

/** Teto de erros no relatório — 2000 linhas ruins gerariam centenas de KB. */
const MAX_REPORTED_ERRORS = 200;

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
  let consecutiveFailures = 0;

  // Planilha grande sem nenhuma chave externa: recusar é melhor que aceitar e
  // deixar o retry duplicar o estoque inteiro (ver REQUIRE_EXTERNAL_ID_ABOVE).
  if (
    parsed.rows.length > REQUIRE_EXTERNAL_ID_ABOVE &&
    parsed.rows.every(({ data }) => !data.externalId)
  ) {
    throw new DomainError(
      `Planilhas com mais de ${REQUIRE_EXTERNAL_ID_ABOVE} veículos precisam da coluna "ID Externo" (o código do veículo no seu sistema de estoque). Sem ela não é possível identificar o que já foi importado, e reenviar o arquivo duplicaria o catálogo.`,
    );
  }

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
      consecutiveFailures = 0;
    } catch (error) {
      // Falha de escrita de uma linha não derruba o import inteiro, mas precisa
      // aparecer no pino/Sentry: sem log, banco fora do ar virava um 200 com
      // 2000 erros iguais e nenhum rastro do motivo real.
      consecutiveFailures += 1;
      logger.warn({ err: error, row, consecutiveFailures }, 'falha ao gravar linha do import');

      if (consecutiveFailures >= MAX_CONSECUTIVE_WRITE_FAILURES) {
        // `error` (não `warn`): aqui o import inteiro morreu. Nota: o projeto
        // não tem captureException do Sentry, então isto é stdout do Railway —
        // não é alerta. Ver docs/RUNBOOK.md.
        logger.error(
          { err: error, inserted, updated },
          'import abortado após falhas de escrita consecutivas',
        );
        throw new DomainError(
          `A importação foi interrompida: não foi possível gravar no banco de dados. ${inserted + updated} veículo(s) chegaram a ser salvos antes da falha; o restante não foi processado. Tente novamente em alguns minutos.`,
        );
      }
      errors.push({ row, field: null, message: 'Não foi possível salvar esta linha.' });
    }
  }

  // O relatório é truncado, mas os contadores acima continuam completos — e a
  // truncagem precisa aparecer: sem a linha sintética, `skipped: 800` com 200
  // erros listados parecia bug do sistema, não limite de exibição.
  const reported = errors.slice(0, MAX_REPORTED_ERRORS);
  if (errors.length > MAX_REPORTED_ERRORS) {
    reported.push({
      row: 0,
      field: null,
      message: `... e mais ${errors.length - MAX_REPORTED_ERRORS} linha(s) com erro. Corrija as listadas acima e importe de novo para ver o restante.`,
    });
  }

  return {
    total,
    inserted,
    updated,
    skipped: total - inserted - updated,
    errors: reported,
  };
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
