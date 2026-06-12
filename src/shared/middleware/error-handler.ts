import {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { ZodError } from 'zod';
import { type AppError, isAppError } from '../errors.js';
import { type ApiErrorBody } from '../types.js';

function sendError(reply: FastifyReply, status: number, body: ApiErrorBody['error']): FastifyReply {
  return reply.status(status).send({ error: body });
}

/**
 * Error handler global. Traduz qualquer erro num envelope { error } consistente.
 * Erros não-operacionais (inesperados) viram 500 e são logados com stack.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    // 1. Erros de validação do zod (schemas próprios nos services/handlers)
    if (error instanceof ZodError) {
      request.log.info({ issues: error.issues }, 'validation error');
      return sendError(reply, 400, {
        code: 'VALIDATION_ERROR',
        message: 'Dados inválidos.',
        details: error.issues,
        requestId: request.id,
      });
    }

    // 2. Erros tipados do domínio
    if (isAppError(error)) {
      const appError: AppError = error;
      request.log.info({ code: appError.code, status: appError.statusCode }, appError.message);
      return sendError(reply, appError.statusCode, {
        code: appError.code,
        message: appError.message,
        ...(appError.details !== undefined ? { details: appError.details } : {}),
        requestId: request.id,
      });
    }

    // 3. Erros de validação nativos do Fastify (schema de rota)
    if (error.validation) {
      return sendError(reply, 400, {
        code: 'VALIDATION_ERROR',
        message: error.message,
        details: error.validation,
        requestId: request.id,
      });
    }

    // 4. Erros HTTP do Fastify/@fastify/sensible (têm statusCode < 500)
    if (typeof error.statusCode === 'number' && error.statusCode < 500) {
      return sendError(reply, error.statusCode, {
        code: 'DOMAIN_ERROR',
        message: error.message,
        requestId: request.id,
      });
    }

    // 5. Inesperado → 500, log completo com stack
    request.log.error({ err: error }, 'unhandled error');
    return sendError(reply, 500, {
      code: 'INTERNAL',
      message: 'Erro interno. A equipe foi notificada.',
      requestId: request.id,
    });
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    return sendError(reply, 404, {
      code: 'NOT_FOUND',
      message: `Rota ${request.method} ${request.url} não encontrada.`,
      requestId: request.id,
    });
  });
}
