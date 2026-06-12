import { type UserRole } from '@prisma/client';
import { type ErrorCode } from './errors.js';

/**
 * Contexto de tenant resolvido a partir da autenticação (Clerk, Fase 2).
 * Carregado em request.ctx por um middleware e propagado para os services,
 * que repassam organizationId aos repositories (isolamento multi-tenant).
 */
export interface RequestContext {
  organizationId: string;
  userId: string;
  role: UserRole;
}

/** Envelope de erro padrão retornado pela API. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
