# Cognito AI — Backend

SaaS de automação de criativos para Instagram (Feed e Stories) voltado a
concessionárias de veículos no Brasil. Monolito modular bem feito.

## Stack

- **Runtime:** Node.js 20 + TypeScript (strict) + Fastify 5
- **Dados:** Prisma 6 + PostgreSQL (Neon em prod, Postgres local via Docker)
- **Filas:** BullMQ + Redis (Upstash em prod)
- **Render:** Puppeteer headless (PNG) — _Fase 2_
- **IA:** Anthropic SDK (Sonnet 4.5 briefing, Haiku 4.5 variações) com prompt caching
- **Imagem:** fal.ai (Flux 1.1 Pro) — _placeholder_
- **Storage:** Cloudflare R2 · **Email:** Resend
- **Observabilidade:** Sentry + pino · **Auth:** Clerk · **Deploy:** Railway

## Arquitetura

```
routes → services → repositories
```

Modular por feature (não MVC). Erros tipados, zod em todo input/output,
multi-tenant com isolamento por organizationId.

```
src/
  config/    env, logger, prisma, redis, queue, r2, anthropic, sentry, plans
  shared/    errors, types, schemas, utils, middleware
  modules/   health (Fase 1) · demais features (Fase 2)
prisma/      schema (12 entidades), seed
templates/   HTML Handlebars versionados (feed / stories / partials)
```

## Setup local

```bash
# 1. Variáveis de ambiente
cp .env.example .env   # preencha ANTHROPIC_API_KEY etc.

# 2. Infra (Postgres + Redis)
docker compose up -d

# 3. Dependências
npm install

# 4. Banco
npm run prisma:migrate   # cria as tabelas
npm run db:seed          # org demo + admin + brand book

# 5. Dev
npm run dev              # http://localhost:3333/health
```

## Scripts

| Script                  | Ação                              |
| ----------------------- | --------------------------------- |
| `npm run dev`           | Server com hot-reload (tsx watch) |
| `npm run build`         | Compila para `dist/`              |
| `npm run start`         | Roda o build                      |
| `npm run typecheck`     | `tsc --noEmit`                    |
| `npm run lint`          | ESLint                            |
| `npm run format`        | Prettier                          |
| `npm run prisma:studio` | UI do banco                       |
| `npm run db:seed`       | Popula dados demo                 |

## Health checks

- `GET /health` — liveness (processo de pé)
- `GET /health/ready` — readiness (Postgres + Redis)

## Planos e quotas

| Plano      | Variações/briefing | Variações/mês | Mensalidade  |
| ---------- | ------------------ | ------------- | ------------ |
| Starter    | 6                  | 100           | R$ 990       |
| Growth     | 12                 | 300           | R$ 2.490     |
| Pro        | 20                 | 600           | R$ 4.490     |
| Enterprise | 30                 | sob consulta  | sob consulta |

> Quota estourada bloqueia a geração. Variação = 1 template + 1 copy pareados.
> Cliente é self-service: ele gera e ele aprova.

## Roadmap

- **Fase 1 (atual):** scaffolding, schema, config, health. ✅
- **Fase 2:** módulos de negócio, Clerk, generation (Claude + caching),
  workers (BullMQ), render (Puppeteer), R2, aprovações, quotas.
