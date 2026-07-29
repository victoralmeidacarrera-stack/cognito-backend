import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { MAX_IMPORT_ROWS, parseVehicleImport } from '../src/modules/vehicles/import.parser.js';
import { importVehiclesFromXlsx } from '../src/modules/vehicles/import.service.js';
import type { TenantPrisma } from '../src/config/tenant.js';

type Cell = string | number | null;

/**
 * Monta o .xlsx em memória (nada de fixture binário no repo). As linhas são
 * endereçadas pelo número real do Excel — é isso que os testes de `row` exigem.
 */
async function buildXlsx(rows: [number, Cell[]][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Estoque');
  for (const [rowNumber, values] of rows) sheet.getRow(rowNumber).values = values;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Cabeçalho + linhas de dados a partir da linha 2. */
function sheet(header: Cell[], ...dataRows: Cell[][]): [number, Cell[]][] {
  return [[1, header], ...dataRows.map((values, i): [number, Cell[]] => [i + 2, values])];
}

const parse = async (rows: [number, Cell[]][]) => parseVehicleImport(await buildXlsx(rows));

describe('parseVehicleImport — cabeçalho', () => {
  it('reconhece aliases com acento, maiúsculas e ignora coluna desconhecida', async () => {
    const result = await parse(
      sheet(
        [
          'MARCA',
          'Modelo',
          'Ano de Fabricação',
          'ANO MODELO',
          'Preço de venda',
          'Quilometragem',
          'Câmbio',
          'Final de Placa',
          'Condição',
          'Opcionais',
          'ID Externo',
          'Vendedor responsável',
        ],
        [
          'Volkswagen',
          'Nivus',
          2024,
          2025,
          'R$ 89.900,00',
          '45.000 km',
          'Automático',
          '7',
          'Seminovo',
          'Único dono, revisado; IPVA 2026 pago',
          'EST-1024',
          'Lincoln',
        ],
      ),
    );

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.row).toBe(2);
    expect(result.rows[0]?.data).toEqual({
      make: 'Volkswagen',
      model: 'Nivus',
      year: 2024,
      modelYear: 2025,
      priceCents: 8_990_000,
      mileageKm: 45_000,
      transmission: 'Automático',
      plateEnding: '7',
      condition: 'USED',
      highlights: ['Único dono, revisado', 'IPVA 2026 pago'],
      externalId: 'EST-1024',
    });
  });

  it('não confunde aliases parecidos (ano x ano modelo, final x final de placa, id x id externo)', async () => {
    const result = await parse(
      sheet(
        ['Marca', 'Modelo', 'Ano', 'Ano Modelo', 'Final', 'ID'],
        ['Fiat', 'Pulse', 2025, 2026, '3', 'ABC-9'],
      ),
    );

    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.data).toMatchObject({
      year: 2025,
      modelYear: 2026,
      plateEnding: '3',
      externalId: 'ABC-9',
    });
  });

  it('aborta quando o cabeçalho não tem marca nem modelo', async () => {
    const buffer = await buildXlsx(sheet(['Coluna A', 'Coluna B'], ['x', 'y']));
    await expect(parseVehicleImport(buffer)).rejects.toThrow(/cabeçalho não reconhecido/i);
  });

  it('diz qual coluna obrigatória falta quando só uma das duas existe', async () => {
    // Antes o cabeçalho passava com só uma delas e o dono da loja recebia um
    // relatório com TODAS as linhas em "Campo obrigatório", sem entender o motivo.
    const semMarca = await buildXlsx(sheet(['Modelo', 'Ano'], ['Nivus', 2024]));
    await expect(parseVehicleImport(semMarca)).rejects.toThrow(/coluna "Marca"/i);

    const semModelo = await buildXlsx(sheet(['Marca', 'Ano'], ['VW', 2024]));
    await expect(parseVehicleImport(semModelo)).rejects.toThrow(/coluna "Modelo"/i);
  });

  it('recusa arquivo que não é .xlsx sem vazar exceção do exceljs', async () => {
    await expect(parseVehicleImport(Buffer.from('isto não é uma planilha'))).rejects.toThrow(
      /planilha/i,
    );
    await expect(parseVehicleImport(Buffer.alloc(0))).rejects.toThrow(/vazio/i);
  });
});

