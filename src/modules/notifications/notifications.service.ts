import { Resend } from 'resend';
import { env } from '../../config/env.js';
import { DomainError } from '../../shared/errors.js';

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
