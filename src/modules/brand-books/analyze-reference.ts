import { anthropic, ANTHROPIC_MODELS } from '../../config/anthropic.js';
import { env } from '../../config/env.js';
import { falEnabled, generateVisionText } from '../../config/fal.js';
import { logger } from '../../config/logger.js';
import { DomainError } from '../../shared/errors.js';
import { layoutSchema, LAYOUT_FONTS, TEXT_POSITIONS, type Layout } from './layout.js';

const log = logger.child({ module: 'analyze-reference' });

const ALLOWED_MEDIA = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type AllowedMedia = (typeof ALLOWED_MEDIA)[number];

function pickMediaType(contentType: string | null): AllowedMedia {
  const ct = (contentType ?? '').split(';')[0]?.trim().toLowerCase();
  return (ALLOWED_MEDIA as readonly string[]).includes(ct ?? '')
    ? (ct as AllowedMedia)
    : 'image/jpeg';
}

/** Baixa a imagem de referência e devolve base64 + media type para a IA. */
async function fetchAsBase64(url: string): Promise<{ data: string; mediaType: AllowedMedia }> {
  const res = await fetch(url);
  if (!res.ok) throw new DomainError(`Não consegui baixar a referência (HTTP ${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > 5 * 1024 * 1024) {
    throw new DomainError('Imagem de referência muito grande (máx. 5MB para análise).');
  }
  return {
    data: buf.toString('base64'),
    mediaType: pickMediaType(res.headers.get('content-type')),
  };
}

const SYSTEM = `Você é um diretor de arte. Recebe uma imagem de referência de um anúncio/criativo e descreve COMO o texto está disposto, para reproduzir a mesma disposição em outra peça.

Responda APENAS com um objeto JSON (sem markdown, sem comentários) com estas chaves:
- "textPosition": uma de ${TEXT_POSITIONS.map((p) => `"${p}"`).join(', ')} (onde o bloco de texto principal fica).
- "headlineFont" e "bodyFont": uma de ${LAYOUT_FONTS.map((f) => `"${f}"`).join(', ')} (escolha a mais parecida com a referência).
- "headlineSize", "bodySize", "priceSize", "ctaSize": inteiros em px para uma peça de 1080px de largura (headline costuma ser 60–120).
- "textColor": cor do texto em hex "#RRGGBB".
- "overlay": "gradient", "solid" ou "none" (o fundo escuro/faixa atrás do texto).

Não invente texto; descreva só a disposição visual.`;

const USER_PROMPT = 'Descreva a disposição do texto desta referência no formato pedido.';

/** Análise via fal-ai/any-llm/vision: a imagem vai por URL (o fal baixa). */
async function analyzeWithFal(imageUrl: string): Promise<string> {
  return generateVisionText({
    prompt: USER_PROMPT,
    systemPrompt: SYSTEM,
    imageUrls: [imageUrl],
    maxTokens: 512,
  });
}

/** Análise via Claude vision: a imagem vai em base64 (validada antes). */
async function analyzeWithAnthropic(imageUrl: string): Promise<string> {
  const { data, mediaType } = await fetchAsBase64(imageUrl);

  const response = await anthropic.messages.create({
    model: ANTHROPIC_MODELS.variations,
    max_tokens: 512,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
          { type: 'text', text: USER_PROMPT },
        ],
      },
    ],
  });

  return response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
}

/**
 * Analisa uma imagem de referência com a IA de visão e devolve uma sugestão de
 * layout (parcial), validada igual nos dois caminhos.
 *
 * Escolha do caminho: Claude vision só com `COPY_PROVIDER=anthropic` (ou como
 * último recurso, se a FAL_API_KEY não estiver configurada). Qualquer outro
 * provedor usa o fal-ai/any-llm/vision — inclusive `openai`, que não tem
 * endpoint de visão próprio aqui e, sem isso, discaria a Anthropic sem chave.
 */
export async function analyzeReferenceLayout(imageUrl: string): Promise<Partial<Layout>> {
  const useFal = env.COPY_PROVIDER !== 'anthropic' && falEnabled();
  const raw = useFal ? await analyzeWithFal(imageUrl) : await analyzeWithAnthropic(imageUrl);

  const text = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    log.warn({ text: text.slice(0, 300) }, 'IA não retornou JSON válido na análise da referência');
    throw new DomainError('A IA não retornou uma sugestão válida. Tente outra imagem.');
  }

  // Valida contra o schema (parcial): descarta campos fora do domínio.
  const result = layoutSchema.partial().safeParse(parsed);
  if (!result.success) {
    throw new DomainError('A sugestão da IA não bateu com o formato de layout esperado.');
  }
  return result.data;
}
