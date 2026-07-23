import { existsSync } from 'node:fs';
import { z } from 'zod';

// Carrega .env apenas fora de produção (em prod as vars vêm da plataforma).
// process.loadEnvFile é nativo do Node >= 20.12.
if (process.env.NODE_ENV !== 'production' && existsSync('.env')) {
  process.loadEnvFile('.env');
}

const envSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3333),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // Origens do CORS (separadas por vírgula). Vazio = reflete a origem (dev).
  CORS_ORIGINS: z.string().optional(),

  // Infra
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // ── Provedor de copy (IA de texto) ──
  // 'anthropic' (default) usa o SDK da Anthropic com prompt caching.
  // 'openai' usa QUALQUER API compatível com OpenAI chat/completions
  // (OpenAI, DeepSeek, Groq, Gemini OpenAI-compat, Ollama local, ...):
  //   COPY_PROVIDER=openai
  //   LLM_BASE_URL=https://api.deepseek.com/v1   (ou http://localhost:11434/v1 p/ Ollama)
  //   LLM_API_KEY=sk-...
  //   LLM_MODEL=deepseek-chat
  COPY_PROVIDER: z.enum(['anthropic', 'openai']).default('anthropic'),
  LLM_BASE_URL: z.string().url().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),

  // Anthropic (usado quando COPY_PROVIDER=anthropic; opcional se usar outro provedor)
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL_BRIEFING: z.string().default('claude-sonnet-4-5'),
  ANTHROPIC_MODEL_VARIATIONS: z.string().default('claude-haiku-4-5-20251001'),

  // fal.ai (placeholder)
  FAL_API_KEY: z.string().optional(),

  // Override do prompt do fundo Flux (ver modules/backgrounds/background-prompt.ts).
  // Suporta o placeholder {vehicle} — substituído pela descrição do veículo.
  FLUX_BACKGROUND_PROMPT: z.string().optional(),

  // Composição foto real + cenário: recorta o carro da foto do banco e cola
  // sobre uma cena vazia gerada pelo Flux. Default ligado (a ideia original);
  // 'false' volta a usar a foto crua como fundo.
  VEHICLE_COMPOSITE: z.enum(['true', 'false']).default('true'),
  // Override do prompt da cena vazia usada na composição (sem carro).
  FLUX_SCENE_PROMPT: z.string().optional(),

  // Cloudflare R2
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().default('cognito-creatives'),
  R2_PUBLIC_URL: z.string().url().optional(),

  // Resend
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Cognito AI <no-reply@cognito.ai>'),

  // Clerk
  CLERK_SECRET_KEY: z.string().optional(),
  CLERK_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().optional(),

  // Auth: em dev, permite bypass do Clerk (resolve a org/admin demo ou os
  // headers x-dev-org-id / x-dev-user-id). Forçado off em produção.
  AUTH_DEV_BYPASS: z.enum(['true', 'false']).optional(),

  // Puppeteer: caminho do Chromium em prod (Railway). Vazio = bundled.
  PUPPETEER_EXECUTABLE_PATH: z.string().optional(),

  // Sentry
  SENTRY_DSN: z.string().url().optional(),
});

// Strings vazias no .env (ex.: SENTRY_DSN=) devem virar "ausente", para que
// campos .optional() e .default() funcionem como esperado.
const rawEnv = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== ''));

const parsed = envSchema.safeParse(rawEnv);

if (!parsed.success) {
  // Falha cedo e barulhento: sem env válido, não há boot.
  const issues = parsed.error.issues
    .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');

  console.error(`\n❌ Variáveis de ambiente inválidas:\n${issues}\n`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

// Bypass de auth. Em dev/test o default é ligado; em produção fica DESLIGADO
// por padrão e só liga se AUTH_DEV_BYPASS=true for setado explicitamente
// (demo privado sem Clerk — quem tem a URL entra como admin do seed).
export const authDevBypass = isProduction
  ? env.AUTH_DEV_BYPASS === 'true'
  : (env.AUTH_DEV_BYPASS ?? 'true') === 'true';

if (isProduction && authDevBypass) {
  console.warn(
    '\n⚠️  AUTH_DEV_BYPASS=true em PRODUÇÃO: a API está aberta sem login ' +
      '(qualquer request entra como o admin do seed). Use só para demo privado; ' +
      'NÃO divulgue a URL. Ligue o Clerk para fechar de verdade.\n',
  );
}
