# Log de execuções do agente master

Histórico das rodadas do subagente `master` (implementação via `backend-dev` +
revisão via `code-reviewer`). Ver `docs/AGENTS.md` para o guia geral. Entradas
mais novas no topo.

Formato de cada entrada:

```
## AAAA-MM-DD HH:MM — <resumo curto da tarefa>

- Status: ✅ aprovado | ⚠️ precisa ajuste manual
- Arquivos: <lista dos arquivos tocados pelo backend-dev>
- Revisão: <veredito do code-reviewer — achados corrigidos / pendentes>
- Rodadas de correção: <0, 1 ou 2>
- typecheck/lint: <passou | falhou (motivo)>
```

---

## 2026-08-04 21:40 — Geração 500 em produção: rollback do enqueue, query da REDIS_URL e readiness que mentia

- Status: ✅ aprovado
- Contexto: no app publicado, `POST /briefings/:id/generate` devolveu 500 e o
  briefing `cmsfaisqc0001pb01s4uv6yxv` (org_demo) ficou preso em `GENERATING`
  com `errorMessage: null`, enquanto `/health/ready` reportava Redis verde.
- **A causa raiz mudou no meio da tarefa.** A hipótese inicial era o `family=0`
  ausente (private networking IPv6-only do Railway). A repro real do Victor
  mostrou outra coisa: a `REDIS_URL` é **Upstash com TLS** e a **cota do free
  tier estourou** — `ERR max requests limit exceeded. Limit: 500000`. O Redis
  respondia `PING`/`INFO` mas rejeitava os EVALSHA do BullMQ; por isso o
  readiness verde com o enqueue em 500. Os docs foram reescritos para não
  atribuir o incidente ao `family=0`.
- Implementado (3 frentes):
  1. `redisConnectionOptions()` propaga `family`/`db`/`connectTimeout` da query
     string da `REDIS_URL` para o BullMQ (antes só o client global honrava a
     query, porque recebe a URL inteira). Filtro `Number.isInteger`, para
     `family=0` não morrer de falsy; inválidos são descartados com warn.
     Interface exportada `RedisConnectionOptions` — segue objeto de opções,
     nunca instância ioredis. Vale como **robustez/portabilidade**, não como a
     causa deste incidente.
  2. Rollback do enqueue em `generateBriefing`: falha ao enfileirar deixa o
     briefing em `FAILED` com `failedAt` e a **mensagem real** do Redis em
     `errorMessage`, marca o `Job` via `markJobFailed`, e propaga um
     `ServiceUnavailableError` novo (503, code `SERVICE_UNAVAILABLE` na união
     `ErrorCode`) para o front distinguir "fila fora" de bug. As duas escritas
     do rollback ficaram em `try/catch` independentes e nenhuma mascara o erro
     original.
  3. `checkRedis()` deixou de ser só `PING` (que o Upstash respondia mesmo com a
     cota estourada). Agora faz `SET cognito:health:probe … PX 30000` e devolve
     `RedisHealth { ok, responds, acceptsWrites, error? }`; 1 comando no caminho
     feliz, `PING` extra só na falha, cache de 15s + dedupe de chamadas
     concorrentes. `/health/ready` ganhou schema zod (200 e 503) e expõe o
     degradado.
- Achados da rodada 1 de revisão (ambos CONFIRMED, ambos corrigidos):
  1. O rollback **não limpava o `idempotencyKey`** gravado instantes antes. O
     cliente que retentasse com a mesma chave — o comportamento canônico, ainda
     mais depois de um 503 dizendo "tente novamente" — caía no replay e recebia
     **200 com o job morto**, `idempotentReplay: true`, sem reenfileirar. O
     briefing ficava `FAILED` para sempre. Corrigido com `idempotencyKey: null`
     no rollback (campo já `String?`; NULLs são distintos na unique composta, sem
     migration).
  2. O comentário do cache e o `DEPLOY.md` afirmavam que "o healthcheck do
     Railway bate no `/health/ready` em loop" — falso: o `railway.json` aponta
     para `/health` (liveness, não toca Redis). Reescrito como cache defensivo,
     mais o aviso de **não** apontar o `healthcheckPath` para o readiness (cota
     estourada derrubaria a API inteira) e o registro de que
     `jobs.service.ts:74` curto-circuita pelo `isProduction` — em produção quem
     detecta a próxima cota estourada é o rollback + 503, não o readiness.
