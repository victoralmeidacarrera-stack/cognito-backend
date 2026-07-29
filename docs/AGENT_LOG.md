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
