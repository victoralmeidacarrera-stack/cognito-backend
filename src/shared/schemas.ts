import { z } from 'zod';

// ──────────────────────────────────────────────
// Schemas compartilhados (entrada/saída de API)
// ──────────────────────────────────────────────

// Id opaco (Prisma gera cuid, mas o seed usa ids legíveis como 'veh_demo').
// Não validamos o FORMATO: integridade referencial é papel do lookup/FK —
// validar cuid aqui só impedia usar os dados do seed pela API.
export const cuidSchema = z.string().min(1).max(64);

export const idParamSchema = z.object({
  id: cuidSchema,
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(20),
});
export type Pagination = z.infer<typeof paginationSchema>;

// ──────────────────────────────────────────────
// Schema de SAÍDA do Claude (briefing → copy)
// Validado antes de persistir em Briefing.aiOutput / Creative.copy.
// ──────────────────────────────────────────────

export const claudeOutputSchema = z.object({
  headline: z.string().min(1).max(120),
  sub_headline: z.string().min(1).max(160),
  descricao: z.string().min(1).max(2200),
  cta: z.string().min(1).max(40),
  variacoes: z.object({
    headline: z.array(z.string().min(1).max(120)).min(1),
    cta: z.array(z.string().min(1).max(40)).min(1),
  }),
  emoji_sugerido: z.string().min(1).max(16),
  justificativa: z.string().min(1).max(1000),
});

export type ClaudeOutput = z.infer<typeof claudeOutputSchema>;

/** Copy de uma única variação (template + copy pareados → 1 Creative). */
export const creativeCopySchema = z.object({
  headline: z.string().min(1).max(120),
  cta: z.string().min(1).max(40),
  sub_headline: z.string().max(160).optional(),
  descricao: z.string().max(2200).optional(),
  emoji_sugerido: z.string().max(16).optional(),
});

export type CreativeCopy = z.infer<typeof creativeCopySchema>;