- Achado da rodada 2: aritmética errada por 2× no `DEPLOY.md` (~170 mil/mês é
  **por processo**, não "com dois processos"; e só a API expõe HTTP, o worker não
  tem rota de health). Corrigido.
- Documentado sem implementar, por decisão de infra ser do Victor: o free tier
  do Upstash **não sustenta o BullMQ** rodando o mês inteiro (heartbeat,
  stalled-check e polling em API + worker, 24/7, queimam os 500 mil comandos).
  Saídas registradas: plugin Redis do Railway (aí o `?family=0` vira
  obrigatório), Upstash pago, ou afrouxar os intervalos do BullMQ. **Nenhum
  tuning de intervalo foi mexido** — `config/queue.ts` intocado.
- Arquivos: `src/config/redis.ts`, `src/modules/briefings/briefings.service.ts`,
  `src/modules/health/health.routes.ts`, `src/modules/jobs/jobs.service.ts`,
  `src/shared/errors.ts`, `docs/{DEPLOY,RUNBOOK,FRONTEND}.md`,
  `tests/briefings-generate.test.ts` (novo), `tests/redis-connection.test.ts`
  (novo), `tests/redis-health.test.ts` (novo), `tests/health-routes.test.ts`
  (novo). Sem mudança de schema Prisma, sem migration.
- Revisão: 2 passadas do `code-reviewer`, que rodou os comandos por conta
  própria e validou por mutação (removendo o `idempotencyKey: null`, 2 testes
  falham). Todos os achados corrigidos; **nenhum pendente**.
- Rodadas de correção: 2
- typecheck/lint: passou (`tsc --noEmit` limpo, `eslint` limpo, 14 arquivos /
  124 testes passando, `prettier --check` limpo)
- Pendências fora do escopo, registradas pelo reviewer: (a) `createJobRecord`
  falhando entre o `updateMany` de `GENERATING` e o enqueue deixa a mesma classe
  de briefing preso (pré-existente); (b) `checkDatabase` em `config/prisma.ts`
  ainda usa `setTimeout` sem `clearTimeout`; (c) o `cognito-frontend` precisa de
  um commit para tratar o code `SERVICE_UNAVAILABLE` — hoje cai no ramo genérico
  de erro. **Não commitado**: mudanças deixadas no working tree a pedido do
  Victor.

---

## 2026-08-03 21:40 — Provedor de copy `fal` (any-llm) vira o default; Anthropic vira fallback

- Status: ✅ aprovado (com 1 pendência que só o Victor pode fechar)
- Objetivo do Victor: parar de pagar a Anthropic pela copy e centralizar o custo
  de IA na fal.ai, onde o Flux já é pago. Escopo fechado, contrato do
  `fal-ai/any-llm` já validado por ele (OpenAPI oficial + 1 chamada real, HTTP
  200) — os subagentes foram proibidos de re-pesquisar ou chamar a API.
- Implementado: `COPY_PROVIDER: z.enum(['fal','anthropic','openai']).default('fal')`;
  `generateText`/`generateVisionText` em `config/fal.ts` (`fal-ai/any-llm` e
  `/vision`); `generateCopyFal` reusando `buildSystemText` + `buildUserPrompt` +
  a mesma `parseAndValidate`; `model` no formato `fal:<modelo>`; visão da análise
  de referência por URL pública (sem base64). O caminho anthropic ficou
  **byte-idêntico**, com prompt caching, conforme pedido.
- **Custo sem tokens**: o any-llm cobra por request e não devolve contagem de
  tokens, então `estimateCostMicrocents` daria 0. `GenerationResult` ganhou
  `costMicrocents?: number | null` e `recordAiUsage` aceita o override.
