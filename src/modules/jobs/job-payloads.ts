import { z } from 'zod';

export const generateCreativePayloadSchema = z.object({
  jobId: z.string(),
  organizationId: z.string(),
  briefingId: z.string(),
});
export type GenerateCreativePayload = z.infer<typeof generateCreativePayloadSchema>;

export const renderImagePayloadSchema = z.object({
  jobId: z.string().optional(),
  organizationId: z.string(),
  creativeId: z.string(),
});
export type RenderImagePayload = z.infer<typeof renderImagePayloadSchema>;

export const sendEmailPayloadSchema = z.object({
  organizationId: z.string().optional(),
  to: z.string().email(),
  subject: z.string(),
  html: z.string(),
});
export type SendEmailPayload = z.infer<typeof sendEmailPayloadSchema>;
