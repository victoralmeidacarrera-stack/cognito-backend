import type Anthropic from '@anthropic-ai/sdk';
import { type BrandBook, type Vehicle } from '@prisma/client';

/** Contexto necessário para gerar a copy de um briefing. */
export interface GenerationContext {
  briefing: {
    id: string;
    title: string;
    format: 'FEED' | 'STORIES';
    input: unknown;
    requestedVariations: number;
  };
  brandBook: BrandBook | null;
  vehicle: Vehicle | null;
  factoryRestrictions: unknown;
}

const SCHEMA_INSTRUCTIONS = `Você é o redator publicitário da Cognito AI, especializado em criativos
para Instagram (Feed e Stories) de concessionárias de veículos no Brasil.

Responda SEMPRE e SOMENTE com um único objeto JSON válido, sem markdown, sem
crases, sem texto antes ou depois, no formato EXATO:

{
  "headline": "string curta e forte (até 120 chars)",
  "sub_headline": "string de apoio (até 160 chars)",
  "descricao": "legenda do post (até 2200 chars)",
  "cta": "chamada para ação curta (até 40 chars)",
  "variacoes": {
    "headline": ["alternativas de headline"],
    "cta": ["alternativas de cta"]
  },
  "emoji_sugerido": "1 emoji coerente com a oferta",
  "justificativa": "por que essa abordagem funciona (até 1000 chars)"
}

Regras:
- Português do Brasil, tom regional e confiável, sem superlativos vazios.
- Respeite RIGOROSAMENTE as restrições da fábrica e o manual de marca.
- Gere variações suficientes para montar o número de criativos pedido.`;

/** Bloco de marca + restrições (estável por org) em texto puro. */
function buildBrandText(ctx: GenerationContext): string {
  const brandParts: string[] = [];
  if (ctx.brandBook) {
    brandParts.push(`# Manual de Marca: ${ctx.brandBook.name}`);
    if (ctx.brandBook.toneOfVoice) brandParts.push(`Tom de voz: ${ctx.brandBook.toneOfVoice}`);
    if (ctx.brandBook.guidelines) brandParts.push(`Diretrizes:\n${ctx.brandBook.guidelines}`);
    const colors = [
      ctx.brandBook.primaryColor,
      ctx.brandBook.secondaryColor,
      ctx.brandBook.accentColor,
    ]
      .filter(Boolean)
      .join(', ');
    if (colors) brandParts.push(`Cores da marca: ${colors}`);
  }
  brandParts.push(
    `# Restrições da fábrica\n${JSON.stringify(ctx.factoryRestrictions ?? {}, null, 2)}`,
  );
  return brandParts.join('\n\n');
}

/**
 * System prompt em texto puro — agnóstico de provedor. É este texto que vai
 * para qualquer IA compatível com OpenAI (COPY_PROVIDER=openai).
 */
export function buildSystemText(ctx: GenerationContext): string {
  return `${SCHEMA_INSTRUCTIONS}\n\n${buildBrandText(ctx)}`;
}

/** Blocos de system com prompt caching no bloco estável (marca + restrições). */
export function buildSystemBlocks(ctx: GenerationContext): Anthropic.TextBlockParam[] {
  // O bloco estável (instruções + marca + restrições) é o MESMO entre gerações
  // da mesma org → cache_control ephemeral garante cache hit nas variações.
  return [
    { type: 'text', text: SCHEMA_INSTRUCTIONS },
    {
      type: 'text',
      text: buildBrandText(ctx),
      cache_control: { type: 'ephemeral' },
    },
  ];
}

/** Mensagem do usuário: o que muda a cada briefing (não cacheado). */
export function buildUserPrompt(ctx: GenerationContext): string {
  const parts: string[] = [];
  parts.push(`Briefing: ${ctx.briefing.title}`);
  parts.push(`Formato: ${ctx.briefing.format}`);
  parts.push(`Número de variações desejadas: ${ctx.briefing.requestedVariations}`);

  if (ctx.vehicle) {
    const v = ctx.vehicle;
    const price =
      v.priceCents != null ? `R$ ${(v.priceCents / 100).toLocaleString('pt-BR')}` : 'sob consulta';
    parts.push(
      `Veículo: ${v.make} ${v.model} ${v.trim ?? ''} ${v.year} — ${price}, ${v.condition}` +
        (Array.isArray(v.highlights) && v.highlights.length
          ? `\nDiferenciais: ${(v.highlights as string[]).join(', ')}`
          : ''),
    );
  }

  parts.push(
    `Dados do briefing (JSON livre do cliente):\n${JSON.stringify(ctx.briefing.input ?? {}, null, 2)}`,
  );
  parts.push('Gere a copy agora, respondendo apenas com o objeto JSON.');
  return parts.join('\n\n');
}