- Achados que **bloqueavam** o merge (rodada 1 de revisão):
  1. Os testes novos **discavam para a rede real**: o bloco "provedor fal" não
     forçava o provedor, dependia do default do zod. O reviewer reproduziu com
     `COPY_PROVIDER=anthropic` → `401` de `api.anthropic.com`. Corrigido fixando
     o provedor no `vitest.config.ts` + mock do `@anthropic-ai/sdk`.
  2. `costMicrocents: 0` gravado em toda geração tornava "custo desconhecido"
     indistinguível de "grátis" — `SUM()` reportaria R$ 0,00 de IA para sempre.
     Vira `null` (a coluna já é `Int?`). O `??` teve de virar ternário explícito:
     `null ?? estimate(...)` com tokens zerados devolvia `0` de novo.
  3. `partial: true` (resposta truncada, HTTP 200) era ignorado e explodia
     depois como "JSON inválido", culpando o modelo em vez do `max_tokens`.
- Achados da rodada 2: docs de deploy ainda mandavam configurar a copy na
  Anthropic (o Railway trocaria de provedor **em silêncio**, já que a var não
  existe lá); o default `fal` não tinha teste (mudá-lo deixava a suíte verde);
  e a análise de referência mandava para o Claude tudo que não fosse `fal`,
  inclusive `openai` — contradizendo o que os docs prometiam.
- Arquivos: `config/env.ts`, `config/fal.ts`, `generation/generation.service.ts`,
  `usage/usage.service.ts`, `brand-books/analyze-reference.ts`,
  `brand-books/brand-books.routes.ts`, `brand-books/layout.ts`,
  `workers/generate-creative.ts`, `scripts/preview-creative.ts`,
  `tests/generation.test.ts`, `tests/env.test.ts` (novo), `vitest.config.ts`,
  `.env.example`, `README.md`, `CLAUDE.md`, `docs/{LOCAL,RUNBOOK,DEPLOY}.md`.
- Revisão: 3 passadas do `code-reviewer` (2 de auditoria + 1 de verificação).
  Todos os achados corrigidos; veredito final **sem bloqueador**.
- **Pendente para o Victor**: (a) `CLAUDE.md:72` ("Estado atual") ainda diz
  "Geração de copy (Claude)" — o `backend-dev` se recusou a editar arquivo de
  instrução por ordem de agente, e eu mantive a recusa; (b)
  `FAL_LLM_COST_MICROCENTS=0` até ele ler o preço real no dashboard do fal —
  até lá o `UsageLog` grava `null` (não medido), de propósito.
- Nota de processo: durante a verificação o `code-reviewer` rodou
  `git checkout -- src/config/env.ts` para desfazer um teste e apagou o diff
  inteiro do arquivo; restaurou e provou a identidade por `git hash-object`.
  Conferi o `git diff` do `env.ts` por conta própria — íntegro.
- Rodadas de correção: 2 (o limite)
- typecheck/lint: passou · testes: **93 (+3), 10 arquivos** · `COPY_PROVIDER=anthropic
  npx vitest run tests/generation.test.ts` → 12 passando, sem rede
- Não commitado, a pedido do Victor: a árvore ficou pronta para ele revisar.

---

## 2026-07-28 22:50 — Revisão das duas features + correção dos achados

- Status: ✅ aprovado com correções aplicadas
- Contexto: o Victor cobrou o que o CLAUDE.md já manda — **`code-reviewer` é
  sempre obrigatório**, mesmo quando a sessão só faz shipping de código escrito
  antes. As duas features tinham ido para branch e PR sem revisão nesta forma
  final.
- Revisão (rodada 1): o `code-reviewer` leu os 4 commits / 39 arquivos, rodou
  lint e a suíte, renderizou os 16 templates com copy no **teto do schema** e
  sondou o parser com planilhas sujas geradas na hora.
