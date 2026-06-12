/**
 * Hierarquia de erros tipados do domínio.
 * Todo erro lançado pela aplicação deve ser (ou derivar de) AppError, para que
 * o error handler global o traduza num envelope HTTP consistente.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'DOMAIN_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: ErrorCode;
  /** Detalhes seguros para expor ao cliente (ex.: issues de validação). */
  readonly details?: unknown;
  /** Erros operacionais são esperados; não-operacionais viram 500 + alerta. */
  readonly isOperational: boolean = true;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    if (details !== undefined) {
      this.details = details;
    }
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  readonly statusCode = 400;
  readonly code = 'VALIDATION_ERROR';
}

export class DomainError extends AppError {
  readonly statusCode = 422;
  readonly code = 'DOMAIN_ERROR';
}

export class NotFoundError extends AppError {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';

  constructor(resource = 'Recurso', details?: unknown) {
    super(`${resource} não encontrado.`, details);
  }
}

export class UnauthorizedError extends AppError {
  readonly statusCode = 401;
  readonly code = 'UNAUTHORIZED';

  constructor(message = 'Não autenticado.', details?: unknown) {
    super(message, details);
  }
}

export class ForbiddenError extends AppError {
  readonly statusCode = 403;
  readonly code = 'FORBIDDEN';

  constructor(message = 'Acesso negado.', details?: unknown) {
    super(message, details);
  }
}

export class ConflictError extends AppError {
  readonly statusCode = 409;
  readonly code = 'CONFLICT';
}

/** Quota de variações estourada — bloqueia geração. */
export class QuotaExceededError extends AppError {
  readonly statusCode = 402;
  readonly code = 'QUOTA_EXCEEDED';

  constructor(message = 'Quota de variações excedida.', details?: unknown) {
    super(message, details);
  }
}

export class RateLimitError extends AppError {
  readonly statusCode = 429;
  readonly code = 'RATE_LIMITED';
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
