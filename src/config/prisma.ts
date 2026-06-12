import { PrismaClient } from '@prisma/client';
import { isProduction } from './env.js';

// Singleton do PrismaClient. Em dev, reaproveita a instância entre hot-reloads
// (tsx watch) para não estourar conexões.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProduction ? ['error'] : ['warn', 'error'],
  });

if (!isProduction) {
  globalForPrisma.prisma = prisma;
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

/** Ping com timeout curto para o health check (não pendura o readiness). */
export async function checkDatabase(timeoutMs = 1500): Promise<boolean> {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('database ping timeout')), timeoutMs),
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}