- Achados que **bloqueavam** o merge, todos confirmados por mim antes de corrigir:
  1. `parseNumber` lia vírgula de milhar en-US como decimal — "89,900" → 89,9 e
     "45,000" → 45 km, **sem erro no relatório**. Um carro de R$ 89.900 iria ao
     Instagram como R$ 89,90. Confirmei rodando a função isolada.
  2. `seminovo.hbs` decapitava a primeira linha do headline (altura fixa +
     `overflow: hidden` + `justify-content: flex-end`) e publicava assim.
  3. `destaque-clean.hbs`: eyebrow (make+model+trim) passava sob a caixa de preço.
  4. `financiamento.hbs`: sub_headline sumia debaixo do CTA absoluto.
- Não-bloqueantes corrigidos na mesma rodada: P2002 virando 500 no sync de
  templates (agora `upsert`), `LOG_PRETTY` que **ainda** inferia de NODE_ENV
  (o comentário afirmava o contrário — eu tinha dado esse ponto como resolvido
  antes, errado), falha de escrita sem log e sem abort, retry duplicando
  catálogo sem `externalId`, teto de linhas/erros, mensagem de cabeçalho, taxa
  aninhada na entrada, `as never` no script de preview.
- Arquivos: `import.parser.ts`, `import.service.ts`, `template-catalog.ts`,
  `config/logger.ts`, 4 `.hbs`, `preview-templates.ts`, `tests/vehicles-import.test.ts`.
- Ferramenta nova: `npm run templates:preview -- --copy-longa` (todo texto no
  teto do schema). É o cenário que teria pego os três templates quebrados.
- Rodadas de correção: 1 (segunda rodada de revisão sobre o commit `43ff13b`)
- typecheck/lint: passou · testes: 83 (+6) · 16 templates nos 3 cenários

---

## 2026-07-28 21:20 — Shipping: templates + import saem da working tree para branches

- Status: ✅ aprovado
- **Sem ciclo de subagente** (nada de código de feature foi escrito): a sessão
  começou com "não consegui visualizar a feature de importação no frontend" e a
  causa era essa — o código estava **inteiro e correto, mas nunca commitado**.
  Uma semana de trabalho (16 templates + import) vivia só na working tree das
  duas máquinas de repo, então não existia no Vercel nem no Railway.
- Diagnóstico: portas 3333/5173/5432/6379 todas livres (nada rodando) e
  `git status` com 13 arquivos modificados + 20 untracked no backend, 11
  modificados no frontend.
- Ambiente local levantado para conferir a feature de pé: `dev:db`
  (embedded-postgres), API e Vite. `GET /vehicles/import/template` → 200 com
  7 KB de xlsx real e content-type correto; `GET /vehicles` → 200.
- Validação antes de commitar: `typecheck` limpo, **77 testes / 9 arquivos**
  passando, `npm run build` do front OK (tsc + vite).
- Commits (branch `feat/templates-e-import`, pushada):
  1. `feat(templates)` — 16 templates, catálogo como fonte única, `render-data.ts`
  2. `feat(vehicles)` — import .xlsx
  3. `chore(logs,lint)` — `LOG_PRETTY` opt-in, eslint ignora `.local/`
  Front em `feat/import-catalogo` (import + layout responsivo), também pushada.
- Riscos de produção conferidos: `exceljs` está em `dependencies` (sobrevive ao
  `--omit=dev` do Railway), **nenhuma migration nova** (usa a `Vehicle`
  existente), e os `.hbs` resolvem por `process.cwd()/templates`, que existe no
  deploy — os 16 carregam pelo mesmo caminho que os 2 antigos.
- Pendente: PRs abertos **à mão** (gh ausente) e não mergeados; conferir que
  `LOG_PRETTY` não está `true` no painel do Railway.
- Rodadas de correção: 0
- typecheck/lint: passou

---

## 2026-07-27 22:45 — Import de catálogo: dependência, validação em runtime e ponta do front

- Status: ✅ aprovado
- Contexto: continuação da entrada abaixo. O código do backend já estava escrito
  e revisado, mas **`exceljs` não estava em `package.json`** — nada disso podia
  compilar numa máquina limpa (nem no Railway). Além disso faltava a ponta do
  usuário: sem botão no Catálogo, a feature não resolvia o gargalo de ativação.
