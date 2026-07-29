import { CreativeFormat, type Prisma, type PrismaClient } from '@prisma/client';

/**
 * ════════════════════════════════════════════════════════════════════
 *  CATÁLOGO DE TEMPLATES — fonte única da verdade.
 * ════════════════════════════════════════════════════════════════════
 *
 * Cada entrada corresponde a um arquivo `templates/<format>/<slug>.hbs`.
 * O banco (`Template`) é só a projeção por org — provisionada pelo seed e por
 * `syncOrganizationTemplates`, para que o round-robin do worker de geração
 * (`generate-creative.ts`) distribua as variações entre TODOS os templates
 * ativos do formato.
 *
 * Regra: template novo entra aqui + o .hbs correspondente. Nada de cadastrar
 * template solto no banco.
 */

export const FEED_SIZE = { width: 1080, height: 1350 } as const;
export const STORIES_SIZE = { width: 1080, height: 1920 } as const;

export interface TemplateDefinition {
  /** Nome do arquivo em `templates/<format>/<slug>.hbs`. */
  readonly slug: string;
  readonly name: string;
  readonly format: CreativeFormat;
  readonly width: number;
  readonly height: number;
  /** Quando serve — usado na UI e na doc; não afeta o render. */
  readonly description: string;
  /**
   * Campos de `data` que o template realmente usa. Documental e exposto na API
   * (`Template.variablesSchema`); o render nunca quebra por campo ausente
   * (todo template degrada com `{{#if}}`).
   */
  readonly uses: readonly string[];
}

function def(
  slug: string,
  name: string,
  format: CreativeFormat,
  description: string,
  uses: readonly string[],
): TemplateDefinition {
  const size = format === CreativeFormat.FEED ? FEED_SIZE : STORIES_SIZE;
  return { slug, name, format, width: size.width, height: size.height, description, uses };
}

const BASE_USES = ['headline', 'cta', 'photoUrl', 'disclaimer', 'layout', 'brand'] as const;

/** Pares (feed, stories) de cada família de template. */
const FAMILIES: ReadonlyArray<{
  slug: string;
  name: string;
  description: string;
  uses: readonly string[];
}> = [
  {
    slug: 'oferta-destaque',
    name: 'Oferta em Destaque',
    description:
      'Peça-curinga: foto do veículo em tela cheia com o texto posicionado pelo brand book.',
    uses: [...BASE_USES, 'sub_headline', 'price'],
  },
  {
    slug: 'seminovo',
    name: 'Seminovo / Repasse',
    description:
      'Corte diagonal com selos de quilometragem e ano — o formato que vende carro usado.',
    uses: [...BASE_USES, 'price', 'vehicle.kmLabel', 'vehicle.anoLabel', 'vehicle.condicaoLabel'],
  },
  {
    slug: 'financiamento',
    name: 'Financiamento / Parcela',
    description:
      'Parcela em destaque máximo. Só renderiza os números que vierem do briefing (nunca inventa).',
    uses: [...BASE_USES, 'price', 'offer.parcela', 'offer.entrada', 'offer.taxa'],
  },
  {
    slug: 'feirao',
    name: 'Feirão / Campanha',
    description: 'Alta urgência: faixa de campanha, headline em caixa alta e período da ação.',
    uses: [...BASE_USES, 'price', 'offer.periodo', 'offer.validade', 'offer.selo'],
  },
  {
    slug: 'novidade',
    name: 'Chegou no Estoque',
    description: 'Anúncio de entrada de veículo, com tag "chegou" e o modelo em destaque.',
    uses: [...BASE_USES, 'sub_headline', 'price', 'vehicle.nome', 'vehicle.anoLabel'],
  },
  {
    slug: 'entrega-cliente',
    name: 'Entrega ao Cliente',
    description:
      'Moldura de foto com mensagem de parabéns — o post de maior engajamento no setor.',
    uses: [...BASE_USES, 'sub_headline', 'vehicle.nome'],
  },
  {
    slug: 'destaque-clean',
    name: 'Destaque Clean',
    description: 'Minimalista, muito respiro e cor sólida. Contrapeso visual no feed.',
    uses: [...BASE_USES, 'sub_headline', 'price', 'vehicle.nome'],
  },
  {
    slug: 'test-drive',
    name: 'Test-drive / Agende Visita',
    description: 'Split foto + bloco de cor, com diferenciais em lista e CTA dominante.',
    uses: [...BASE_USES, 'sub_headline', 'vehicle.highlights', 'vehicle.nome'],
  },
];

export const TEMPLATE_CATALOG: readonly TemplateDefinition[] = FAMILIES.flatMap((family) => [
  def(family.slug, `${family.name} (Feed)`, CreativeFormat.FEED, family.description, family.uses),
  def(
    `${family.slug}-stories`,
    `${family.name} (Stories)`,
    CreativeFormat.STORIES,
    family.description,
    family.uses,
  ),
]);

/** Definição de um slug, se existir no catálogo. */
export function findTemplateDefinition(slug: string): TemplateDefinition | undefined {
  return TEMPLATE_CATALOG.find((template) => template.slug === slug);
}

/** `variablesSchema` (JSON) publicado no banco/API para um template. */
function variablesSchemaOf(template: TemplateDefinition): Prisma.InputJsonValue {
  return {
    type: 'object',
    description: template.description,
    uses: [...template.uses],
  };
}

export interface SyncTemplatesResult {
  created: number;
  updated: number;
  total: number;
}

/**
 * Garante que a org tem uma linha `Template` para cada item do catálogo.
 *
 * Idempotente: cria o que falta e atualiza nome/dimensões/schema do que já
 * existe, **sem tocar em `isActive`** — se a org desativou um template, a
 * escolha dela é preservada.
 *
 * Recebe o PrismaClient global (não o tenant) porque roda em contexto
 * administrativo/seed, com o `organizationId` explícito.
 */
export async function syncOrganizationTemplates(
  prisma: PrismaClient,
  organizationId: string,
): Promise<SyncTemplatesResult> {
  let created = 0;
  let updated = 0;

  for (const template of TEMPLATE_CATALOG) {
    const existing = await prisma.template.findFirst({
      where: { organizationId, slug: template.slug, version: 1 },
      select: { id: true },
    });

    const fields = {
      name: template.name,
      format: template.format,
      width: template.width,
      height: template.height,
      variablesSchema: variablesSchemaOf(template),
    };

    if (existing) {
      await prisma.template.update({ where: { id: existing.id }, data: fields });
      updated += 1;
    } else {
      await prisma.template.create({
        data: { ...fields, organizationId, slug: template.slug, version: 1 },
      });
      created += 1;
    }
  }

  return { created, updated, total: TEMPLATE_CATALOG.length };
}