describe('parseVehicleImport — valores', () => {
  const priceSheet = (price: Cell): [number, Cell[]][] =>
    sheet(['Marca', 'Modelo', 'Ano', 'Preço'], ['VW', 'Nivus', 2024, price]);

  it('converte preço pt-BR, inteiro em texto e célula numérica para centavos', async () => {
    const nbsp = String.fromCharCode(0x00a0); // o Excel/Intl separa "R$" do número com NBSP
    for (const price of [
      'R$ 89.900,00',
      '89900',
      89900,
      'R$ 89.900',
      '89.900,00',
      `R$${nbsp}89.900,00`,
    ]) {
      const result = await parse(priceSheet(price));
      expect(result.errors).toEqual([]);
      expect(result.rows[0]?.data.priceCents).toBe(8_990_000);
    }
  });

  it('aceita centavos de verdade e reporta preço ilegível', async () => {
    expect((await parse(priceSheet('R$ 1.234,56'))).rows[0]?.data.priceCents).toBe(123_456);
    expect((await parse(priceSheet(1234.56))).rows[0]?.data.priceCents).toBe(123_456);

    const invalid = await parse(priceSheet('sob consulta'));
    expect(invalid.rows).toHaveLength(0);
    expect(invalid.errors[0]).toMatchObject({ row: 2, field: 'priceCents' });
  });

  it('lê km com ponto de milhar, sufixo e célula numérica', async () => {
    const kmSheet = (km: Cell): [number, Cell[]][] =>
      sheet(['Marca', 'Modelo', 'Ano', 'KM'], ['VW', 'Nivus', 2024, km]);

    for (const km of ['45.000 km', '45000', 45000, '45.000']) {
      expect((await parse(kmSheet(km))).rows[0]?.data.mileageKm).toBe(45_000);
    }
  });

  // Regressão: a vírgula de milhar en-US era lida como decimal e o preço entrava
  // 1000x menor SEM erro no relatório — R$ 89.900 virava R$ 89,90 num criativo
  // publicado. Export de DMS que passou por Google Sheets/LibreOffice traz isso.
  it('lê vírgula de milhar (en-US) como milhar, não como decimal', async () => {
    expect((await parse(priceSheet('89,900'))).rows[0]?.data.priceCents).toBe(8_990_000);
    expect((await parse(priceSheet('R$ 89,900'))).rows[0]?.data.priceCents).toBe(8_990_000);
    expect((await parse(priceSheet('1,299,000'))).rows[0]?.data.priceCents).toBe(129_900_000);

    const kmSheet = (km: Cell): [number, Cell[]][] =>
      sheet(['Marca', 'Modelo', 'Ano', 'KM'], ['VW', 'Nivus', 2024, km]);
    expect((await parse(kmSheet('45,000'))).rows[0]?.data.mileageKm).toBe(45_000);
  });

  it('mantém a vírgula decimal de verdade (2 casas) como decimal', async () => {
    // Só 3 dígitos exatos após o separador viram milhar; "89,90" é R$ 89,90.
    expect((await parse(priceSheet('89,90'))).rows[0]?.data.priceCents).toBe(8_990);
    expect((await parse(priceSheet('R$ 1.234,56'))).rows[0]?.data.priceCents).toBe(123_456);
  });

  it('recusa km e ano fracionários em vez de arredondar em silêncio', async () => {
    // Fracionário aqui é sintoma de separador lido errado, não de dado "quebrado".
    const kmSheet = (km: Cell): [number, Cell[]][] =>
      sheet(['Marca', 'Modelo', 'Ano', 'KM'], ['VW', 'Nivus', 2024, km]);
    const km = await parse(kmSheet('1,5'));
    expect(km.rows).toHaveLength(0);
    expect(km.errors[0]).toMatchObject({ row: 2, field: 'mileageKm' });

    const year = await parse(sheet(['Marca', 'Modelo', 'Ano'], ['VW', 'Nivus', '2024,5']));
    expect(year.rows).toHaveLength(0);
    expect(year.errors[0]).toMatchObject({ row: 2, field: 'year' });
  });

  it('mapeia todas as variantes de condição e erra na desconhecida', async () => {
    const conditionSheet = (condition: Cell): [number, Cell[]][] =>
      sheet(['Marca', 'Modelo', 'Ano', 'Condição'], ['VW', 'Nivus', 2024, condition]);

    for (const label of ['novo', 'NOVO', 'New', '0km', 'zero km', '0 km']) {
      expect((await parse(conditionSheet(label))).rows[0]?.data.condition).toBe('NEW');
    }
    for (const label of ['usado', 'Seminovo', 'semi-novo', 'SEMI NOVO', 'Used']) {
      expect((await parse(conditionSheet(label))).rows[0]?.data.condition).toBe('USED');
    }

    // Vazio omite o campo (o default do schema/Prisma resolve).
    const empty = await parse(conditionSheet('   '));
    expect(empty.errors).toEqual([]);
    expect(empty.rows[0]?.data.condition).toBeUndefined();

    const invalid = await parse(conditionSheet('batido'));
    expect(invalid.rows).toHaveLength(0);
    expect(invalid.errors).toHaveLength(1);
    expect(invalid.errors[0]).toMatchObject({ row: 2, field: 'condition' });
    expect(invalid.errors[0]?.message).toContain('Condição não reconhecida');
  });

  it('quebra destaques por ; | e quebra de linha, mas nunca por vírgula', async () => {
    const highlightSheet = (highlights: Cell): [number, Cell[]][] =>
      sheet(['Marca', 'Modelo', 'Ano', 'Destaques'], ['VW', 'Nivus', 2024, highlights]);

    expect((await parse(highlightSheet('Único dono; Revisado'))).rows[0]?.data.highlights).toEqual([
      'Único dono',
      'Revisado',
    ]);
    expect(
      (await parse(highlightSheet('Único dono | Revisado |'))).rows[0]?.data.highlights,
    ).toEqual(['Único dono', 'Revisado']);
    expect((await parse(highlightSheet('Único dono\nRevisado'))).rows[0]?.data.highlights).toEqual([
      'Único dono',
      'Revisado',
    ]);
    // Vírgula faz parte do texto: "Único dono, revisado" é um destaque só.
    expect((await parse(highlightSheet('Único dono, revisado'))).rows[0]?.data.highlights).toEqual([
      'Único dono, revisado',
    ]);
  });

  it('reduz célula rica (fórmula, hyperlink, rich text) a texto', async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Estoque');
    worksheet.getRow(1).values = ['Marca', 'Modelo', 'Ano', 'Preço', 'ID'];
    worksheet.getRow(2).values = ['VW', 'Nivus', 2024, null, null];
    worksheet.getCell('B2').value = { richText: [{ text: 'Ni' }, { text: 'vus' }] };
    worksheet.getCell('D2').value = { formula: 'C2*0+89900', result: 89900 };
    worksheet.getCell('E2').value = { text: 'EST-77', hyperlink: 'https://dms.exemplo/77' };

    const result = await parseVehicleImport(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.data).toMatchObject({
      model: 'Nivus',
      priceCents: 8_990_000,
      externalId: 'EST-77',
    });
  });

  it('lê hyperlink cujo rótulo veio em rich text sem derrubar o import', async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Estoque');
    worksheet.getRow(1).values = ['Marca', 'Modelo', 'Ano', 'ID'];
    worksheet.getRow(2).values = ['VW', 'Nivus', 2024, null];
    // O index.d.ts do exceljs promete `text: string`, mas o leitor devolve o
    // objeto rich text quando parte do rótulo do link está formatada — caso real
    // de planilha de DMS que passou por Google Sheets/LibreOffice. O cast existe
    // porque a tipagem da lib não admite o que ela própria devolve.
    worksheet.getCell('D2').value = {
      text: { richText: [{ font: { bold: true }, text: 'EST' }, { text: '-9' }] },
      hyperlink: 'https://dms.exemplo/9',
    } as unknown as ExcelJS.CellValue;

    const result = await parseVehicleImport(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.data.externalId).toBe('EST-9');
  });

  it('ignora Date inválida do exceljs sem derrubar o arquivo inteiro', async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Estoque');
    worksheet.getRow(1).values = ['Marca', 'Modelo', 'Ano', 'ID Externo'];
    worksheet.getRow(2).values = ['VW', 'Nivus', 2024, 20240115123456];
    worksheet.getRow(3).values = ['Fiat', 20240115123456, 2025, 'EST-3'];
    worksheet.getRow(4).values = ['Fiat', 'Pulse', 2025, 'EST-2'];
    // Código de estoque de 14 dígitos numa coluna que herdou formato de data: o
    // leitor do exceljs devolve `Date` com `getTime()` NaN, e `toISOString()`
    // lança RangeError. A célula precisa virar ausente, não abortar o arquivo.
    worksheet.getCell('D2').numFmt = 'dd/mm/yyyy';
    worksheet.getCell('B3').numFmt = 'dd/mm/yyyy';

    const result = await parseVehicleImport(Buffer.from(await workbook.xlsx.writeBuffer()));

    // Linha 2 perde só o ID externo; linha 3 degrada para erro DE LINHA (ficou
    // sem modelo); linha 4 entra intacta — o import parcial sobrevive.
    expect(result.rows.map((row) => row.row)).toEqual([2, 4]);
    expect(result.rows[0]?.data.externalId).toBeUndefined();
    expect(result.rows[1]?.data).toMatchObject({ model: 'Pulse', externalId: 'EST-2' });
    expect(result.errors).toEqual([{ row: 3, field: 'model', message: 'Campo obrigatório.' }]);
  });

  it('não quebra quando a Date inválida está no cabeçalho', async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Estoque');
    worksheet.getRow(1).values = ['Marca', 'Modelo', 'Ano', 20240115123456];
    worksheet.getRow(2).values = ['VW', 'Nivus', 2024, 'EST-1'];
    // A mesma célula na linha 1: o mapeamento do cabeçalho roda FORA do
    // try/catch do parser, então um RangeError aqui viraria 500 na rota.
    worksheet.getCell('D1').numFmt = 'dd/mm/yyyy';

    const result = await parseVehicleImport(Buffer.from(await workbook.xlsx.writeBuffer()));

    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.data).toMatchObject({ make: 'VW', model: 'Nivus', year: 2024 });
  });

  it('trata string em branco como ausente, não como texto vazio', async () => {
    const result = await parse(
      sheet(['Marca', 'Modelo', 'Ano', 'Cor', 'Versão'], ['VW', 'Nivus', 2024, '   ', '']),
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.data.color).toBeUndefined();
    expect(result.rows[0]?.data.trim).toBeUndefined();
  });
});

