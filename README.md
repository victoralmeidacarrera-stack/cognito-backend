# Cognito AI — Backend

SaaS de automação de criativos para Instagram (Feed e Stories) voltado a
concessionárias de veículos no Brasil. Monolito modular bem feito.

## Stack

- **Runtime:** Node.js 20 + TypeScript (strict) + Fastify 5
- **Dados:** Prisma 6 + PostgreSQL (Neon em prod, Postgres local via Docker)
- **Filas:** BullMQ + Redis (Upstash em prod)
- **Render:** Puppeteer headless (Handlebars → PNG)
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
  config/    env, logger, prisma, redis, queue, r2, anthropic, puppeteer, fal, sentry, plans, tenant
  shared/    errors, types, schemas, utils, context, middleware
  modules/   auth, brand-books, vehicles, photos, campaigns, templates, briefings,
             generation, creatives, approvals, jobs, usage, notifications, render, health
  workers/   generate-creative, render-image, send-email
prisma/      schema (12 entidades), migrations, seed
templates/   HTML Handlebars versionados (feed / stories / partials)
tests/       Vitest (unit)
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
npm run prisma:deploy    # aplica a migration baseline (0_init)
npm run db:seed          # org demo + admin + brand book

# 5. App (2 processos)
npm run dev              # API   → http://localhost:3333/health
npm run worker           # workers BullMQ (geração, render, email)
```

> Sem Clerk configurado em dev, a API usa **bypass de auth** (`AUTH_DEV_BYPASS`):
> as rotas resolvem o admin/org do seed. Force outra org/usuário com os headers
> `x-dev-org-id` / `x-dev-user-id`.

## Scripts

| Script                  | Ação                           |
| ----------------------- | ------------------------------ |
| `npm run dev`           | API com hot-reload (tsx watch) |
| `npm run worker`        | Workers BullMQ com hot-reload  |
| `npm run build`         | Compila para `dist/`           |
| `npm run start`         | Roda a API buildada            |
| `npm run worker:start`  | Roda os workers buildados      |
| `npm run typecheck`     | `tsc --noEmit`                 |
| `npm test`              | Vitest (run)                   |
| `npm run lint`          | ESLint                         |
| `npm run format`        | Prettier                       |
| `npm run prisma:deploy` | Aplica migrations              |
| `npm run prisma:studio` | UI do banco                    |
| `npm run db:seed`       | Popula dados demo              |

## API (v1)

Tudo sob `/api/v1`, autenticado (Clerk bearer ou bypass de dev). **Contrato vivo
em `GET /docs`** (Swagger UI) e `GET /docs/json` (OpenAPI). Guia de integração:
**[docs/FRONTEND.md](docs/FRONTEND.md)**.

| Método | Rota                           | Descrição                         |
| ------ | ------------------------------ | --------------------------------- |
| GET    | `/me`                          | usuário + org + quota (bootstrap) |
| POST   | `/brand-books`                 | cria brand book                   |
| GET    | `/brand-books`                 | lista                             |
| POST   | `/vehicles`                    | cadastra veículo                  |
| GET    | `/vehicles`                    | lista (paginado)                  |
| POST   | `/vehicles/:id/photos/presign` | URL assinada de upload (R2)       |
| POST   | `/vehicles/:id/photos`         | confirma e registra a foto        |
| POST   | `/campaigns`                   | cria campanha                     |
| GET    | `/templates`                   | lista templates (feed/stories)    |
| POST   | `/briefings`                   | cria briefing                     |
| POST   | `/briefings/:id/generate`      | dispara geração (Idempotency-Key) |
| GET    | `/creatives?briefingId=`       | lista criativos + aprovação       |
| POST   | `/creatives/:id/decision`      | aprova/rejeita (self-service)     |
| GET    | `/usage/quota`                 | consumo do mês + limites do plano |
| POST   | `/webhooks/clerk`              | provisionamento (svix, sem auth)  |

Fluxo de geração: `POST /briefings/:id/generate` → checa quota → enfileira
`generate-creative` (Claude Sonnet + prompt caching no BrandBook) → cria 1
`Creative` por variação → enfileira `render-image` (Handlebars → Puppeteer →
PNG → R2) → cria `Approval` pendente.

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

- **Fase 1:** scaffolding, schema, config, health. ✅
- **Fase 2:** auth (Clerk + bypass dev), isolamento multi-tenant (Prisma
  extension), quotas, módulos CRUD, generation (Claude + caching), workers
  BullMQ, render (Puppeteer → R2), aprovações, notificações. ✅
- **Fase 3:** upload de fotos (R2 presigned), testes (Vitest), rate limiting,
  e-mail de criativos prontos, deploy Railway (Dockerfile + Chromium). fal.ai
  segue como stub pluggável. ✅
- **Próximos:** auth Clerk em produção, integração fal.ai real, observabilidade
  Sentry no fluxo, painel de métricas de uso/custo.

> Para rodar o ciclo completo de verdade (Postgres, Redis, Anthropic, R2,
> Resend, Clerk, Chromium), veja **[docs/RUNBOOK.md](docs/RUNBOOK.md)**.