- Arquivos:
  - `package.json` / `package-lock.json` — `exceljs@^4.4.0` como dependência de
    produção. Atenção: o `npm install` podou o `embedded-postgres` (instalado com
    `--no-save`); foi reinstalado.
  - `frontend/src/lib/types.ts` — `VehicleImportReport` + `VehicleImportRowError`.
  - `frontend/src/lib/api.ts` — `importVehicles(fileBase64, dryRun)`,
    `importTemplate()` e um helper `requestBlob` (a rota do modelo é autenticada,
    então `<a href>` puro não serve: o token do Clerk só existe em memória).
  - `frontend/src/screens/Catalog.tsx` — botão "Importar planilha" + `ImportModal`
    com fluxo em 2 passos: escolher o arquivo dispara `dryRun` (prévia sem gravar)
    e só o "Importar N veículo(s)" grava. Relatório com contadores e tabela de
    erros por linha ("L4 · make · Campo obrigatório").
- Revisão: validação **em runtime**, não só leitura. Subi Postgres real
  (embedded-postgres) + API em :3333 e rodei 25 verificações ponta-a-ponta sobre
  uma planilha suja de propósito (cabeçalho acentuado, preço "R$ 89.900,00", km
  "45.000", linha sem marca, linha com 3 erros, linha vazia). Todas passaram:
  preço→centavos, "Seminovo"→USED, destaques quebrados por `;` mas **não** por
  vírgula, acento preservado, números de linha reais (4 e 5), `dryRun` não grava,
  reimport vira update (não duplica), **isolamento multi-tenant** (outra org não
  vê nada e o mesmo `externalId` INSERE lá em vez de sequestrar o registro), e as
  entradas ruins devolvem 400/422 em português — nunca 500. O modelo baixado é um
  .xlsx válido e é importável por ele mesmo.
- Rodadas de correção: 0 (nenhum defeito encontrado no código do backend)
- typecheck/lint: passou — back `tsc --noEmit` e `eslint .` limpos, 9 arquivos /
  77 testes; front `tsc --noEmit` limpo e `vite build` OK (o front não tem ESLint).
- Não verificado: a aparência do modal no navegador (só compilação/build).

---

## 2026-07-27 22:05 — Import de catálogo em massa via planilha .xlsx

- Status: ✅ aprovado
- Contexto: gargalo de ativação — hoje o cliente cadastra estoque um a um pelo
  modal do Catálogo. Decisões fechadas pelo Victor antes de codar: `.xlsx` com
  `exceljs` (SheetJS proibido por CVEs), import **parcial** (linha ruim vira erro
  no relatório, nunca derruba o arquivo), upsert por `externalId`. Decisões de
  forma do master: transporte **JSON+base64** (precedente `photos/upload`; evita
  `@fastify/multipart` e mantém zod no type provider) e **sem BullMQ** (centenas
  de linhas, síncrono na request).
- Arquivos:
  - `src/modules/vehicles/import.parser.ts` (novo) — parser puro (sem Prisma, sem
    Fastify): normalização de cabeçalho por alias com match exato, preço→centavos
    com heurística pt-BR/en, km, ano, condição, destaques (`;` `|` quebra de
    linha — nunca vírgula), redução de células ricas do exceljs a texto.
  - `src/modules/vehicles/import.service.ts` (novo) — upsert por `externalId` via
    `findFirst`→`updateMany`/`create` no tenant db (sem `upsert` do Prisma: não há
    unique em `(organizationId, externalId)`), relatório e `dryRun`.
  - `src/modules/vehicles/vehicles.schemas.ts` (novo) — `createVehicleSchema` +
    derivados extraídos da rota (estilo `briefings.schemas.ts`), reusados na
    validação de cada linha.
  - `src/modules/vehicles/vehicles.routes.ts` — `POST /vehicles/import`
    (bodyLimit 15 MB) e `GET /vehicles/import/template` (xlsx binário on-the-fly).
  - `tests/vehicles-import.test.ts` (novo) — parser puro, buffers .xlsx gerados
    pelo exceljs no próprio teste (sem fixtures binários).
