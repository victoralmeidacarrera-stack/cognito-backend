import { verifyToken } from '@clerk/backend';
import { env } from '../../config/env.js';
import { UnauthorizedError } from '../../shared/errors.js';

/**
 * Verifica um token de sessão do Clerk e devolve o clerkUserId (claim `sub`).
 * Lança UnauthorizedError em token inválido/expirado.
 */
export async function verifyClerkToken(token: string): Promise<string> {
  if (!env.CLERK_SECRET_KEY) {
    throw new UnauthorizedError('Auth indisponível: CLERK_SECRET_KEY não configurada.');
  }

  try {
    const payload = await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY });
    if (!payload.sub) {
      throw new UnauthorizedError('Token sem subject.');
    }
    return payload.sub;
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError('Token inválido ou expirado.');
  }
}

/** Extrai o bearer token do header Authorization. */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}
