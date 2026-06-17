# Cognito AI — Backend (contexto p/ Claude Code)

SaaS de automação de criativos para Instagram (Feed/Stories) para concessionárias
de veículos no Brasil. **Monolito modular bem feito** (não over-engineerar).
Agência Cognito AI (Victor Hugo = fullstack/dev; Lincoln = comercial).
Frontend separado: repo `cognito-frontend` (pasta irmã).

## Stack

Node 20 + TypeScript **strict** (ESM/NodeNext) · Fastify 5 · Prisma 6 + PostgreSQL
· BullMQ + Redis (ioredis) · Puppeteer (render PNG) · Anthropic SDK (Sonnet 4.5
copy, Haiku p/ variações; **prompt caching** no BrandBook) · **fal.ai Flux 1.1 Pro**
(`fal-ai/flux-pro/v1.1`, gera o FUNDO — texto nunca vem da IA) · Cloudflare R2 ·
Resend · Sentry + pino · Clerk (auth) · OpenAPI/Swagger em `/docs`.

## Comandos

```bash
npm run dev          # API (tsx watch) → :3333
npm run worker       # workers BullMQ (geração, render, email)
npm run typecheck    # tsc --noEmit   (rode SEMPRE antes de commitar)
npm test             # vitest
npm run lint         # eslint
npm run prisma:deploy / db:seed / prisma:studio
```

Pré-commit (husky+lint-staged) roda eslint --fix + prettier + `prisma format`.

## Infra local

`.env` a partir de `.env.example` (gitignored — recriar em cada máquina com as
chaves). Postgres+Redis via `docker compose up -d`. **Docker não está na máquina
do Victor**; para testes usamos `npm i --no-save embedded-postgres` (Postgres real
sem Docker; força UTF-8 com `initdbFlags`, senão WIN1252 quebra emoji). Sem infra,
a API sobe mesmo assim (Prisma/Redis são lazy; `/health/ready` mostra degradado).

## Convenções (NÃO violar)

- Nada de `any`; **zod** em todo input/output (rotas usam `fastify-type-provider-zod`,
  schema na rota, sem `.parse` manual).
- Camadas: **routes → services → repositories** (o tenant Prisma client é o repo).
- Modular por feature em `src/modules/*`. Erros tipados (`AppError` e derivados);
  envelope de erro `{ error: { code, message } }` no handler global.
- Multi-tenant: **zero vazamento entre orgs**. `tenantPrisma(orgId)` (`config/tenant.ts`)
  injeta `organizationId` em todo query — por isso os `create` precisam de cast
  `as Prisma.XUncheckedCreateInput` (o org é injetado em runtime).
- ESM NodeNext: imports relativos terminam em `.js`.

## Decisões a lembrar

- `exactOptionalPropertyTypes` foi REMOVIDO (mantém `strict`) por atrito com libs.
- BullMQ recebe **opções de conexão** (não instância ioredis) — ioredis aninhado.
- `fastify-type-provider-zod` fixado em **^4** (v6 exige zod 4; usamos zod 3).
- Auth: **bypass de dev** (`AUTH_DEV_BYPASS=true`, default em dev) resolve o admin
  do seed sem Clerk; headers `x-dev-user-id`/`x-dev-org-id` forçam org (teste multi-tenant).
- Quotas: Starter 6/100 · Growth 12/300 · Pro 20/600 · Enterprise 30/∞. Quota
  estourada bloqueia geração. Variação = 1 template + 1 copy. Cliente self-service.

## Estado atual

Fases 1–4 + telas prontas e no `main`. Geração de copy (Claude) + render (Handlebars
→Puppeteer→R2) + fila (BullMQ) implementados. fal.ai integrado (`config/fal.ts`),
validado (falta saldo na conta fal). **Pendente:** fiar o Flux no pipeline de render
(opção C: foto real do veículo se existir, senão fundo Flux; 2 fundos/briefing,
reusados) — precisa adicionar `Creative.backgroundUrl` (schema+migration). Ver
`docs/RUNBOOK.md` (ciclo real) e `docs/DEPLOY.md` (Neon+Railway+Vercel).
