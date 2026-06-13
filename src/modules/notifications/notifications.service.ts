import { Resend } from 'resend';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { DomainError } from '../../shared/errors.js';
import { enqueueSendEmail } from '../jobs/jobs.service.js';

let client: Resend | null = null;

function getResend(): Resend {
  if (!env.RESEND_API_KEY) {
    throw new DomainError('Envio de email indisponível: RESEND_API_KEY não configurada.');
  }
  client ??= new Resend(env.RESEND_API_KEY);
  return client;
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const { error } = await getResend().emails.send({
    from: env.EMAIL_FROM,
    to: input.to,
    subject: input.subject,
    html: input.html,
  });
  if (error) {
    throw new DomainError(`Falha ao enviar email: ${error.message}`);
  }
}

/**
 * Avisa a org (owner/admin) que os criativos de um briefing foram gerados e
 * estão prontos para aprovação. No-op silencioso se Resend não está configurado.
 */
export async function notifyCreativesReady(input: {
  organizationId: string;
  briefingTitle: string;
  count: number;
}): Promise<void> {
  if (!env.RESEND_API_KEY) return;

  const recipient = await prisma.user.findFirst({
    where: { organizationId: input.organizationId },
    orderBy: { role: 'asc' }, // OWNER < ADMIN < MEMBER (ordem do enum)
    select: { email: true },
  });
  if (!recipient) return;

  await enqueueSendEmail({
    organizationId: input.organizationId,
    to: recipient.email,
    subject: `Seus ${input.count} criativos estão prontos para aprovação`,
    html: `<p>O briefing <strong>${input.briefingTitle}</strong> gerou ${input.count} criativos.</p><p>Acesse o painel para revisar e aprovar.</p>`,
  });
}
