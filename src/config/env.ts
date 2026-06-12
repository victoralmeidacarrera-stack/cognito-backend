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

  // Infra
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL_BRIEFING: z.string().default('claude-sonnet-4-5'),
  ANTHROPIC_MODEL_VARIATIONS: z.string().default('claude-haiku-4-5-20251001'),

  // fal.ai (placeholder)
  FAL_API_KEY: z.string().optional(),

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

// Bypass de auth: nunca em produção; em dev/test o default é ligado.
export const authDevBypass = !isProduction && (env.AUTH_DEV_BYPASS ?? 'true') === 'true';
