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
verdade, ligue o **Clerk** (`VITE_CLERK_PUBLISHABLE_KEY` no front + `CLERK_SECRET_KEY`

- `AUTH_DEV_BYPASS=false` no back). Veja o README do frontend.

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
   ANTHROPIC_API_KEY=<quando for gerar>
   FAL_API_KEY=<sua chave fal.ai>
   # R2_* e RESEND_* quando for gerar/renderizar/enviar email
   # CORS_ORIGINS=<URL do Vercel>  (preenche no passo 4)
   ```
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
2. **Worker**: no Railway, **+ New Service** apontando pro mesmo repo
   `cognito-backend`, com **Start Command**: `npm run worker:start`.
   (O Dockerfile já instala o Chromium pro Puppeteer.)
3. **Chaves**: `ANTHROPIC_API_KEY` (copy), `FAL_API_KEY` com **saldo** (Flux),
   `R2_*` (guardar o PNG).
4. Garanta `REDIS_URL` igual nos dois serviços (API e worker).

## Migrations futuras

Quando o schema mudar, rode de novo apontando pro Neon:

```bash
DATABASE_URL="<Neon>" npm run prisma:deploy
```
