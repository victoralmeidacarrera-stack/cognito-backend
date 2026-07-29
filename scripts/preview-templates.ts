/* Renderiza TODOS os templates do catálogo em PNG, sem Postgres, Redis, IA
 * nem rede. Serve para dois usos:
 *
 *   1. Loop de design: mexeu no .hbs → roda → olha o contact sheet → ajusta.
 *   2. Rede de segurança: se algum template quebrar (partial faltando, sintaxe
 *      Handlebars inválida), o script falha aqui e não em produção.
 *
 *   npx tsx scripts/preview-templates.ts
 *   npx tsx scripts/preview-templates.ts --photo https://exemplo.com/carro.jpg
 *   npx tsx scripts/preview-templates.ts --slug seminovo
 *   npx tsx scripts/preview-templates.ts --sem-dados      (tudo opcional vazio)
 *   npx tsx scripts/preview-templates.ts --copy-longa    (todo texto no TETO do schema)
 *
 * Os três cenários importam. `--sem-dados` pega rótulo órfão; `--copy-longa`
 * pega o oposto e é o que faltava: copy dentro do limite do schema (headline de
 * 120 chars) estourava três templates de feed em silêncio — um deles publicava
 * a peça com a primeira linha do headline cortada fora.
 *
 * Saída: .local/previews/<slug>.png + .local/previews/index.html
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeBrowser } from '../src/config/puppeteer.js';
import { buildRenderData, type BuildRenderDataInput } from '../src/modules/render/render-data.js';
import { renderToPng } from '../src/modules/render/render.service.js';
import { TEMPLATE_CATALOG } from '../src/modules/render/template-catalog.js';

const OUT_DIR = join(process.cwd(), '.local', 'previews');

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}
const onlySlug = flag('slug');
const photoFlag = flag('photo');
const semDados = args.includes('--sem-dados');
const copyLonga = args.includes('--copy-longa');

/* Fundo local (data URI) para o preview rodar offline: gradiente + horizonte,
 * só o suficiente para julgar contraste e composição. Com --photo, usa a real. */