- Revisão: 2 rodadas. Rodada 1 → 2 achados CONFIRMED, ambos corrigidos e
  verificados empiricamente na rodada 2: **C1** hyperlink com rótulo em rich text
  (o `index.d.ts` do exceljs declara `text: string`, mas o leitor devolve
  `{ richText }`) causava `TypeError` fora do try/catch → HTTP 500; **C2** import
  circular parser↔routes, que invertia a camada e fazia importar o parser
  instanciar `PrismaClient`. Rodada 2 achou **C3** (`Date` inválida do exceljs →
  `RangeError` no `toISOString`, descartando o arquivo inteiro e virando 500 no
  cabeçalho), corrigido com guard de 1 linha + 2 testes de regressão provados por
  reversão. Multi-tenant auditado sem vazamento: `findFirst`/`updateMany`/`create`
  passam pela extension; `externalId` forjado não alcança outra org; `dryRun` não
  escreve. NITs N1–N6 (N+1 de queries, múltiplas abas, truncar mensagem, ordenar
  `errors`) deixados deliberadamente fora de escopo.
- Rodadas de correção: 2 (limite)
- typecheck/lint: passou — `tsc --noEmit` limpo, `eslint .` limpo, 9 arquivos /
  77 testes passando (eram 74). Gates rodados pelo master, não só reportados.

---

## 2026-07-23 00:00 — Consolidação da `main` + testes do isolamento multi-tenant

- Status: ✅ aprovado
- Contexto: sessão de revisão do estado do projeto. Trabalho represado em branches
  locais não publicadas foi salvo, `main` consolidada e a lacuna de cobertura mais
  crítica (multi-tenant) coberta.
- Arquivos:
  - `tests/tenant.test.ts` (novo) — 19 testes cobrindo a extension `tenantPrisma`:
    where escopado em todas as leituras, `create`/`createMany` carimbando a org,
    `update`/`updateMany`/`upsert` não-reatribuindo org, `Organization` fora do
    tenant, e orgs distintas não se enxergando. Sem banco: fake client que
    implementa o contrato de query-extension e captura os args finais.
  - `src/app.ts` — fix de CORS recuperado de worktree órfã (barra final na origem).
- Revisão: teste de mutação — inverter a ordem do spread em `sanitizeUpdateData`
  quebra exatamente os 2 testes de reatribuição de org (os testes têm dentes).
- Rodadas de correção: 1 (primeira versão do teste usava `any`, reprovado pelo lint
  e por `noUncheckedIndexedAccess`; retipado com interfaces explícitas).
- typecheck/lint: passou (tsc limpo, eslint limpo, 45/45 testes — eram 26).

---

## 2026-07-22 00:45 — Hardening multi-tenant: organizationId não-reatribuível em todas as escritas

- Status: ✅ aprovado
- Arquivos: `src/config/tenant.ts`
  - Parte 1 (create): `injectData` + `upsert.create` — `organizationId` movido para o FIM do spread, não-sobrescrivível por input (simétrico ao `injectWhere`).
  - Parte 2 (update): novo helper `sanitizeUpdateData` fixa `organizationId` por último no `data` de `update`/`updateMany`/`upsert.update` (só quando `data` é objeto presente). Fecha a reatribuição de org via `data.organizationId`.
- Revisão: 2 rodadas, ambas aprovadas sem achados CONFIRMED. Reviewer confirmou por grep que nenhum service passa `organizationId` no data (create ou update) via tenant client; setar a FK escalar no update é no-op semântico (where já escopado). Nota residual p/ futuro: `updateManyAndReturn` e raw ops (`$executeRaw`/`$queryRaw`) seguem sem injeção por design — não usados hoje.
- Rodadas de correção: 0 (as 2 rodadas foram partes planejadas, não correções de achado)
- typecheck/lint: passou (typecheck ok, lint limpo, 26/26 testes)
- Nota: rodado em modo emulado (background job não registra os agentes nomeados; papéis backend-dev/code-reviewer via general-purpose).

---

_(sem execuções anteriores)_