describe('parseVehicleImport — linhas', () => {
  it('reporta a linha sem marca/modelo com o número real do Excel', async () => {
    const result = await parse(
      sheet(
        ['Marca', 'Modelo', 'Ano'],
        ['VW', 'Nivus', 2024],
        [null, null, 2020],
        ['Fiat', 'Pulse', 2025],
      ),
    );

    expect(result.rows.map((row) => row.row)).toEqual([2, 4]);
    expect(result.errors.map((error) => error.row)).toEqual([3, 3]);
    expect(result.errors.map((error) => error.field).sort()).toEqual(['make', 'model']);
    expect(result.errors[0]?.message).toBe('Campo obrigatório.');
  });

  it('ignora linha completamente vazia sem gerar erro e mantém a numeração', async () => {
    const result = await parse([
      [1, ['Marca', 'Modelo', 'Ano']],
      [2, ['VW', 'Nivus', 2024]],
      [3, [null, null, null]],
      [4, ['   ', '  ', '  ']],
      [5, ['Fiat', 'Pulse', 2025]],
    ]);

    expect(result.errors).toEqual([]);
    expect(result.rows.map((row) => row.row)).toEqual([2, 5]);
  });

  it('reporta ano inválido no campo certo', async () => {
    const result = await parse(sheet(['Marca', 'Modelo', 'Ano'], ['VW', 'Nivus', 'dois mil']));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ row: 2, field: 'year' });
    expect(result.errors[0]?.message).toContain('Ano inválido');
  });

  it('recusa a planilha acima do teto de linhas', async () => {
    const rows: [number, Cell[]][] = [[1, ['Marca', 'Modelo', 'Ano']]];
    for (let i = 0; i <= MAX_IMPORT_ROWS; i += 1) rows.push([i + 2, ['VW', 'Nivus', 2024]]);

    await expect(parseVehicleImport(await buildXlsx(rows))).rejects.toThrow(
      new RegExp(`mais de ${MAX_IMPORT_ROWS} linhas`),
    );
  });
});

