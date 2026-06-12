import { z } from 'zod';
import { cuidSchema, paginationSchema } from '../../shared/schemas.js';

export const createBriefingSchema = z.object({
  campaignId: cuidSchema,
  title: z.string().min(1).max(200),
  format: z.enum(['FEED', 'STORIES']).default('FEED'),
  vehicleId: cuidSchema.optional(),
  brandBookId: cuidSchema.optional(),
  requestedVariations: z.number().int().positive().max(50).default(6),
  input: z.record(z.string(), z.unknown()).default({}),
});
export type CreateBriefingInput = z.infer<typeof createBriefingSchema>;

export const listBriefingsQuerySchema = paginationSchema.extend({
  campaignId: cuidSchema.optional(),
});
export type ListBriefingsQuery = z.infer<typeof listBriefingsQuerySchema>;
