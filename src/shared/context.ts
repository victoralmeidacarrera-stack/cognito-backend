import { type FastifyRequest } from 'fastify';
import { type TenantPrisma } from '../config/tenant.js';
import { UnauthorizedError } from './errors.js';
import { type RequestContext } from './types.js';

// Augmenta o request com o contexto de tenant e o client Prisma já isolado.
declare module 'fastify' {
  interface FastifyRequest {
    ctx?: RequestContext;
    /** Prisma com organizationId injetado automaticamente. */
    db?: TenantPrisma;
  }
}

/** Recupera o contexto autenticado ou falha (rota protegida sem auth). */
export function getCtx(request: FastifyRequest): RequestContext {
  if (!request.ctx) {
    throw new UnauthorizedError('Contexto de autenticação ausente.');
  }
  return request.ctx;
}

/** Recupera o client Prisma isolado por org. */
export function getTenantDb(request: FastifyRequest): TenantPrisma {
  if (!request.db) {
    throw new UnauthorizedError('Client de tenant ausente.');
  }
  return request.db;
}
