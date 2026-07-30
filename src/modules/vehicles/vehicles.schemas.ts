import { z } from 'zod';

/** Fonte única do contrato de veículo: a rota valida o body e o import valida CADA linha da planilha com este mesmo schema. */
export const createVehicleSchema = z.object({
  make: z.string().min(1).max(100),
  model: z.string().min(1).max(100),
  trim: z.string().max(100).optional(),
  year: z.number().int().min(1950).max(2100),
  modelYear: z.number().int().min(1950).max(2100).optional(),
  // Teto = int4 do Postgres (`Int` no schema.prisma). Sem ele, um preço em 3
  // casas decimais na planilha ("89900,000" → 8,99e9 centavos) estourava a
  // coluna só na hora do INSERT: virava falha de escrita opaca em vez de erro
  // de linha com motivo, e 10 linhas assim disparavam o abort por "banco fora
  // do ar" — que nunca se resolveria sozinho. R$ 21 milhões cobre qualquer carro.
  priceCents: z.number().int().nonnegative().max(2_147_483_647).optional(),
  mileageKm: z.number().int().nonnegative().max(2_147_483_647).optional(),
  color: z.string().max(60).optional(),
  fuel: z.string().max(40).optional(),
  transmission: z.string().max(40).optional(),
  plateEnding: z.string().max(4).optional(),
  condition: z.enum(['NEW', 'USED']).optional(),
  highlights: z.array(z.string().max(120)).optional(),
  externalId: z.string().max(120).optional(),
});
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;

export const updateVehicleSchema = createVehicleSchema.partial();

export const importVehiclesSchema = z.object({
  fileBase64: z.string().min(1),
  /** Só valida e devolve o relatório, sem escrever nada (prévia no front). */
  dryRun: z.boolean().optional(),
});

export const importReportSchema = z.object({
  total: z.number().int(),
  inserted: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  errors: z.array(
    z.object({
      /** Linha real da planilha (cabeçalho = 1), para o cliente achar no Excel. */
      row: z.number().int(),
      field: z.string().nullable(),
      message: z.string(),
    }),
  ),
});
