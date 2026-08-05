import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `redisConnectionOptions()` é o que o BullMQ recebe (objeto de opções, nunca
 * uma instância ioredis). Ele remonta a URL peça por peça, então TUDO que só
 * existir na query string precisa ser propagado à mão — senão o client global
 * (que recebe a URL inteira) e o BullMQ ficam com configurações diferentes.
 * O caso crítico é `family=0`, obrigatório no private networking IPv6-only do
 * Redis interno do Railway.
 *
 * A função lê `env.REDIS_URL` no momento da chamada, mas o `env` é congelado no
 * import — por isso cada caso reimporta o módulo com NODE_ENV=production
 * (pula o loadEnvFile do .env da máquina) e a URL stubada.
 */
async function optionsFor(redisUrl: string) {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('REDIS_URL', redisUrl);
  const { redisConnectionOptions } = await import('../src/config/redis.js');
  return redisConnectionOptions();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('redisConnectionOptions', () => {
  it('desmonta a URL básica (sem query)', async () => {
    const options = await optionsFor('redis://localhost:6379');

    expect(options).toEqual({
      host: 'localhost',
      port: 6379,
      maxRetriesPerRequest: null,
    });
  });

  it('propaga family=0 da query string (Railway interno, IPv6-only)', async () => {
    const options = await optionsFor(
      'redis://default:senha@cognito.redis.railway.internal:6379?family=0',
    );

    // 0 é valor VÁLIDO: qualquer checagem por falsy o descartaria.
    expect(options.family).toBe(0);
    expect(options.host).toBe('cognito.redis.railway.internal');
    expect(options.username).toBe('default');
    expect(options.password).toBe('senha');
    expect(options.maxRetriesPerRequest).toBeNull();
  });

  it('propaga db e connectTimeout', async () => {
    const options = await optionsFor('redis://localhost:6379?db=3&connectTimeout=15000');

    expect(options.db).toBe(3);
    expect(options.connectTimeout).toBe(15_000);
  });

  it('ignora valores não-numéricos sem virar NaN', async () => {
    const options = await optionsFor('redis://localhost:6379?family=abc&db=&connectTimeout=1.5');

    expect(options).not.toHaveProperty('family');
    expect(options).not.toHaveProperty('db');
    expect(options).not.toHaveProperty('connectTimeout');
  });

  it('ignora query params desconhecidos sem quebrar', async () => {
    const options = await optionsFor('redis://localhost:6379?family=0&foo=bar&ssl=true');

    expect(options.family).toBe(0);
    expect(options).not.toHaveProperty('foo');
    expect(options).not.toHaveProperty('ssl');
  });

  it('liga TLS pelo protocolo rediss: e mantém as opções da query (Upstash)', async () => {
    const options = await optionsFor('rediss://default:token@fake.upstash.io:6379?family=0');

    expect(options.tls).toEqual({});
    expect(options.port).toBe(6379);
    expect(options.family).toBe(0);
  });

  it('sem porta na URL cai no 6379 e sem rediss não liga TLS', async () => {
    const options = await optionsFor('redis://localhost');

    expect(options.port).toBe(6379);
    expect(options).not.toHaveProperty('tls');
  });
});
