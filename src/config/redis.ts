import { Redis, type RedisOptions } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

// Opções compartilhadas. `maxRetriesPerRequest: null` é exigência do BullMQ.
const baseOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: true,
};

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

export const redis = globalForRedis.redis ?? new Redis(env.REDIS_URL, baseOptions);

// Sem listener, um 'error' não tratado derruba o processo.
redis.on('error', (err: Error) => {
  logger.debug({ err }, 'redis connection error');
});

if (env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}

/**
 * Opções numéricas que aceitamos na query string da REDIS_URL.
 *
 * `family` é a razão de existirem: o Redis interno do Railway
 * (`*.redis.railway.internal`) só resolve em IPv6, e só `family=0` faz o
 * ioredis aceitar o AAAA. O client global é criado com `new Redis(env.REDIS_URL)`
 * — que parseia a query sozinho —, mas o BullMQ recebe este objeto remontado:
 * sem propagar aqui, as duas conexões teriam configurações diferentes.
 */
const NUMERIC_URL_OPTIONS = ['family', 'db', 'connectTimeout'] as const;
type NumericUrlOption = (typeof NUMERIC_URL_OPTIONS)[number];

export interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls?: Record<string, never>;
  family?: number;
  db?: number;
  connectTimeout?: number;
  maxRetriesPerRequest: null;
}

/** Lê da query string só o que conhecemos; inválido/desconhecido é ignorado. */
function numericUrlOptions(params: URLSearchParams): Partial<Record<NumericUrlOption, number>> {
  const options: Partial<Record<NumericUrlOption, number>> = {};
  for (const key of NUMERIC_URL_OPTIONS) {
    const raw = params.get(key);
    if (raw === null || raw.trim() === '') continue;
    const value = Number(raw);
    // ⚠️ `family=0` é um valor VÁLIDO (deixa o DNS escolher A/AAAA) — testar
    // por falsy (`Number(raw) || undefined`) mataria justamente o caso do
    // Railway. Só descartamos o que não é inteiro finito (ex.: `family=abc`).
    if (!Number.isInteger(value)) {
      logger.warn({ option: key, value: raw }, 'REDIS_URL: opção ignorada (não é inteiro)');
      continue;
    }
    options[key] = value;
  }
  return options;
}

/**
 * Opções de conexão (objeto puro) para o BullMQ.
 * Passamos opções em vez de uma instância Redis porque o BullMQ traz a sua
 * própria cópia do ioredis — instâncias entre as duas cópias não são
 * estruturalmente compatíveis, mas um objeto de opções é.
 */
export function redisConnectionOptions(): RedisConnectionOptions {
  const url = new URL(env.REDIS_URL);
  const isTls = url.protocol === 'rediss:';
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(isTls ? { tls: {} } : {}),
    ...numericUrlOptions(url.searchParams),
    maxRetriesPerRequest: null,
  };
}

/** Cria uma conexão dedicada (workers BullMQ pedem conexões separadas). */
export function createRedisConnection(): Redis {
  const connection = new Redis(env.REDIS_URL, baseOptions);
  connection.on('error', (err: Error) => {
    logger.debug({ err }, 'redis connection error');
  });
  return connection;
}

export async function disconnectRedis(): Promise<void> {
  await redis.quit();
}

// ── Health check ───────────────────────────────────────────────
//
// Por que não basta um PING: em 03/08/2026 o Upstash estourou a cota mensal do
// free tier (`ERR max requests limit exceeded. Limit: 500000`) e passou a
// recusar os comandos do BullMQ — mas continuou respondendo `PING`. O
// `/health/ready` ficou verde enquanto o enqueue devolvia erro.
//
// Então o probe faz uma ESCRITA (o que a fila realmente precisa), não um ping:
//
// - caminho feliz = **1 comando** (`SET chave valor PX <ttl>`), que já prova
//   conexão, credencial e aceitação de escrita;
// - só quando a escrita falha gastamos um 2º comando (`PING`), para separar
//   "servidor mudo" de "servidor responde mas recusa escrita" (cota estourada,
//   OOM com `noeviction`, réplica read-only);
// - o resultado fica em cache por `HEALTH_CACHE_MS` como medida **defensiva**,
//   não porque exista hoje quem pole isto: o `railway.json` aponta o
//   `healthcheckPath` para `/health` (liveness, que não toca no Redis) e o
//   front não consulta o readiness. `/health/ready` é para inspeção manual e
//   monitor externo — e é justamente aí que o cache serve: se alguém ligar um
//   monitor (ou um `curl` em loop), o custo fica preso em ~1 comando a cada
//   15s por processo, em vez de 1 por requisição.
//
// ⚠️ Não aponte o healthcheck do Railway para `/health/ready`: uma cota
// estourada no Redis derrubaria o deploy inteiro da API, inclusive as rotas
// que não dependem da fila.

/** Chave própria do health check (TTL curto, não colide com nada do BullMQ). */
const HEALTH_KEY = 'cognito:health:probe';
/** A chave se apaga sozinha; nunca acumula lixo no Redis. */
const HEALTH_KEY_TTL_MS = 30_000;
/** Janela de cache do resultado — cache defensivo, ver acima. */
const HEALTH_CACHE_MS = 15_000;

export interface RedisHealth {
  /** Pronto para operar a fila = responde **e** aceita escrita. */
  ok: boolean;
  /** O servidor respondeu (rede/TLS/credencial OK). */
  responds: boolean;
  /** Aceitou uma escrita — é isto que o PING não prova. */
  acceptsWrites: boolean;
  /** Mensagem do erro que derrubou o check, quando houver. */
  error?: string;
}

interface CachedHealth {
  at: number;
  value: RedisHealth;
}

let cachedHealth: CachedHealth | undefined;
let inFlightHealth: Promise<RedisHealth> | undefined;

/** Corre a operação contra um timeout curto (o readiness não pode pendurar). */
async function withTimeout<T>(run: () => Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Mensagem em uma linha e curta — ela vai para o corpo do /health/ready. */
function describeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const single = raw.replace(/\s+/g, ' ').trim();
  return single.length > 200 ? `${single.slice(0, 199)}…` : single;
}

async function probeRedis(timeoutMs: number): Promise<RedisHealth> {
  try {
    await withTimeout(
      () => redis.set(HEALTH_KEY, Date.now().toString(), 'PX', HEALTH_KEY_TTL_MS),
      timeoutMs,
      'redis health write timeout',
    );
    return { ok: true, responds: true, acceptsWrites: true };
  } catch (err) {
    const error = describeError(err);
    try {
      const pong = await withTimeout(() => redis.ping(), timeoutMs, 'redis ping timeout');
      return { ok: false, responds: pong === 'PONG', acceptsWrites: false, error };
    } catch {
      return { ok: false, responds: false, acceptsWrites: false, error };
    }
  }
}

/**
 * Estado do Redis para o health check e para o fallback inline de dev.
 * Nunca lança: falha vira `{ ok: false, ... }` com a causa em `error`.
 */
export async function checkRedis(timeoutMs = 1000): Promise<RedisHealth> {
  if (cachedHealth && Date.now() - cachedHealth.at < HEALTH_CACHE_MS) {
    return cachedHealth.value;
  }
  // Chamadas concorrentes compartilham o mesmo probe (1 comando, não N).
  inFlightHealth ??= probeRedis(timeoutMs)
    .catch((err: unknown) => ({
      ok: false,
      responds: false,
      acceptsWrites: false,
      error: describeError(err),
    }))
    .then((value) => {
      cachedHealth = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inFlightHealth = undefined;
    });
  return inFlightHealth;
}
