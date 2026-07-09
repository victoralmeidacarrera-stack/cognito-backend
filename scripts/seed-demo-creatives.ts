/* Popula a org demo com criativos JÁ renderizados (com preço), hospedados no
 * storage do fal. Serve para ver a Biblioteca/Aprovações vivas sem depender de
 * Redis/Claude. Idempotente-ish: cria um briefing novo a cada run.
 * Rode do worktree com DATABASE_URL + FAL_API_KEY no ambiente.
 */
import {
  CreativeFormat,
  CreativeStatus,
  ApprovalStatus,
  BriefingStatus,
  PrismaClient,
} from '@prisma/client';
import { uploadToFalStorage } from '../src/config/fal.js';
import { renderToPng } from '../src/modules/render/render.service.js';
import { closeBrowser } from '../src/config/puppeteer.js';
import { formatPriceBRL } from '../src/shared/utils.js';

const prisma = new PrismaClient();
const ORG = 'org_demo';
const price = formatPriceBRL(14_999_000); // R$ 149.990
const disclaimer = 'Imagens meramente ilustrativas. Consulte condições na loja.';
const brand = {
  primaryColor: '#0A2540',
  accentColor: '#FFB300',
  typography: { heading: 'Montserrat', body: 'Inter' },
};

const variations = [
  {
    format: CreativeFormat.FEED,
    slug: 'oferta-destaque',
    w: 1080,
    h: 1350,
    headline: 'Nivus 2025 com IPVA grátis',
    cta: 'Agende seu test-drive',
    emoji: '🚗',
  },
  {
    format: CreativeFormat.FEED,
    slug: 'oferta-destaque',
    w: 1080,
    h: 1350,
    headline: 'Seu Nivus com tanque cheio',
    cta: 'Fale no WhatsApp',
    emoji: '⛽',
  },
  {
    format: CreativeFormat.FEED,
    slug: 'oferta-destaque',
    w: 1080,
    h: 1350,
    headline: 'Garantia de fábrica + bônus',
    cta: 'Simule agora',
    emoji: '✅',
  },
  {
    format: CreativeFormat.STORIES,
    slug: 'oferta-destaque-stories',
    w: 1080,
    h: 1920,
    headline: 'Feirão VW: Nivus Highline',
    cta: 'Arraste pra cima',
    emoji: '🔥',
  },
];

async function main(): Promise<void> {
  const briefing = await prisma.briefing.create({
    data: {
      organizationId: ORG,
      campaignId: 'cmp_demo',
      vehicleId: 'veh_demo',
      brandBookId: 'bb_demo',
      title: 'Feirão Nivus 2025 — demo',
      format: CreativeFormat.FEED,
      status: BriefingStatus.GENERATED,
      input: { oferta: 'IPVA 2025 grátis + tanque cheio', condicao: 'Entrada facilitada' },
      requestedVariations: variations.length,
      generatedAt: new Date(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  });

  for (let i = 0; i < variations.length; i++) {
    const v = variations[i]!;
    const templateId =
      v.format === CreativeFormat.STORIES ? 'tpl_stories_oferta' : 'tpl_feed_oferta';
    const png = await renderToPng({
      format: v.format,
      slug: v.slug,
      width: v.w,
      height: v.h,
      data: {
        headline: v.headline,
        cta: v.cta,
        emoji: v.emoji,
        price,
        disclaimer,
        photoUrl: '',
        brand,
      },
    });
    const imageUrl = await uploadToFalStorage(png, { contentType: 'image/png', expiresIn: '30d' });

    const creative = await prisma.creative.create({
      data: {
        organizationId: ORG,
        briefingId: briefing.id,
        templateId,
        format: v.format,
        status: CreativeStatus.RENDERED,
        variationIndex: i,
        copy: { headline: v.headline, cta: v.cta, emoji_sugerido: v.emoji },
        imageUrl,
        imageR2Key: `demo/${briefing.id}/${i}.png`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });

    await prisma.approval.create({
      data: {
        organizationId: ORG,
        creativeId: creative.id,
        status: i === 0 ? ApprovalStatus.APPROVED : ApprovalStatus.PENDING,
        ...(i === 0 ? { decidedAt: new Date(), decidedById: 'user_admin_demo' } : {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });
    console.log(`✔ criativo ${i + 1}/${variations.length} (${v.format}) → ${imageUrl}`);
  }
  console.log(`\nBriefing demo: ${briefing.id} · ${variations.length} criativos`);
}

main()
  .catch((err) => {
    console.error('falhou:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeBrowser();
    await prisma.$disconnect();
  });
