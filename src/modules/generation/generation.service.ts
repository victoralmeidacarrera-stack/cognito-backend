import type Anthropic from '@anthropic-ai/sdk';
import { anthropic, ANTHROPIC_MODELS, type TokenUsage } from '../../config/anthropic.js';
import { prisma } from '../../config/prisma.js';
import { type TenantPrisma } from '../../config/tenant.js';
import { DomainError, NotFoundError } from '../../shared/errors.js';
import { claudeOutputSchema, type ClaudeOutput, type CreativeCopy } from '../../shared/schemas.js';
import { buildSystemBlocks, buildUserPrompt, type GenerationContext } from './generation.prompt.js';

export interface GenerationResult {
  output: ClaudeOutput;
  usage: TokenUsage;
  model: string;
}

/** Carrega tudo que a geração precisa, já isolado por org via tenant db. */
export async function loadGenerationContext(
  db: TenantPrisma,
  organizationId: string,
  briefingId: string,
): Promise<GenerationContext> {
  const briefing = await db.briefing.findFirst({ where: { id: briefingId } });
  if (!briefing) throw new NotFoundError('Briefing');

  const [brandBook, org] = await Promise.all([
    db.brandBook.findFirst({
      where: { isActive: true },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { factoryRestrictions: true },
    }),
  ]);

  const vehicle = briefing.vehicleId
    ? await db.vehicle.findFirst({ where: { id: briefing.vehicleId } })
    : null;

  return {
    briefing: {
      id: briefing.id,
      title: briefing.title,
      format: briefing.format,
      input: briefing.input,
      requestedVariations: briefing.requestedVariations,
    },
    brandBook,
    vehicle,
    factoryRestrictions: org.factoryRestrictions,
  };
}

function extractText(blocks: Anthropic.ContentBlock[]): string {
  return blocks
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n')
    .trim();
}

function stripJsonFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/** Chama o Claude (Sonnet) com prompt caching no BrandBook e valida a saída. */
export async function generateCopy(ctx: GenerationContext): Promise<GenerationResult> {
  const model = ANTHROPIC_MODELS.briefing;

  const message = await anthropic.messages.create({
    model,
    max_tokens: 2048,
    system: buildSystemBlocks(ctx),
    messages: [{ role: 'user', content: buildUserPrompt(ctx) }],
  });

  const raw = stripJsonFences(extractText(message.content));

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DomainError('A IA não retornou um JSON válido.', { raw: raw.slice(0, 500) });
  }

  const result = claudeOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new DomainError('A saída da IA não bateu com o schema esperado.', {
      issues: result.error.issues,
    });
  }

  const usage: TokenUsage = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
  };

  return { output: result.data, usage, model };
}

/** Expande a saída do Claude em N variações de copy (1 por criativo). */
export function buildVariations(output: ClaudeOutput, count: number): CreativeCopy[] {
  const headlines = [output.headline, ...output.variacoes.headline];
  const ctas = [output.cta, ...output.variacoes.cta];

  return Array.from({ length: count }, (_, i) => ({
    headline: headlines[i % headlines.length] ?? output.headline,
    cta: ctas[i % ctas.length] ?? output.cta,
    sub_headline: output.sub_headline,
    descricao: output.descricao,
    emoji_sugerido: output.emoji_sugerido,
  }));
}
