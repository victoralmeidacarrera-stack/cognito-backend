import { CreativeFormat, Plan, PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

// Ids fixos e legíveis para tornar o seed idempotente (upsert por id).
const DEMO = {
  orgId: 'org_demo',
  userId: 'user_admin_demo',
  brandBookId: 'bb_demo',
  vehicleId: 'veh_demo',
  campaignId: 'cmp_demo',
  templateFeedId: 'tpl_feed_oferta',
  templateStoriesId: 'tpl_stories_oferta',
} as const;

async function main(): Promise<void> {
  // 1. Organização demo (plano Pro)
  const org = await prisma.organization.upsert({
    where: { id: DEMO.orgId },
    update: {},
    create: {
      id: DEMO.orgId,
      name: 'Concessionária Demo',
      slug: 'concessionaria-demo',
      plan: Plan.PRO,
      factoryRestrictions: {
        termosProibidos: ['imperdível', 'última chance'],
        disclaimerObrigatorio: 'Imagens meramente ilustrativas. Consulte condições na loja.',
        precoMinimoExibivel: true,
      },
    },
  });

  // 2. Usuário admin (owner) — clerkUserId é placeholder até wiring do Clerk
  const admin = await prisma.user.upsert({
    where: { id: DEMO.userId },
    update: {},
    create: {
      id: DEMO.userId,
      organizationId: org.id,
      clerkUserId: 'demo_clerk_owner',
      email: 'admin@concessionaria-demo.com.br',
      name: 'Admin Demo',
      role: UserRole.OWNER,
    },
  });

  // 3. BrandBook (identidade + diretrizes para prompt caching)
  const brandBook = await prisma.brandBook.upsert({
    where: { id: DEMO.brandBookId },
    update: {},
    create: {
      id: DEMO.brandBookId,
      organizationId: org.id,
      name: 'Manual de Marca — Demo',
      isActive: true,
      primaryColor: '#0A2540',
      secondaryColor: '#1565C0',
      accentColor: '#FFB300',
      palette: ['#0A2540', '#1565C0', '#FFB300', '#F5F7FA'],
      typography: { heading: 'Montserrat', body: 'Inter' },
      toneOfVoice: 'Confiável, direto e regional. Sem exageros. Foco em condição e benefício real.',
      guidelines:
        'Sempre destacar condição de pagamento e diferencial do veículo. ' +
        'Evitar superlativos vazios. Incluir CTA claro de visita ou WhatsApp. ' +
        'Respeitar disclaimers da montadora.',
    },
  });

  // 4. Veículo demo
  await prisma.vehicle.upsert({
    where: { id: DEMO.vehicleId },
    update: {},
    create: {
      id: DEMO.vehicleId,
      organizationId: org.id,
      make: 'Volkswagen',
      model: 'Nivus',
      trim: 'Highline 200 TSI',
      year: 2024,
      modelYear: 2025,
      priceCents: 14999000,
      mileageKm: 0,
      color: 'Cinza Platinum',
      fuel: 'Flex',
      transmission: 'Automático',
      condition: 'NEW',
      highlights: ['Pacote tech', 'Garantia de fábrica', 'IPVA 2025 grátis'],
    },
  });

  // 5. Campanha demo
  await prisma.campaign.upsert({
    where: { id: DEMO.campaignId },
    update: {},
    create: {
      id: DEMO.campaignId,
      organizationId: org.id,
      name: 'Feirão Junho 2026',
      description: 'Campanha de ofertas do feirão de junho.',
      status: 'ACTIVE',
      format: CreativeFormat.FEED,
    },
  });

  // 6. Templates base (feed + stories) — apontam para /templates/<format>/<slug>.hbs
  await prisma.template.upsert({
    where: {
      organizationId_slug_version: {
        organizationId: org.id,
        slug: 'oferta-destaque',
        version: 1,
      },
    },
    update: {},
    create: {
      id: DEMO.templateFeedId,
      organizationId: org.id,
      name: 'Oferta em Destaque (Feed)',
      slug: 'oferta-destaque',
      format: CreativeFormat.FEED,
      version: 1,
      width: 1080,
      height: 1350,
      variablesSchema: {
        type: 'object',
        required: ['headline', 'cta', 'price'],
        properties: {
          headline: { type: 'string' },
          cta: { type: 'string' },
          price: { type: 'string' },
        },
      },
    },
  });

  await prisma.template.upsert({
    where: {
      organizationId_slug_version: {
        organizationId: org.id,
        slug: 'oferta-destaque-stories',
        version: 1,
      },
    },
    update: {},
    create: {
      id: DEMO.templateStoriesId,
      organizationId: org.id,
      name: 'Oferta em Destaque (Stories)',
      slug: 'oferta-destaque-stories',
      format: CreativeFormat.STORIES,
      version: 1,
      width: 1080,
      height: 1920,
      variablesSchema: {
        type: 'object',
        required: ['headline', 'cta'],
        properties: {
          headline: { type: 'string' },
          cta: { type: 'string' },
        },
      },
    },
  });

  console.log('✅ Seed concluído:', {
    org: org.slug,
    admin: admin.email,
    brandBook: brandBook.name,
  });
}

main()
  .catch((err: unknown) => {
    console.error('❌ Seed falhou:', err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
