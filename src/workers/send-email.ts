import { type Job } from 'bullmq';
import { logger } from '../config/logger.js';
import { sendEmailPayloadSchema } from '../modules/jobs/job-payloads.js';
import { sendEmail } from '../modules/notifications/notifications.service.js';

export async function processSendEmail(job: Job): Promise<void> {
  const payload = sendEmailPayloadSchema.parse(job.data);
  await sendEmail({ to: payload.to, subject: payload.subject, html: payload.html });
  logger.child({ worker: 'send-email' }).info({ to: payload.to }, 'email enviado');
}
