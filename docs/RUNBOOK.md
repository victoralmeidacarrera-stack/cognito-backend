# Runbook — rodando o ciclo 100% real

Passo a passo para rodar o fluxo completo de verdade: cadastro → briefing →
geração com Claude → render (PNG) → upload no R2 → aprovação. Cobre como obter
cada serviço externo.

> Tudo o que tem custo: **Anthropic** (tokens) e, dependendo do volume, R2/Neon/
> Upstash (têm free tier generoso). Clave tudo num `.env` que NUNCA vai pro git.

---

## 0. Pré-requisitos

- Node.js 20+ e npm
- Git
- **Uma** das opções de infra abaixo (Docker local _ou_ serviços gerenciados)

```bash
git clone https://github.com/victoralmeidacarrera-stack/cognito-backend.git
cd cognito-backend
npm install
cp .env.example .env
```

---

## 1. Postgres + Redis

### Opção A — Docker local (mais simples para dev)

```bash
docker compose up -d        # sobe Postgres 16 + Redis 7
```

`.env`:

```
DATABASE_URL=postgresql://cognito:cognito@localhost:5432/cognito?schema=public
REDIS_URL=redis://localhost:6379
```

### Opção B — Gerenciados (prod / sem Docker)

- **Neon** (Postgres): https://neon.tech → cria projeto → copia a connection
  string (com `?sslmode=require`). Banco já vem em UTF8.
- **Upstash** (Redis): https://upstash.com → cria database Redis → copia a URL
  `rediss://...`. Em "Eviction" deixe **noeviction** (exigência do BullMQ).

```
DATABASE_URL=postgresql://USER:PASS@HOST/db?sslmode=require
REDIS_URL=rediss://default:PASS@HOST:6379
```

Aplique o schema e popule:

```bash
npm run prisma:deploy   # aplica a migration baseline (0_init)
npm run db:seed         # org demo + admin + brand book + templates
```

---

## 2. Anthropic (Claude)

1. https://console.anthropic.com → **API Keys** → cria uma key.
2. Garanta créditos/billing ativo.

```
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL_BRIEFING=claude-sonnet-4-5
ANTHROPIC_MODEL_VARIATIONS=claude-haiku-4-5-20251001
```

> O BrandBook é enviado com `cache_control: ephemeral` — a 2ª geração em diante
> da mesma org paga ~10% nos tokens do bloco de marca (cache hit).

---

## 3. Cloudflare R2 (storage das imagens)

1. Cloudflare dashboard → **R2** → cria um bucket (ex.: `cognito-creatives`).
2. **R2 → Manage API Tokens** → cria um token com permissão de
   _Object Read & Write_ → anota `Access Key ID` e `Secret Access Key`.
3. Pega o **Account ID** (canto do dashboard R2).
4. Para servir as imagens publicamente: habilite um **domínio público** no
   bucket (R2.dev ou domínio custom) e use-o em `R2_PUBLIC_URL`.

```
R2_ACCOUNT_ID=xxxxxxxxxxxxxxxx
R2_ACCESS_KEY_ID=xxxxxxxx
R2_SECRET_ACCESS_KEY=xxxxxxxx
R2_BUCKET=cognito-creatives
R2_PUBLIC_URL=https://pub-xxxx.r2.dev
```

---

## 4. Resend (email)

1. https://resend.com → **API Keys** → cria key.
2. Verifique um domínio (ou use o sandbox `onboarding@resend.dev` para teste).

```
RESEND_API_KEY=re_...
EMAIL_FROM=Cognito AI <no-reply@seudominio.com>
```

---

## 5. Clerk (auth) — opcional para testar local

Em dev você pode **pular o Clerk** e usar o bypass (`AUTH_DEV_BYPASS=true`, já é
o default). Para auth real:

1. https://dashboard.clerk.com → cria uma aplicação → **API Keys**.
2. Habilite **Organizations** (Configure → Organizations).
3. **Webhooks** → cria um endpoint apontando para
   `https://SEU_HOST/webhooks/clerk` e assina os eventos
   `organization.*` e `organizationMembership.*` → copia o **Signing Secret**.
   - Em dev, exponha o local com `ngrok http 3333` e use a URL do ngrok.

```
CLERK_SECRET_KEY=sk_test_...
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_WEBHOOK_SIGNING_SECRET=whsec_...
AUTH_DEV_BYPASS=false      # liga o Clerk de verdade
```