// ── Service: upsert por externalId + dry-run ───────────────────────────────

interface FakeVehicle {
  id: string;
  externalId?: string | undefined;
}

/** Stub do tenant db: guarda os veículos "da org" em memória. */
function fakeDb(seed: FakeVehicle[] = []) {
  const stored = [...seed];
  const writes: string[] = [];
  const db = {
    vehicle: {
      findFirst: ({ where }: { where: { externalId?: string } }) =>
        Promise.resolve(stored.find((v) => v.externalId === where.externalId) ?? null),
      create: ({ data }: { data: { externalId?: string } }) => {
        const created = { id: `v${stored.length + 1}`, externalId: data.externalId };
        stored.push(created);
        writes.push(`create:${data.externalId ?? '-'}`);
        return Promise.resolve({ id: created.id });
      },
      updateMany: ({ where }: { where: { id: string } }) => {
        writes.push(`update:${where.id}`);
        return Promise.resolve({ count: 1 });
      },
    },
  } as unknown as TenantPrisma;
  return { db, stored, writes };
}

const catalogXlsx = (...rows: Cell[][]): Promise<Buffer> =>
  buildXlsx(sheet(['Marca', 'Modelo', 'Ano', 'ID Externo'], ...rows));

describe('importVehiclesFromXlsx', () => {
  it('cria o que não existe e atualiza pelo externalId da org', async () => {
    const { db, writes } = fakeDb([{ id: 'v-antigo', externalId: 'EST-1' }]);
    const file = await catalogXlsx(
      ['VW', 'Nivus', 2024, 'EST-1'],
      ['Fiat', 'Pulse', 2025, 'EST-2'],
    );

    const report = await importVehiclesFromXlsx(db, file, { dryRun: false });

    expect(report).toMatchObject({ total: 2, inserted: 1, updated: 1, skipped: 0, errors: [] });
    expect(writes).toEqual(['update:v-antigo', 'create:EST-2']);
  });

  it('externalId repetido no arquivo: o último vence (vira update)', async () => {
    const { db, writes } = fakeDb();
    const file = await catalogXlsx(['VW', 'Nivus', 2024, 'EST-9'], ['VW', 'Nivus', 2025, 'EST-9']);

    const report = await importVehiclesFromXlsx(db, file, { dryRun: false });

    expect(report).toMatchObject({ total: 2, inserted: 1, updated: 1, skipped: 0 });
    expect(writes).toEqual(['create:EST-9', 'update:v1']);
  });

  it('dryRun não escreve nada e ainda prevê o resultado', async () => {
    const { db, writes } = fakeDb([{ id: 'v-antigo', externalId: 'EST-1' }]);
    const file = await catalogXlsx(
      ['VW', 'Nivus', 2024, 'EST-1'],
      ['Fiat', 'Pulse', 2025, 'EST-2'],
      ['Fiat', 'Pulse', 2026, 'EST-2'],
    );

    const report = await importVehiclesFromXlsx(db, file, { dryRun: true });

    expect(report).toMatchObject({ total: 3, inserted: 1, updated: 2, skipped: 0 });
    expect(writes).toEqual([]);
  });

  it('conta linha inválida em skipped sem abortar o arquivo', async () => {
    const { db, writes } = fakeDb();
    const file = await catalogXlsx(
      ['VW', 'Nivus', 2024, 'EST-1'],
      [null, 'Pulse', 2025, 'EST-2'],
      ['Fiat', 'Argo', 2025, 'EST-3'],
    );

    const report = await importVehiclesFromXlsx(db, file, { dryRun: false });

    expect(report).toMatchObject({ total: 3, inserted: 2, updated: 0, skipped: 1 });
    expect(report.errors[0]).toMatchObject({ row: 3, field: 'make' });
    expect(writes).toEqual(['create:EST-1', 'create:EST-3']);
  });

  it('falha ao gravar uma linha não derruba as demais', async () => {
    const { db } = fakeDb();
    const explode = db.vehicle as unknown as {
      create: (args: { data: { externalId?: string } }) => Promise<{ id: string }>;
    };
    const original = explode.create;
    explode.create = (args) =>
      args.data.externalId === 'EST-2'
        ? Promise.reject(new Error('unique violation'))
        : original(args);

    const file = await catalogXlsx(
      ['VW', 'Nivus', 2024, 'EST-1'],
      ['Fiat', 'Pulse', 2025, 'EST-2'],
      ['Fiat', 'Argo', 2025, 'EST-3'],
    );

    const report = await importVehiclesFromXlsx(db, file, { dryRun: false });

    expect(report).toMatchObject({ total: 3, inserted: 2, updated: 0, skipped: 1 });
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatchObject({ row: 3, field: null });
    expect(report.errors[0]?.message).toContain('salvar');
  });

  it('aborta quando a escrita falha em série (banco fora do ar, não linha ruim)', async () => {
    // 10 falhas seguidas: devolver 200 com "N linhas não puderam ser salvas"
    // mentiria para o usuário e não alertaria ninguém.
    const { db } = fakeDb();
    const explode = db.vehicle as unknown as { create: () => Promise<{ id: string }> };
    explode.create = () => Promise.reject(new Error('connection terminated'));

    const rows = Array.from(
      { length: 15 },
      (_, i) => ['VW', 'Nivus', 2024, `EST-${i}`] as (string | number)[],
    );
    const file = await catalogXlsx(...rows);

    await expect(importVehiclesFromXlsx(db, file, { dryRun: false })).rejects.toThrow(
      /interrompida/i,
    );
  });

  it('exige a coluna ID Externo em planilha grande (senão o retry duplica o estoque)', async () => {
    const { db } = fakeDb();
    // 201 linhas sem nenhum externalId: sem chave, reenviar recria tudo.
    const rows = Array.from({ length: 201 }, () => ['VW', 'Nivus', 2024, ''] as (string | number)[]);
    const file = await catalogXlsx(...rows);

    await expect(importVehiclesFromXlsx(db, file, { dryRun: true })).rejects.toThrow(
      /ID Externo/i,
    );
  });
});
