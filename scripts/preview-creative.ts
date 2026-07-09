/* Preview ponta-a-ponta de UM criativo, sem precisar de Postgres/Redis.
 * Roda o pipeline real: Claude (copy) -> Flux (fundo) -> template Handlebars
 * -> Puppeteer (PNG) -> upload pro storage do fal -> imprime o LINK.
 *
 * Rode: npx tsx scripts/preview-creative.ts
 */
import type { BrandBook, Vehicle } from '@prisma/client';
import { generateImage, uploadToFalStorage } from '../src/config/fal.js';
import { closeBrowser } from '../src/config/puppeteer.js';
import type { GenerationContext } from '../src/modules/generation/generation.prompt.js';
import { buildVariations, generateCopy } from '../src/modules/generation/generation.service.js';
import { renderToPng } from '../src/modules/render/render.service.js';
import type { CreativeCopy } from '../src/shared/schemas.js';

// Copy de reserva caso a key da Anthropic não esteja válida — mantém o preview
// funcionando (o fundo Flux e o render continuam reais).
const FALLBACK_COPY: CreativeCopy = {
  headline: 'Nivus 2025 com IPVA grátis',
  cta: 'Agende seu test-drive',
  sub_headline: 'Tanque cheio + garantia de fábrica',
  descricao: 'Feirão de Julho na Concessionária Demo. Entrada facilitada em até 60x.',
  emoji_sugerido: '🚗',
};

// ── Dados de demonstração (o que numa run real vem do banco) ──────────────
const brand = {
  primaryColor: '#0A2540',
  secondaryColor: '#1565C0',
  accentColor: '#FFB300',
  typography: { heading: 'Poppins', body: 'Inter' },
};

const brandBook = {
  name: 'Concessionária Demo',
  toneOfVoice: 'Confiável, regional e direto ao ponto; sem superlativos vazios.',
  guidelines: 'Destacar condição de pagamento e diferenciais reais. Respeitar a montadora.',
  primaryColor: brand.primaryColor,
  secondaryColor: brand.secondaryColor,
  accentColor: brand.accentColor,
  typography: brand.typography,
} as unknown as BrandBook;

const vehicle = {
  make: 'Volkswagen',
  model: 'Nivus',
  trim: 'Highline',
  year: 2025,
  priceCents: 14_999_000,
  condition: 'NEW',
  color: 'prata',
  highlights: ['IPVA 2025 grátis', 'Tanque cheio de brinde', 'Garantia de fábrica'],
} as unknown as Vehicle;

const disclaimer = 'Oferta por tempo limitado. Consulte condições e estoque na loja.';

const ctx: GenerationContext = {
  briefing: {
    id: 'preview',
    title: 'Feirão de Julho — Nivus 2025',
    format: 'FEED',
    input: { oferta: 'IPVA 2025 grátis + tanque cheio', condicao: 'Entrada facilitada em até 60x' },
    requestedVariations: 6,
  },
  brandBook,
  vehicle,
  factoryRestrictions: { disclaimerObrigatorio: disclaimer },
};

async function main(): Promise<void> {
  console.log('① Claude gerando a copy...');
  let copy: CreativeCopy;
  try {
    const { output, model } = await generateCopy(ctx);
    const v = buildVariations(output, ctx.briefing.requestedVariations)[0];
    if (!v) throw new Error('nenhuma variação gerada');
    copy = v;
    console.log(`   headline: "${copy.headline}"  |  cta: "${copy.cta}"  (${model})`);
  } catch (err) {
    console.warn(`   ⚠ Claude indisponível (${err instanceof Error ? err.message : err}).`);
    console.warn('   → usando copy de exemplo; o fundo e o render seguem reais.');
    copy = FALLBACK_COPY;
  }

  console.log('② Flux gerando o fundo (1080x1350)...');
  const bgPrompt =
    'professional automotive advertising photograph of a prata 2025 Volkswagen Nivus SUV, ' +
    'parked in a premium modern setting, golden hour cinematic lighting, glossy reflections, ' +
    'shallow depth of field, photorealistic, ultra detailed, magazine-quality car commercial';
  const bg = await generateImage({
    prompt: bgPrompt,
    width: 1080,
    height: 1350,
    outputFormat: 'jpeg',
  });

  console.log('③ Renderizando o template (Handlebars → Puppeteer)...');
  const price =
    vehicle.priceCents != null
      ? `R$ ${(vehicle.priceCents / 100).toLocaleString('pt-BR')}`
      : 'sob consulta';
  const png = await renderToPng({
    format: 'FEED',
    slug: 'oferta-destaque',
    width: 1080,
    height: 1350,
    data: {
      headline: copy.headline,
      cta: copy.cta,
      sub_headline: copy.sub_headline ?? '',
      descricao: copy.descricao ?? '',
      emoji: copy.emoji_sugerido ?? '',
      price,
      disclaimer,
      photoUrl: bg.url,
      brand,
    },
  });

  console.log('④ Subindo o PNG final pro storage do fal...');
  const url = await uploadToFalStorage(png, { contentType: 'image/png', expiresIn: '7d' });

  console.log('\n✅ Criativo pronto! Abra no navegador (link válido por 7 dias):\n');
  console.log(`   ${url}\n`);
}

main()
  .catch((err) => {
    console.error('❌ Falhou:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeBrowser());
