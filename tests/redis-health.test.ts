import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `checkRedis()` é o readiness. Ele NÃO pode se contentar com PING: em
 * 03/08/2026 o Upstash estourou a cota mensal do free tier
 * (`ERR max requests limit exceeded. Limit: 500000`), continuou respondendo
 * PING — e recusou os comandos do BullMQ. O `/health/ready` ficou verde
 * enquanto a geração devolvia erro.
 *
 * O probe faz uma escrita com TTL (1 comando no caminho feliz) e só gasta um
 * PING extra quando a escrita falha, para separar "mudo" de "recusa escrita".
 */

const { setMock, pingMock } = vi.hoisted(() => ({
  setMock: vi.fn<(...args: unknown[]) => Promise<string>>(),
  pingMock: vi.fn<() => Promise<string>>(),
}));

vi.mock('ioredis', () => {
  class FakeRedis {
    on = vi.fn();
    quit = vi.fn(() => Promise.resolve('OK'));
    set = setMock;
    ping = pingMock;
  }
  return { Redis: FakeRedis, default: FakeRedis };
});

/** Módulo novo a cada caso: o cache do health vive em escopo de módulo. */
async function freshCheckRedis() {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('REDIS_URL', 'rediss://default:token@fake.upstash.io:6379');
  const { checkRedis } = await import('../src/config/redis.js');
  return checkRedis;
}

/** Erro no formato que o ioredis devolve quando o servidor recusa o comando. */
function replyError(message: string): Error {
  const err = new Error(message);
  err.name = 'ReplyError';
  return err;
}

beforeEach(() => {
  setMock.mockReset().mockResolvedValue('OK');
  pingMock.mockReset().mockResolvedValue('PONG');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('checkRedis', () => {
  it('caminho feliz: 1 comando (SET com TTL), sem PING', async () => {
    const checkRedis = await freshCheckRedis();

    const health = await checkRedis();

    expect(health).toEqual({ ok: true, responds: true, acceptsWrites: true });
    expect(setMock).toHaveBeenCalledTimes(1);
    expect(pingMock).not.toHaveBeenCalled();
    // A chave é própria do health e expira sozinha (PX), não vira lixo.
    expect(setMock).toHaveBeenCalledWith('cognito:health:probe', expect.any(String), 'PX', 30_000);
  });

  it('cota do Upstash estourada: PING responde, escrita não — readiness degradado', async () => {
    const checkRedis = await freshCheckRedis();
    setMock.mockRejectedValue(
      replyError('ERR max requests limit exceeded. Limit: 500000, Usage: 500000'),
    );

    const health = await checkRedis();

    expect(health.ok).toBe(false);
    expect(health.responds).toBe(true);
    expect(health.acceptsWrites).toBe(false);
    expect(health.error).toContain('max requests limit exceeded');
    // Só o caminho de falha gasta o 2º comando.
    expect(pingMock).toHaveBeenCalledTimes(1);
  });

  it('servidor mudo: nem escrita nem PING', async () => {
    const checkRedis = await freshCheckRedis();
    setMock.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:6379'));
    pingMock.mockRejectedValue(new Error('Connection is closed.'));

    const health = await checkRedis();

    expect(health).toEqual({
      ok: false,
      responds: false,
      acceptsWrites: false,
      error: 'connect ECONNREFUSED 127.0.0.1:6379',
    });
  });

  it('nunca lança e não pendura: escrita travada cai no timeout', async () => {
    const checkRedis = await freshCheckRedis();
    setMock.mockImplementation(() => new Promise<string>(() => {}));
    pingMock.mockImplementation(() => new Promise<string>(() => {}));

    const health = await checkRedis(20);

    expect(health.ok).toBe(false);
    expect(health.error).toContain('timeout');
  });

  it('cacheia o resultado: chamadas seguidas não gastam cota de novo', async () => {
    const checkRedis = await freshCheckRedis();

    await checkRedis();
    await checkRedis();
    await checkRedis();

    expect(setMock).toHaveBeenCalledTimes(1);
  });

  it('o cache expira e o estado se recupera depois de um resultado negativo', async () => {
    const checkRedis = await freshCheckRedis();
    const start = Date.now();
    // `Date.now` stubado (e não fake timers) porque o probe usa setTimeout de
    // verdade para o timeout — o cache é que precisa envelhecer.
    const now = vi.spyOn(Date, 'now').mockReturnValue(start);
    setMock.mockRejectedValueOnce(
      replyError('ERR max requests limit exceeded. Limit: 500000, Usage: 500000'),
    );

    const degraded = await checkRedis();
    expect(degraded.ok).toBe(false);

    // Dentro da janela de 15s o resultado ruim fica em cache (não gasta cota).
    await checkRedis();
    expect(setMock).toHaveBeenCalledTimes(1);

    // 16s depois o cache venceu: novo probe, e a cota tendo voltado, ok = true.
    // Sem isso o readiness ficaria preso em degraded até o processo reiniciar.
    now.mockReturnValue(start + 16_000);
    const recovered = await checkRedis();

    expect(recovered).toEqual({ ok: true, responds: true, acceptsWrites: true });
    expect(setMock).toHaveBeenCalledTimes(2);
  });

  it('chamadas concorrentes compartilham o mesmo probe', async () => {
    const checkRedis = await freshCheckRedis();

    const [a, b] = await Promise.all([checkRedis(), checkRedis()]);

    expect(a).toEqual(b);
    expect(setMock).toHaveBeenCalledTimes(1);
  });
});
