/* Render demo offline: feed + stories via template real -> Puppeteer -> PNG.
 * Sem DB/Redis/fal: copy demo + fundo em cor sólida (photoUrl vazio).
 * Prova o motor de render (Handlebars + Puppeteer) e o preço no template.
 * Rode: OUT=<dir> npx tsx scripts/demo-render.ts
 */
import { writeFileSync } from 'node:fs';
import { closeBrowser } from '../src/config/puppeteer.js';
import { renderToPng } from '../src/modules/render/render.service.js';
import { formatPriceBRL } from '../src/shared/utils.js';

const brand = {
  primaryColor: '#0A2540',
  accentColor: '#FFB300',
  typography: { heading: 'Poppins', body: 'Inter' },
};

const data = {
  headline: 'Nivus 2025 com IPVA grátis',
  cta: 'Agende seu test-drive',
  sub_headline: 'Tanque cheio + garantia de fábrica',
  descricao: 'Feirão de Julho na Concessionária Demo.',
  emoji: '🚗',
  price: formatPriceBRL(14_999_000), // R$ 149.990
  disclaimer: 'Oferta por tempo limitado. Consulte condições e estoque na loja.',
  photoUrl: '', // sem Flux: fundo em cor sólida da marca
  brand,
};

const outDir = process.env.OUT ?? '.';
const jobs = [
  { format: 'FEED' as const, slug: 'oferta-destaque', width: 1080, height: 1350, file: 'feed.png' },
  {
    format: 'STORIES' as const,
    slug: 'oferta-destaque-stories',
    width: 1080,
    height: 1920,
    file: 'stories.png',
  },
];

async function main(): Promise<void> {
  for (const j of jobs) {
    const png = await renderToPng({
      format: j.format,
      slug: j.slug,
      width: j.width,
      height: j.height,
      data,
    });
    writeFileSync(`${outDir}/${j.file}`, png);
    console.log(`ok ${j.file} — ${png.length} bytes`);
  }
}

main()
  .catch((err) => {
    console.error('falhou:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeBrowser());
