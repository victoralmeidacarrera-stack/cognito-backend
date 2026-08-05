# Deploy na nuvem (acessar de qualquer máquina)

Stack recomendada, toda com free tier e integrada ao GitHub:

| Peça           | Serviço              | Por quê                                    |
| -------------- | -------------------- | ------------------------------------------ |
| Banco          | **Neon** (Postgres)  | serverless, UTF-8, free                    |
| Backend (API)  | **Railway** (Docker) | roda processo longo + Chromium (Puppeteer) |
| Frontend (SPA) | **Vercel**           | deploy de Vite em 1 clique                 |
| Redis + Worker | Railway/Upstash      | **só quando for gerar criativo**           |

> Para **apenas navegar o app** (catálogo, brand book, etc.) você precisa só de
> **Neon + Railway (API) + Vercel**. Redis/worker/IA entram quando ligar a geração.

---

## ⚠️ Aviso de segurança (leia antes)

Com `AUTH_DEV_BYPASS=true`, **qualquer pessoa com a URL entra como o admin demo**
(sem login). Bom para um demo privado — **não divulgue a URL**. Para fechar de
verdade, ligue o **Clerk**: `VITE_CLERK_PUBLISHABLE_KEY` no front, e
`CLERK_SECRET_KEY` com `AUTH_DEV_BYPASS=false` no back. Veja o README do frontend.

---

## 1. Banco — Neon

1. https://neon.tech → cria projeto.
2. Copia a **connection string** (já vem com `?sslmode=require`).
3. Guarda como `DATABASE_URL`.

## 2. Backend (API) — Railway

1. https://railway.app → **New Project → Deploy from GitHub repo** →
   `cognito-backend`. O Railway detecta o `Dockerfile` e builda sozinho.
2. Em **Variables**, defina:

   ```
   NODE_ENV=production
   DATABASE_URL=<a string do Neon>
   AUTH_DEV_BYPASS=true            # (ou false, com Clerk)
   COPY_PROVIDER=fal               # default; a copy sai do fal-ai/any-llm
   FAL_API_KEY=<sua chave fal.ai>  # copy (any-llm) + fundo (Flux), mesma conta
   FAL_LLM_MODEL=google/gemini-2.5-flash     # standard; premium custa ~10x
   FAL_VISION_MODEL=google/gemini-2.5-flash  # análise de referência de layout
   FAL_LLM_COST_MICROCENTS=0       # custo por chamada (0 = desconhecido)
   # ANTHROPIC_API_KEY=<só com COPY_PROVIDER=anthropic>
   # R2_* e RESEND_* quando for gerar/renderizar/enviar email
   # CORS_ORIGINS=<URL do Vercel>  (preenche no passo 4)
   ```

   ⚠️ **Defina `COPY_PROVIDER` explicitamente.** Sem a var, o serviço cai no
   default (`fal`) — o que troca de provedor de copy em silêncio num deploy
   antigo que só tinha `ANTHROPIC_API_KEY` configurada.

3. Em **Settings → Networking**, gere um **domínio público**. Anote a URL
   (ex.: `https://cognito-backend-production.up.railway.app`).
4. **Migrations + seed** (uma vez). Do seu PC, apontando para o Neon:
   ```bash
   cd cognito-backend
   DATABASE_URL="<string do Neon>" npm run prisma:deploy
   DATABASE_URL="<string do Neon>" npm run db:seed
   ```
   (ou rode no shell do Railway). Sem o seed, o bypass de dev não acha o admin.
5. Confira: abra `https://SEU-BACKEND/health` → deve responder `{"status":"ok"}`.

## 3. Frontend (SPA) — Vercel

1. https://vercel.com → **Add New → Project** → importa `cognito-frontend`.
   Framework: **Vite** (detecta automático; build `npm run build`, output `dist`).
2. Em **Environment Variables**, defina:
   ```
   VITE_API_BASE=https://SEU-BACKEND.up.railway.app
   # VITE_CLERK_PUBLISHABLE_KEY=...   (só se for usar Clerk)
   ```
3. **Deploy**. Anote a URL (ex.: `https://cognito-frontend.vercel.app`).

## 4. Liberar o CORS

No **Railway → Variables**, defina a origem do front e redeploy:

```
CORS_ORIGINS=https://cognito-frontend.vercel.app
```

Pronto — abra a URL do Vercel de qualquer máquina. 🎉

---

## Ligar a geração de criativo (depois)

