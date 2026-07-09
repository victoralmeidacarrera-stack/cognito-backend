# Rodando local SEM Docker (Windows)

Guia para subir **frontend + backend + Postgres** na sua máquina e testar o
fluxo completo de geração pelo navegador. Sem Docker, sem Redis, sem R2 —
os fallbacks de dev cobrem tudo (veja "Como os fallbacks funcionam").

## O que você precisa (1ª vez)

```bash
# no cognito-backend
npm install
npm i --no-save embedded-postgres   # Postgres real sem Docker (~50MB)

# no cognito-frontend (pasta irmã)
npm install
```

`.env` do backend a partir do `.env.example`. Para o fluxo completo:

| Variável            | Precisa?  | Sem ela...                                                              |
| ------------------- | --------- | ----------------------------------------------------------------------- |
| `DATABASE_URL`      | ✅ sim    | use `postgresql://cognito:cognito@localhost:5432/cognito?schema=public` |
| `ANTHROPIC_API_KEY` | recomendo | copy sai do fallback local (genérica, marca `dev-fallback`)             |
| `FAL_API_KEY`       | recomendo | sem fundo Flux (cor sólida) e sem storage p/ imagens                    |
| `REDIS_URL`         | não (dev) | jobs rodam inline no processo da API                                    |
| `R2_*`              | não (dev) | PNGs vão pro storage do fal (URL expira em 30d)                         |

## Subir (3 terminais)

```bash
# T1 — Postgres (deixe aberto)
npm run dev:db

# T2 — backend  → http://localhost:3333  (Swagger em /docs)
npm run prisma:deploy   # 1ª vez / após nova migration
npm run db:seed         # 1ª vez (org demo + templates)
npm run dev

# T3 — frontend → http://localhost:5173
cd ../cognito-frontend && npm run dev
```

Abra **http://localhost:5173** → botão **Gerar criativos**. O fluxo real roda:
briefing → copy (Claude ou fallback) → fundo (Flux) → render (Puppeteer) →
imagem visível nos cards. `GET /health/ready` mostra o estado da infra.

Opcional: `npm run dev:demo` insere 4 criativos prontos na Biblioteca.

## Como os fallbacks de dev funcionam

Todos **só existem fora de produção** e logam warning quando ativam:

- **Sem Redis** → `jobs.service.ts` roda o job inline no processo da API
  (mesmos processors dos workers). Em produção, BullMQ/Redis é obrigatório.
- **Sem R2** → `render.service.ts` sobe o PNG final pro storage do fal
  (`fal.media`, expira em 30d). O fundo Flux já caía pra CDN do fal.
- **Sem Claude** → `generate-creative.ts` usa `devFallbackOutput()` (copy
  determinística do veículo/briefing, model `dev-fallback`). Com
  `ANTHROPIC_API_KEY` válida, a copy real volta sozinha.

## Problemas comuns

- **Porta 5432 ocupada** — outro Postgres rodando; pare-o ou mude a porta em
  `scripts/dev-db.mjs` e no `DATABASE_URL`.
- **`prisma migrate` pede DATABASE_URL** — confira o `.env` (ou exporte a var
  no terminal antes do comando).
- **Imagem não aparece no card** — status do criativo `FAILED`? Veja o log da
  API (o render inline loga o erro). `FAL_API_KEY` configurada?
- **Copy sempre genérica** — a chave Anthropic do `.env` é placeholder;
  troque por uma real (console.anthropic.com) e gere de novo.
