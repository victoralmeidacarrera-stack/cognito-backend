# Templates de criativo — como funcionam e como criar mais

O template é **o produto**. O cliente não vê o Fastify, vê o PNG. Este documento
é o que você precisa para adicionar o próximo.

## Onde as coisas estão

```
templates/
  feed/<slug>.hbs           1080×1350
  stories/<slug>-stories.hbs 1080×1920
  partials/
    base-style.hbs   tokens de marca, reset, utilitários  (vai dentro de <style>)
    legal.hbs        disclaimer, só renderiza se existir
    store-tag.hbs    logo da loja, ou o nome quando não há logo
    disclaimer.hbs   legado — usado só pelos dois `oferta-destaque`

src/modules/render/
  template-catalog.ts   catálogo (fonte única) + syncOrganizationTemplates
  render-data.ts        contrato de dados entregue ao Handlebars
  render.service.ts     Handlebars → Puppeteer → PNG → R2
  template-loader.ts    compila e cacheia os .hbs
```

O banco (`Template`) é só a projeção por org. O worker de geração
(`generate-creative.ts`) distribui as variações **em round-robin entre todos os
templates ativos do formato** — ou seja, template novo no catálogo já entra na
rotação sem mexer em mais nada.

## O loop de design

```powershell
npm run templates:preview                          # renderiza os 16 em .local/previews/
npm run templates:preview -- --slug seminovo       # só uma família
npm run templates:preview -- --photo <url>         # com foto real
npm run templates:preview -- --sem-dados           # cenário vazio (cliente novo)
```

Abra `.local/previews/index.html` (contact sheet). Mexeu no `.hbs` → roda → olha →
ajusta. **Não precisa de Postgres, Redis, IA nem internet.**

O script também é rede de segurança: partial faltando ou Handlebars inválido
falha ali, com exit code 1, e não em produção.

## Dados disponíveis no template

Montados por `buildRenderData` (`render-data.ts`) — o mesmo builder usado pelo
worker e pelo preview, de propósito: preview que mente não serve para nada.

| Campo | Observação |
|---|---|
| `headline` `cta` `sub_headline` `descricao` `emoji` | copy da IA |
| `price` | já formatado (`R$ 149.990`); **vazio** se o veículo não tem preço |
| `photoUrl` | fundo resolvido (foto real → Flux → vazio) |
| `disclaimer` | de `Organization.factoryRestrictions` |
| `vehicle.*` | `nome`, `anoLabel` ("2024/2025"), `kmLabel` ("32.400 km"), `condicaoLabel`, `isUsed`, `highlights` (máx. 4), cor, câmbio… · **`null` quando o briefing não tem veículo** |
| `offer.*` | `parcela`, `entrada`, `taxa`, `validade`, `periodo`, `selo` — **só o que o usuário digitou no briefing** |
| `store.name` `store.logoUrl` | assinatura da loja |
| `brand.*` | cores + `onPrimary`/`onSecondary`/`onAccent` (texto legível calculado) |
| `layout.*` | posição/fonte/tamanhos do brand book |
| `canvas.width/height` | dimensões do template |

### Duas regras que não se quebram

1. **Nenhum número financeiro é calculado.** Parcela, entrada e taxa só aparecem
   se vieram do briefing. Simular financiamento sem CET é propaganda enganosa, e
   o template não é o lugar dessa conta. Quem responde pela oferta é a loja.
2. **Todo campo é opcional.** Um cliente recém-cadastrado não tem veículo, logo,
   disclaimer nem condições. Envolva tudo em `{{#if}}` e valide com
   `--sem-dados` antes de considerar pronto.

## Checklist para um template novo

1. Adicione a família em `FAMILIES` (`template-catalog.ts`) — gera feed + stories.
2. Crie `templates/feed/<slug>.hbs` e `templates/stories/<slug>-stories.hbs`.
3. Comece por `{{> base-style}}` dentro do `<style>`; escreva só a composição.
4. Use `{{> legal}}` e `{{> store-tag}}` em vez de reescrever.
5. `npm run templates:preview -- --slug <slug>` e olhe a peça.
6. Rode também com `--sem-dados`.
7. `npm run typecheck && npm test && npm run lint`.
8. Nas orgs existentes: `POST /templates/sync` (OWNER/ADMIN) provisiona a peça nova.

## Armadilhas que já custaram tempo

- **`min-width: auto` em flex e grid.** É o default e impede o item de encolher
  abaixo do próprio min-content — foi o que fez a terceira caixa de specs e o CTA
  vazarem da peça. Em flex use `min-width: 0`; em grid use `minmax(0, 1fr)`, nunca
  `1fr` puro.
- **`layout.headlineSize` não serve para todo layout.** Ele é calibrado para a
  peça-pôster (texto sobre foto cheia, 84px). Em template com ficha técnica,
  preço e CTA disputando espaço, defina a própria escala.
- **Cor de marca clara.** Nunca assuma texto branco: use `var(--on-primary)` /
  `var(--on-accent)`, calculados por luminância em `readableOn`.
- **Elemento absoluto no rodapé sobre conteúdo centralizado.** Reserve o espaço
  com `padding-bottom` no `body` (foi o bug do `entrega-cliente`).
- As fontes vêm do Google Fonts por `@import`: **o render precisa de rede**. Sem
  rede, cai no fallback do sistema e a peça muda de cara.

## Estado atual

8 famílias × 2 formatos = **16 templates**, todos renderizando. A próxima peça de
maior valor é o **carrossel de estoque** (3–5 veículos numa peça) — exige mudar o
modelo de dados, porque hoje um briefing carrega um veículo só.
