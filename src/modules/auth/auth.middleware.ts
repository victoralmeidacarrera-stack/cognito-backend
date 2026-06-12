import { type UserRole } from '@prisma/client';
import { type FastifyReply, type FastifyRequest, type preHandlerHookHandler } from 'fastify';
import { authDevBypass, env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { tenantPrisma } from '../../config/tenant.js';
import { ForbiddenError, UnauthorizedError } from '../../shared/errors.js';
import { getCtx } from '../../shared/context.js';
import { extractBearerToken, verifyClerkToken } from './clerk.js';

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * preHandler de autenticação. Resolve o usuário (via Clerk ou bypass de dev),
 * popula request.ctx e request.db (Prisma isolado por org).
 */
export async function authenticate(request: FastifyRequest): Promise<void> {
  const token = extractBearerToken(request.headers.authorization);

  let clerkUserId: string | null = null;
  if (token && env.CLERK_SECRET_KEY) {
    clerkUserId = await verifyClerkToken(token);
  }

  let user: { id: string; organizationId: string; role: UserRole } | null = null;

  if (clerkUserId) {
    user = await prisma.user.findUnique({
      where: { clerkUserId },
      select: { id: true, organizationId: true, role: true },
    });
    if (!user) {
      throw new UnauthorizedError('Usuário não provisionado para este Clerk ID.');
    }
  } else if (authDevBypass) {
    // Identidade de dev: header x-dev-user-id ou o admin demo do seed.
    const devUserId = headerValue(request.headers['x-dev-user-id']) ?? 'user_admin_demo';
    user = await prisma.user.findUnique({
      where: { id: devUserId },
      select: { id: true, organizationId: true, role: true },
    });
    if (!user) {
      throw new UnauthorizedError('Usuário de dev não encontrado (rodou o seed?).');
    }
  } else {
    throw new UnauthorizedError('Credenciais ausentes.');
  }

  // Em dev, permite forçar a org via header (teste de multi-tenant).
  const orgOverride = authDevBypass ? headerValue(request.headers['x-dev-org-id']) : undefined;
  const organizationId = orgOverride ?? user.organizationId;

  request.ctx = { organizationId, userId: user.id, role: user.role };
  request.db = tenantPrisma(organizationId);
}

/** Guard de papel: exige que o usuário tenha um dos papéis informados. */
export function requireRole(...roles: UserRole[]): preHandlerHookHandler {
  return function roleGuard(request: FastifyRequest, _reply: FastifyReply, done) {
    const ctx = getCtx(request);
    if (!roles.includes(ctx.role)) {
      throw new ForbiddenError(`Requer papel: ${roles.join(' ou ')}.`);
    }
    done();
  };
}
