import type Anthropic from '@anthropic-ai/sdk';
import { anthropic, ANTHROPIC_MODELS, type TokenUsage } from '../../config/anthropic.js';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { type TenantPrisma } from '../../config/tenant.js';
import { DomainError, NotFoundError } from '../../shared/errors.js';
import { claudeOutputSchema, type ClaudeOutput, type CreativeCopy } from '../../shared/schemas.js';
import {
  buildSystemBlocks,
  buildSystemText,
  buildUserPrompt,
  type GenerationContext,
} from './generation.prompt.js';

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

/** Valida o texto cru da IA (qualquer provedor) contra o schema de saída. */
function parseAndValidate(raw: string): ClaudeOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(raw));
  } catch {
    throw new DomainError('A IA não retornou um JSON válido.', { raw: raw.slice(0, 500) });
  }

  const result = claudeOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new DomainError('A saída da IA não bateu com o schema esperado.', {
      issues: result.error.issues,
    });
  }
  return result.data;
}

/**
 * Gera a copy com o provedor configurado (COPY_PROVIDER):
 * - 'anthropic' (default): SDK da Anthropic com prompt caching no BrandBook.
 * - 'openai': qualquer API compatível com OpenAI chat/completions
 *   (OpenAI, DeepSeek, Groq, Gemini OpenAI-compat, Ollama...), via
 *   LLM_BASE_URL + LLM_API_KEY + LLM_MODEL.
 * A saída passa pela MESMA validação de schema nos dois caminhos.
 */
export async function generateCopy(ctx: GenerationContext): Promise<GenerationResult> {
  if (env.COPY_PROVIDER === 'openai') return generateCopyOpenAI(ctx);
  return generateCopyAnthropic(ctx);
}

async function generateCopyAnthropic(ctx: GenerationContext): Promise<GenerationResult> {
  const model = ANTHROPIC_MODELS.briefing;

  const message = await anthropic.messages.create({
    model,
    max_tokens: 2048,
    system: buildSystemBlocks(ctx),
    messages: [{ role: 'user', content: buildUserPrompt(ctx) }],
  });

  const output = parseAndValidate(extractText(message.content));

  const usage: TokenUsage = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
  };

  return { output, usage, model };
}

/** Shape mínimo da resposta de um chat/completions compatível com OpenAI. */
interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

async function generateCopyOpenAI(ctx: GenerationContext): Promise<GenerationResult> {
  if (!env.LLM_BASE_URL || !env.LLM_MODEL) {
    throw new DomainError(
      'COPY_PROVIDER=openai exige LLM_BASE_URL e LLM_MODEL (LLM_API_KEY conforme o provedor).',
    );
  }

  const res = await fetch(`${env.LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(env.LLM_API_KEY ? { authorization: `Bearer ${env.LLM_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: env.LLM_MODEL,
      max_tokens: 2048,
      messages: [
        { role: 'system', content: buildSystemText(ctx) },
        { role: 'user', content: buildUserPrompt(ctx) },
      ],
    }),
  });

  const body = (await res.json().catch(() => ({}))) as OpenAIChatResponse;
  if (!res.ok) {
    throw new DomainError(
      `Provedor de copy respondeu ${res.status}: ${body.error?.message ?? 'erro desconhecido'}`,
    );
  }

  const raw = body.choices?.[0]?.message?.content ?? '';
  if (!raw) throw new DomainError('Provedor de copy não retornou conteúdo.');

  const output = parseAndValidate(raw);
  const usage: TokenUsage = {
    inputTokens: body.usage?.prompt_tokens ?? 0,
    outputTokens: body.usage?.completion_tokens ?? 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  return { output, usage, model: `openai:${env.LLM_MODEL}` };
}

/**
 * Copy determinística de fallback para DEV (Claude indisponível/sem chave).
 * Montada a partir do veículo/briefing; nunca usada em produção — o worker
 * só cai aqui fora de produção, com warning no log e model 'dev-fallback'.
 */
export function devFallbackOutput(ctx: GenerationContext): ClaudeOutput {
  const v = ctx.vehicle;
  const nome = v
    ? [v.make, v.model, String(v.modelYear ?? v.year)].filter(Boolean).join(' ')
    : ctx.briefing.title;

  const input = (ctx.briefing.input ?? {}) as Record<string, unknown>;
  const oferta =
    typeof input.oferta === 'string' && input.oferta.trim()
      ? input.oferta.trim()
      : typeof input.extras === 'string' && input.extras.trim()
        ? input.extras.trim()
        : 'condições especiais nesta semana';

  const highlights = (Array.isArray(v?.highlights) ? v.highlights : []).filter(
    (h): h is string => typeof h === 'string' && h.length > 0,
  );

  const headlineVariations = [
    `${nome}: ${oferta}`.slice(0, 120),
    ...highlights.slice(0, 3).map((h) => `${nome} com ${h}`.slice(0, 120)),
  ];

  return {
    headline: `${nome} com ${oferta}`.slice(0, 120),
    sub_headline: (highlights[0] ?? 'Condições válidas por tempo limitado').slice(0, 160),
    descricao:
      `${nome} disponível com ${oferta}. ` +
      (highlights.length > 0 ? `Destaques: ${highlights.join(', ')}. ` : '') +
      'Fale com a nossa equipe e agende sua visita.',
    cta: 'Agende seu test-drive',
    variacoes: {
      headline:
        headlineVariations.length > 0 ? headlineVariations : [`Conheça o ${nome}`.slice(0, 120)],
      cta: ['Fale no WhatsApp', 'Simule agora', 'Garanta o seu'],
    },
    emoji_sugerido: '🚗',
    justificativa:
      'Copy de fallback gerada localmente (sem Claude). Configure ANTHROPIC_API_KEY para copy real.',
  };
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