Com o webhook ativo, ao criar uma Organization no Clerk a app provisiona a
`Organization` + `User` automaticamente.

---

## 6. Puppeteer (render do PNG)

O `npm install` baixa o Chromium automaticamente **a não ser** que você tenha
setado `PUPPETEER_SKIP_DOWNLOAD`. Para garantir o download:

```bash
npx puppeteer browsers install chrome
```

Em produção (container), ou aponte para o Chromium do sistema:

```
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

(veja o `Dockerfile`, que já instala o Chromium).

---

## 7. Subir a aplicação (2 processos)

```bash
npm run dev       # API   → http://localhost:3333
npm run worker    # workers BullMQ (geração, render, email)
```

`GET /health/ready` deve responder `{"status":"ready","checks":{"database":true,"redis":true}}`.

---

## 8. Exercitar o fluxo completo (curl)

Sem Clerk (bypass de dev), o admin/org do seed é usado automaticamente.
No Windows, prefira `--data-binary @arquivo.json` para evitar problemas de
Content-Length.

```bash
API=http://localhost:3333/api/v1

# 1. cria uma campanha
CAMP=$(curl -s -X POST $API/campaigns -H 'content-type: application/json' \
  -d '{"name":"Feirão de Junho","status":"ACTIVE"}' | jq -r .id)

# 2. (opcional) cadastra um veículo
VEH=$(curl -s -X POST $API/vehicles -H 'content-type: application/json' \
  -d '{"make":"Volkswagen","model":"Nivus","year":2025,"priceCents":14999000,"highlights":["IPVA grátis"]}' | jq -r .id)

# 3. cria o briefing
BRIEF=$(curl -s -X POST $API/briefings -H 'content-type: application/json' \
  -d "{\"campaignId\":\"$CAMP\",\"vehicleId\":\"$VEH\",\"title\":\"Oferta Nivus\",\"format\":\"FEED\",\"requestedVariations\":6,\"input\":{\"oferta\":\"IPVA 2025 grátis + tanque cheio\"}}" | jq -r .id)

# 4. dispara a geração (idempotente)
curl -s -X POST $API/briefings/$BRIEF/generate \
  -H "Idempotency-Key: $(uuidgen)"

# 5. acompanha (status do briefing vira GENERATING → GENERATED)
curl -s $API/briefings/$BRIEF | jq '.status, (.creatives | length)'

# 6. lista os criativos com a imagem renderizada (imageUrl preenchido)
curl -s "$API/creatives?briefingId=$BRIEF" | jq '.items[] | {id, status, imageUrl}'

# 7. aprova um criativo (self-service)
curl -s -X POST $API/creatives/CREATIVE_ID/decision \
  -H 'content-type: application/json' -d '{"status":"APPROVED"}'

# quota do mês
curl -s $API/usage/quota | jq
```

Fluxo por baixo: `generate` → checa quota → enfileira `generate-creative`
(Claude Sonnet) → cria N criativos → enfileira `render-image` (Handlebars →
Puppeteer → PNG → R2) → cria `Approval` pendente. Acompanhe os logs do
`npm run worker`.

---

## 9. Fotos de veículo (upload direto pro R2)

```bash
# 1. pede uma URL assinada de upload
curl -s -X POST $API/vehicles/$VEH/photos/presign -H 'content-type: application/json' \
  -d '{"mimeType":"image/jpeg","kind":"EXTERIOR"}'
# -> { uploadUrl, key }

# 2. sobe o arquivo direto pro R2 (PUT na uploadUrl)
curl -s -X PUT "UPLOAD_URL" -H 'content-type: image/jpeg' --data-binary @foto.jpg

# 3. confirma e registra a Photo
curl -s -X POST $API/vehicles/$VEH/photos -H 'content-type: application/json' \
  -d '{"key":"KEY_DO_PASSO_1","kind":"EXTERIOR"}'
```

---

## Deploy (Railway)

- Suba Postgres (Neon) e Redis (Upstash) gerenciados.
- Use o `Dockerfile` (já instala o Chromium) para os dois serviços:
  - **web**: `npm run start`
  - **worker**: `npm run worker:start`
- Configure todas as variáveis de ambiente no painel do Railway.
- Rode `npm run prisma:deploy` no release (migrations).
