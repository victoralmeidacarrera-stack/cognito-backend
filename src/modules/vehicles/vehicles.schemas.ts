import { z } from 'zod';

/** Fonte única do contrato de veículo: a rota valida o body e o import valida CADA linha da planilha com este mesmo schema. */
export const createVehicleSchema = z.object({
  make: z.string().min(1).max(100),
  model: z.string().min(1).max(100),
  trim: z.string().max(100).optional(),
  year: z.number().int().min(1950).max(2100),
  modelYear: z.number().int().min(1950).max(2100).optional(),
  priceCents: z.number().int().nonnegative().optional(),
  mileageKm: z.number().int().nonnegative().optional(),
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