const PLACEHOLDER_PHOTO =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#2b3a55"/><stop offset="55%" stop-color="#6a7fa3"/>
          <stop offset="100%" stop-color="#c9b28a"/>
        </linearGradient>
      </defs>
      <rect width="1080" height="1350" fill="url(#sky)"/>
      <ellipse cx="540" cy="1130" rx="430" ry="52" fill="rgba(0,0,0,.28)"/>
      <path d="M180 1090 q60-150 190-165 h340 q130 15 190 165 z" fill="#1b1f2a" opacity=".92"/>
      <circle cx="330" cy="1090" r="62" fill="#0d1016"/><circle cx="750" cy="1090" r="62" fill="#0d1016"/>
      <text x="540" y="640" font-family="sans-serif" font-size="34" fill="rgba(255,255,255,.55)"
        text-anchor="middle" letter-spacing="6">FOTO DO VEICULO</text>
    </svg>`,
  ).toString('base64');

/* O que um cenário precisa fornecer. Tipar (em vez do `as const` + `as never`
 * que estava aqui) é o ponto do script: se o contrato de `buildRenderData`
 * mudar, o preview quebra no typecheck em vez de renderizar peça errada. */
type PreviewScenario = Pick<
  BuildRenderDataInput,
  'copy' | 'vehicle' | 'brandBook' | 'factoryRestrictions' | 'briefingInput'
>;

/* Dados de exemplo — o cenário "cheio". Com --sem-dados testamos o oposto:
 * todo campo opcional vazio (é assim que chega um cliente recém-cadastrado). */
const FULL: PreviewScenario = {
  copy: {
    headline: 'Nivus Highline 2025 com IPVA pago',
    cta: 'Agende seu test-drive',
    sub_headline: 'Tanque cheio, garantia de fábrica e transferência inclusa.',
    descricao: 'Feirão de julho na Concessionária Demo.',
    emoji_sugerido: '🚗',
  },
  vehicle: {
    make: 'Volkswagen',
    model: 'Nivus',
    trim: 'Highline',
    year: 2024,
    modelYear: 2025,
    priceCents: 14_999_000,
    mileageKm: 32_400,
    color: 'Prata',
    fuel: 'Flex',
    transmission: 'Automático',
    plateEnding: '7',
    condition: 'USED',
    highlights: ['IPVA 2025 pago', 'Único dono', 'Revisões em concessionária', 'Garantia de 1 ano'],
  },
  brandBook: {
    name: 'Concessionária Demo',
    primaryColor: '#0A2540',
    secondaryColor: '#1565C0',
    accentColor: '#FFB300',
    typography: { heading: 'Poppins', body: 'Inter' },
    logoR2Key: null,
    layout: {},
  },
  factoryRestrictions: {
    disclaimerObrigatorio:
      'Oferta por tempo limitado, sujeita a análise de crédito. Consulte condições e estoque na loja.',
  },
  briefingInput: {
    parcela: 'R$ 1.290',
    entrada: 'R$ 29.900',
    taxa: '0,99% a.m.',
    periodo: '25 a 27/07',
    validade: '27/07',
    selo: 'Feirão de Julho',
  },
};

/* Todo texto no TETO do schema (headline 120, sub 160, cta 40) e um `trim`
 * longo como os que vêm do import de catálogo. Não é caso teórico: é a copy que
 * o Claude devolve quando o briefing tem muita condição, e ela precisa caber. */
const LONGA: PreviewScenario = {
  ...FULL,
  copy: {
    headline:
      'Volkswagen Nivus Highline 2025 com IPVA pago, tanque cheio, garantia de fábrica e transferência inclusa',
    cta: 'Agende agora o seu test-drive sem custo',
    sub_headline:
      'Condições especiais válidas somente neste fim de semana para os primeiros dez clientes que fecharem negócio na loja.',
    descricao: 'Feirão de julho na Concessionária Demo.',
    emoji_sugerido: '🚗',
  },
  vehicle: FULL.vehicle && {
    ...FULL.vehicle,
    trim: 'Highline 1.0 TSI Comfortline AT',
  },
};

const EMPTY: PreviewScenario = {
  copy: { headline: 'Condições especiais nesta semana', cta: 'Fale no WhatsApp' },
  vehicle: null,
  brandBook: {
    name: '',
    primaryColor: '#0A2540',
    secondaryColor: '#1565C0',
    accentColor: '#FFB300',
    typography: {},
    logoR2Key: null,
    layout: {},
  },
  factoryRestrictions: {},
  briefingInput: {},
};

async function main(): Promise<void> {
  const scenario = semDados ? EMPTY : copyLonga ? LONGA : FULL;
  const templates = onlySlug
    ? TEMPLATE_CATALOG.filter((t) => t.slug.startsWith(onlySlug))
    : TEMPLATE_CATALOG;

  if (templates.length === 0) {
    throw new Error(`Nenhum template com slug começando em "${onlySlug ?? ''}".`);
  }

  await mkdir(OUT_DIR, { recursive: true });
  console.log(
    `Renderizando ${templates.length} template(s) — cenário ${semDados ? 'SEM DADOS' : copyLonga ? 'COPY LONGA' : 'completo'}\n`,
  );

  const rendered: Array<{ slug: string; name: string; width: number; height: number }> = [];
  const failures: Array<{ slug: string; error: string }> = [];

  for (const template of templates) {
    const started = Date.now();
    try {
      const data = buildRenderData({
        copy: scenario.copy,
        vehicle: scenario.vehicle,
        brandBook: scenario.brandBook,
        factoryRestrictions: scenario.factoryRestrictions,
        briefingInput: scenario.briefingInput,
        backgroundUrl: photoFlag ?? PLACEHOLDER_PHOTO,
        canvas: { width: template.width, height: template.height },
      });

      const png = await renderToPng({
        format: template.format,
        slug: template.slug,
        width: template.width,
        height: template.height,
        data,
      });

      await writeFile(join(OUT_DIR, `${template.slug}.png`), png);
      rendered.push(template);
      console.log(
        `  ✔ ${template.slug.padEnd(28)} ${String(Date.now() - started).padStart(5)}ms  ${Math.round(png.length / 1024)}kb`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ slug: template.slug, error: message });
      console.error(`  ✘ ${template.slug.padEnd(28)} ${message}`);
    }
  }

  await writeFile(join(OUT_DIR, 'index.html'), contactSheet(rendered), 'utf8');

  console.log(`\n${rendered.length}/${templates.length} renderizados.`);
  console.log(`Contact sheet: ${join(OUT_DIR, 'index.html')}`);

  if (failures.length > 0) {
    console.error(`\n❌ ${failures.length} template(s) falharam.`);
    process.exitCode = 1;
  }
}

function contactSheet(
  templates: Array<{ slug: string; name: string; width: number; height: number }>,
): string {
  const cards = templates
    .map(
      (t) => `<figure>
      <img src="${t.slug}.png" alt="${t.name}" />
      <figcaption><strong>${t.name}</strong><span>${t.slug} · ${t.width}×${t.height}</span></figcaption>
    </figure>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" />
<title>Templates da Cognito — preview</title>
<style>
  body { margin:0; padding:32px; background:#0c0c0f; color:#f0eef8;
         font-family: 'DM Sans', system-ui, sans-serif; }
  h1 { font-size:20px; margin:0 0 4px; }
  p.meta { color:#9896aa; font-size:13px; margin:0 0 28px; }
  .grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap:24px; }
  figure { margin:0; background:#131318; border:1px solid #2a2a38; border-radius:12px; overflow:hidden; }
  img { width:100%; display:block; background:#000; }
  figcaption { padding:12px 14px; display:flex; flex-direction:column; gap:3px; font-size:13px; }
  figcaption span { color:#6b6a7d; font-size:11.5px; }
</style></head>
<body>
  <h1>Templates da Cognito AI</h1>
  <p class="meta">${templates.length} peças · gerado em ${new Date().toLocaleString('pt-BR')}</p>
  <div class="grid">${cards}</div>
</body></html>`;
}

main()
  .catch((err: unknown) => {
    console.error('❌ Preview falhou:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeBrowser());
