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

## Trocar a IA da copy (sem usar o Claude)

Qualquer API compatível com OpenAI chat/completions serve — no `.env`:

```
COPY_PROVIDER=openai
LLM_BASE_URL=https://api.deepseek.com/v1        # ou Groq, Gemini, Ollama...
LLM_API_KEY=sk-...
LLM_MODEL=deepseek-chat
```

Exemplos de base URL: DeepSeek `https://api.deepseek.com/v1` · Groq
`https://api.groq.com/openai/v1` · Gemini
`https://generativelanguage.googleapis.com/v1beta/openai` · Ollama local
`http://localhost:11434/v1` (sem LLM_API_KEY). A saída passa pela mesma
validação de schema; com `COPY_PROVIDER=openai` a chave Anthropic é dispensável.

## Mudar o prompt do fundo (Flux)

O prompt mora em **`src/modules/backgrounds/background-prompt.ts`** (comentado,
com as constantes editáveis) e pode ser sobrescrito sem código via `.env`:

```
FLUX_BACKGROUND_PROMPT=clean automotive scene, empty road at dusk, {vehicle} ...
```

`{vehicle}` vira a descrição do veículo (ex.: "prata 2025 VW Nivus Highline").
O prompt final de cada geração aparece no log da API (`prompt do fundo Flux`).
Lembrete do pipeline: **foto real do veículo no banco tem prioridade** — o Flux
só entra quando o veículo não tem foto; cor sólida é o último fallback. O
sufixo anti-texto é sempre anexado (texto vem do HTML, nunca da IA).

## Problemas comuns

- **Porta 5432 ocupada** — outro Postgres rodando; pare-o ou mude a porta em
  `scripts/dev-db.mjs` e no `DATABASE_URL`.
- **`prisma migrate` pede DATABASE_URL** — confira o `.env` (ou exporte a var
  no terminal antes do comando).
- **Imagem não aparece no card** — status do criativo `FAILED`? Veja o log da
  API (o render inline loga o erro). `FAL_API_KEY` configurada?
- **Copy sempre genérica** — a chave Anthropic do `.env` é placeholder;
  troque por uma real (console.anthropic.com) e gere de novo.
