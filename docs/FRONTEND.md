# Guia de integração — Frontend

Tudo que o front precisa pra conversar com o backend. O **contrato vivo** está em
`GET /docs` (Swagger UI) e o JSON OpenAPI em `GET /docs/json` — dá pra gerar um
client tipado a partir dele (ex.: `openapi-typescript`, `orval`).

## Base

- Base URL (dev): `http://localhost:3333`
- Prefixo da API: `/api/v1`
- Health: `GET /health` (liveness) e `GET /health/ready` (DB + Redis)
- Docs: `GET /docs`

## Autenticação

Toda rota sob `/api/v1` exige um usuário autenticado.

**Produção (Clerk):** envie o token de sessão do Clerk no header:

```
Authorization: Bearer <clerk_session_token>
```

O backend valida o token, resolve o usuário + organização e isola tudo por org.
O provisionamento (criar org/usuário) acontece via webhook do Clerk — o front não
precisa criar org manualmente.

**Desenvolvimento (sem Clerk):** com `AUTH_DEV_BYPASS=true` (default em dev), não
precisa de token. O backend usa o admin/org do seed. Para simular outra org:

```
x-dev-user-id: <id do usuário>
x-dev-org-id: <id da organização>
```

## Bootstrap da sessão

Logo após o login, chame:

```
GET /api/v1/me
→ { user: {id,email,name,role}, organization: {id,name,slug,plan}, quota: {...} }
```

Use isso para montar o header (nome da org, plano) e mostrar a quota.

## Formatos padrão

- **Erro** (qualquer status >= 400):
  ```json
  { "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...], "requestId": "req-1" } }
  ```
  Códigos: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `QUOTA_EXCEEDED` (402),
  `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `RATE_LIMITED` (429),
  `DOMAIN_ERROR` (422), `INTERNAL` (500).
- **Listas paginadas:** `{ items: [...], total, page, perPage }`.
  Query: `?page=1&perPage=20`.
- **Rate limit:** 300 req/min por IP (headers `x-ratelimit-*`).

## Fluxo principal (happy path)

```
1. POST /api/v1/campaigns                 { name }                         → { id }
2. POST /api/v1/vehicles                  { make, model, year, ... }       → { id }   (opcional)
3. POST /api/v1/vehicles/:id/photos/presign { mimeType }                   → { uploadUrl, key }
   PUT  <uploadUrl>  (upload direto no R2, header Content-Type)
   POST /api/v1/vehicles/:id/photos       { key }                          → { id }
4. POST /api/v1/briefings                 { campaignId, title, format, requestedVariations, input, vehicleId? }
                                                                            → { id }
5. POST /api/v1/briefings/:id/generate    header Idempotency-Key: <uuid>   → 202 { jobId, status }
   - repetir com a MESMA Idempotency-Key devolve o mesmo job (200), não duplica.
   - se a quota estourar: 402/422 com code QUOTA_EXCEEDED/DOMAIN_ERROR.
6. polling: GET /api/v1/briefings/:id      → { status, creatives: [...] }
   - status: DRAFT → GENERATING → GENERATED (ou FAILED)
7. GET /api/v1/creatives?briefingId=:id    → { items: [{ id, status, imageUrl, copy, approval }] }
   - status do criativo: COPY_READY → RENDERING → RENDERED
   - imageUrl preenchido quando RENDERED.
8. POST /api/v1/creatives/:id/decision     { status: "APPROVED" | "REJECTED", note? }
```

> A geração é assíncrona (filas). Faça polling no `GET /briefings/:id` (ou
> `/creatives`) a cada ~2s até `GENERATED` / `RENDERED`.

## Gerar um client tipado (opcional)

```bash
npx openapi-typescript http://localhost:3333/docs/json -o src/api/schema.d.ts
```

Me avise a stack do front (Next.js, Vite/React, etc.) que eu deixo o client +
hooks prontos.