1. **Redis**: Upstash (free) → `REDIS_URL=rediss://...` (eviction = `noeviction`),
   ou plugin Redis no Railway.

   ⚠️ **Se usar o Redis interno do Railway, a `REDIS_URL` precisa de `?family=0`**
   — nos **dois** serviços (API **e** worker):

   ```
   REDIS_URL=redis://default:<senha>@<nome>.redis.railway.internal:6379?family=0
   ```

   O private networking do Railway é **IPv6-only** e o ioredis, sem `family=0`,
   só tenta o registro A (IPv4) e nunca conecta. O `redisConnectionOptions()`
   (o que o BullMQ recebe) remonta a URL peça por peça e propaga `family`, `db`
   e `connectTimeout` da query string — assim o client global e o BullMQ ficam
   com a mesma configuração. Isso é **requisito do Redis interno do Railway**,
   não a explicação do incidente de 03/08/2026 (ver abaixo).

   Formatos que **não** precisam de `family=0`:

   - **Endpoint público do Railway** (TCP proxy, IPv4):
     `redis://default:<senha>@<algo>.proxy.rlwy.net:<porta>` — sai da rede
     interna (conta banda), mas funciona sem tuning.
   - **Upstash**: `rediss://default:<senha>@<host>.upstash.io:6379` — o
     protocolo `rediss:` já liga o TLS sozinho.

   ⚠️ Antes de escolher o Upstash free, leia
   **["O free tier do Upstash não sustenta o BullMQ"](#o-free-tier-do-upstash-não-sustenta-o-bullmq)**
   no fim desta seção.

2. **Worker**: no Railway, **+ New Service** apontando pro mesmo repo
   `cognito-backend`. (O Dockerfile já instala o Chromium pro Puppeteer.)

   ⚠️ **NÃO configure o Start Command pelo painel** — o config-as-code do repo
   sobrescreve o painel, e o `railway.json` (do serviço `web`) manda
   `node dist/server.js`. Um worker configurado só pelo painel sobe uma
   **segunda cópia da API**: fica verde no Railway, o `/health` responde, e
   **ninguém consome a fila** — a geração fica presa em `QUEUED` até o front
   estourar o timeout ("A geração demorou demais…").

   O certo é dar ao worker o **seu próprio arquivo de config**: em
   Settings → **Config-as-code** (campo _Railway Config File_), aponte para
   `railway.worker.json` (versionado neste repo: start
   `node dist/workers/index.js`, sem `healthcheckPath`, porque o worker não
   escuta HTTP). Depois, **Redeploy**.

   Como conferir que o worker é worker mesmo: nos logs deve aparecer
   `🛠️  workers iniciados: generate-creative, render-image, send-email`.
   Se aparecer `🚀 cognito-backend ouvindo em…`, ele está rodando a API.

3. **Chaves**: `FAL_API_KEY` com **saldo** — cobre a copy (`fal-ai/any-llm`,
   default `COPY_PROVIDER=fal`) **e** o fundo (Flux) — mais `R2_*` (guardar o
   PNG). `ANTHROPIC_API_KEY` só é necessária com `COPY_PROVIDER=anthropic` —
   ou, com qualquer provedor, se a `FAL_API_KEY` estiver ausente e você usar a
   análise de referência de layout, que então cai no Claude vision.
4. Garanta `REDIS_URL` **igual** nos dois serviços (API e worker) — inclusive a
   query string (`?family=0` no Redis interno). Um dos dois sem ela e metade do
   pipeline fica muda.

## O free tier do Upstash não sustenta o BullMQ

**Incidente de 03/08/2026.** `POST /briefings/:id/generate` passou a devolver
**500** com `/health/ready` **verde**. Causa real, reproduzida contra o Redis de
produção (`rediss://…upstash.io:6379`):

```
PING (instância direta)  → ERR max requests limit exceeded. Limit: 500000, Usage: 500000
INFO server              → respondia normalmente (redis_version:8.2.0)
CONFIG GET maxmemory-policy → ERR max requests limit exceeded…
queue.add (BullMQ)       → ReplyError: ERR max requests limit exceeded.
```

Ou seja: **a cota mensal de 500 mil comandos do free tier do Upstash estourou**.
Rede, TLS, credencial e `maxmemory-policy` (`noeviction`) estavam corretos — e
`family=0` não tem nada a ver com este deploy (o Upstash é público e resolve em
IPv4).

Por que o readiness não pegou: **com a cota estourada o Upstash trata os
comandos de forma desigual**. Às 23:36 o `/health/ready` estava verde porque
o `PING` ainda passava, enquanto o `queue.add` do BullMQ já falhava; na
reprodução, mais tarde, até o `PING` foi recusado — mas o `INFO` continuava
respondendo. Moral: **`PING` nunca foi prova de que a fila funciona**.

**Por que a cota some sozinha: BullMQ ocioso não é gratuito.** API e worker
ficam 24/7 fazendo heartbeat, `stalled-check`, polling de delayed jobs e
manutenção de fila — mesmo sem nenhum criativo sendo gerado. Dois processos
rodando o mês inteiro queimam as 500 mil requisições sem que ninguém use o
produto. **Não conte com o free tier do Upstash para manter a fila de pé.**

Saídas (decisão de infra, ainda em aberto):

1. **Plugin Redis do Railway** — sem cota por comando; lembre do `?family=0`.
2. **Upstash pago** (pay-as-you-go / plano fixo) — mantém o setup atual.
3. **Afrouxar os intervalos do BullMQ** (stalled-check, drain delay, quantidade
   de workers/conexões) — reduz o consumo, não elimina. **Não implementado** —
   nenhum tuning foi feito no código.

### O que mudou no código depois do incidente

- **`/health/ready` não confia mais em `PING`.** O check faz uma **escrita com
  TTL curto** (`SET cognito:health:probe <ts> PX 30000`), que é o que a fila
  realmente precisa. Custo: **1 comando** no caminho feliz; só quando a escrita
  falha ele gasta um `PING` extra para separar "servidor mudo" de "servidor
  responde mas recusa escrita". O resultado fica em **cache de 15s**, e o
  motivo é **defensivo, não uma otimização de algo que já acontece**: hoje
  ninguém pola o `/health/ready` — o `healthcheckPath` do `railway.json` é
  `/health` (liveness, que não toca no Redis) e o frontend não consulta o
  readiness. O endpoint existe para inspeção manual e para um eventual monitor
  externo; **se** alguém ligar um monitor a cada 5s, o cache segura o custo em
  ~1 comando a cada 15s por processo que atenda o probe (~170 mil/mês por
  processo; hoje só a API expõe HTTP — o worker não tem rota de health) em vez de
  1 comando por requisição. Resposta degradada:

  ```json
  {
    "status": "degraded",
    "checks": { "database": true, "redis": false },
    "redis": {
      "responds": true,
      "acceptsWrites": false,
      "error": "ERR max requests limit exceeded. Limit: 500000, Usage: 500000"
    }
  }
  ```

  `responds: true` + `acceptsWrites: false` = **cota estourada, OOM com
  `noeviction` ou réplica read-only**. `checks.redis` continua booleano (contrato
  antigo), mas agora significa "a fila consegue operar".

  ⚠️ **Não aponte o `healthcheckPath` do Railway para `/health/ready`.** Ele
  precisa continuar em `/health`: com o readiness no healthcheck, uma cota
  estourada no Redis derrubaria o **deploy inteiro** da API — inclusive as rotas
  que não dependem da fila (login, listagens, download de criativo já pronto).
  Readiness é sinal para humano/monitor, não gatilho de restart.

  ⚠️ **O probe de escrita quase não roda em produção.** O outro call site do
  `checkRedis()` é o fallback inline de dev em `src/modules/jobs/jobs.service.ts`
  (`if (isProduction || (await checkRedis(800)).ok)`), que **curto-circuita pelo
  `isProduction`** e nem chega a chamar o check. Ou seja: em produção o probe só
  roda quando alguém abre o `/health/ready` na mão. Quem detecta a próxima cota
  estourada é o **rollback + 503** do item abaixo (que dispara na hora do
  enqueue real), não o readiness — não confie no readiness como alarme
  automático enquanto não houver um monitor externo apontado para ele.

- **Nenhum briefing fica preso em `GENERATING`.** Falha de enqueue vira `FAILED`
  com a **mensagem crua** de quem recusou em `errorMessage` (ex.:
  `ERR max requests limit exceeded…`), e a rota devolve **503 `SERVICE_UNAVAILABLE`**
  (retentável) em vez de 500. O rollback também **limpa o `idempotencyKey`** do
  briefing: a tentativa não chegou a existir, então o retry com a mesma
  `Idempotency-Key` (o que o 503 pede) volta a enfileirar de verdade em vez de
  bater no replay idempotente e receber 200 com o job morto.

## Migrations futuras

Quando o schema mudar, rode de novo apontando pro Neon:

```bash
DATABASE_URL="<Neon>" npm run prisma:deploy
```
