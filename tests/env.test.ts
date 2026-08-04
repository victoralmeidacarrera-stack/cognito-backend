import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * O default de COPY_PROVIDER é a decisão central do provedor de copy: quem
 * troca de provedor é o deploy (env var), então o schema é o único lugar que
 * garante o comportamento "sem env = fal".
 *
 * Estes testes NÃO podem depender do `env` do vitest.config.ts (que fixa
 * COPY_PROVIDER=fal) nem do .env da máquina — por isso reimportam o módulo com
 * NODE_ENV=production (pula o loadEnvFile) e a var apagada.
 */
describe('env — COPY_PROVIDER', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadEnv(copyProvider: string): Promise<{ COPY_PROVIDER: string }> {
    vi.resetModules();
    // production: env.ts não carrega o .env do disco (não haveria isolamento).
    vi.stubEnv('NODE_ENV', 'production');
    // String vazia = "ausente" para o schema (env.ts filtra antes do parse).
    vi.stubEnv('COPY_PROVIDER', copyProvider);
    const { env } = await import('../src/config/env.js');
    return env;
  }

  it('cai em fal quando não vem do ambiente', async () => {
    const env = await loadEnv('');
    expect(env.COPY_PROVIDER).toBe('fal');
  });

  it('respeita o provedor vindo do ambiente', async () => {
    const env = await loadEnv('anthropic');
    expect(env.COPY_PROVIDER).toBe('anthropic');
  });
});
