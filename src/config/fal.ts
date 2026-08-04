import { fal } from '@fal-ai/client';
import { env } from './env.js';
import { DomainError } from '../shared/errors.js';

/**
 * fal.ai — Flux 1.1 Pro (text-to-image).
 * Gera a imagem de fundo/cena do criativo. O texto (headline/preço/CTA) NUNCA
 * vem do Flux — é composto por cima pela camada HTML (Puppeteer), garantindo
 * texto exato. Por isso o prompt sempre pede "sem texto".
 */

const MODEL = 'fal-ai/flux-pro/v1.1';

let configured = false;
function ensureConfigured(): void {
  if (!env.FAL_API_KEY) {
    throw new DomainError('fal.ai não configurado (FAL_API_KEY ausente).');
  }
  if (!configured) {
    fal.config({ credentials: env.FAL_API_KEY });
    configured = true;
  }
}

export function falEnabled(): boolean {
  return Boolean(env.FAL_API_KEY);
}

export interface FalImageRequest {
  prompt: string;
  width?: number;
  height?: number;
  outputFormat?: 'jpeg' | 'png';
  seed?: number;
}

export interface FalImageResult {
  url: string;
  seed?: number;
}

// Reforço anti-texto anexado a todo prompt (defasagem do Flux com texto).
const NO_TEXT_SUFFIX =
  'clean composition with empty negative space for text overlay, no text, no words, no letters, no logos, no watermark';

/** Gera uma imagem com o Flux 1.1 Pro e devolve a URL pública (CDN do fal). */
export async function generateImage(req: FalImageRequest): Promise<FalImageResult> {
  ensureConfigured();

  const result = await fal.subscribe(MODEL, {
    input: {
      prompt: `${req.prompt}. ${NO_TEXT_SUFFIX}`,
      image_size:
        req.width && req.height ? { width: req.width, height: req.height } : 'portrait_4_3',
      num_images: 1,
      output_format: req.outputFormat ?? 'jpeg',
      safety_tolerance: '2',
      ...(req.seed != null ? { seed: req.seed } : {}),
    },
  });

  const data = result.data as { images?: Array<{ url?: string }>; seed?: number };
  const url = data.images?.[0]?.url;
  if (!url) {
    throw new DomainError('fal.ai não retornou imagem.');
  }
  return { url, ...(typeof data.seed === 'number' ? { seed: data.seed } : {}) };
}

// Modelos de remoção de fundo, em ordem de preferência (BiRefNet tem a
// melhor qualidade para objetos grandes como carros; rembg é o utilitário).
const REMBG_MODELS = ['fal-ai/birefnet', 'fal-ai/imageutils/rembg'] as const;

/**
 * Remove o fundo de uma imagem (ex.: foto real do veículo) e devolve a URL
 * do PNG com transparência. Tenta BiRefNet e cai pro rembg se indisponível.
 */
export async function removeBackground(imageUrl: string): Promise<string> {
  ensureConfigured();

  let lastError: unknown;
  for (const model of REMBG_MODELS) {
    try {
      const result = await fal.subscribe(model, { input: { image_url: imageUrl } });
      const data = result.data as { image?: { url?: string } };
      if (data.image?.url) return data.image.url;
      lastError = new DomainError(`${model} não retornou imagem.`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new DomainError('Falha ao remover o fundo da foto.');
}

// ── LLM (texto) via fal-ai/any-llm ────────────────────────────────────────
// Mesma conta/chave do Flux: centraliza o custo de IA num fornecedor só.
// Cobrança é por request (não por token) — a resposta NÃO traz uso de tokens.

// Endpoints do fal (não confundir com env.FAL_LLM_MODEL / env.FAL_VISION_MODEL,
// que são o MODELO passado no input da chamada).
const LLM_ENDPOINT = 'fal-ai/any-llm';
const LLM_VISION_ENDPOINT = 'fal-ai/any-llm/vision';

/** Shape da resposta dos endpoints any-llm (output + erro no corpo). */
interface FalLlmResponse {
  output?: string;
  reasoning?: string | null;
  partial?: boolean;
  error?: string | null;
}

export interface FalTextRequest {
  prompt: string;
  systemPrompt?: string;
  /** Default: env.FAL_LLM_MODEL (ex.: 'google/gemini-2.5-flash'). */
  model?: string;
  maxTokens?: number;
  /** 0..2; quanto maior, mais criativo. */
  temperature?: number;
}

export interface FalVisionRequest {
  prompt: string;
  systemPrompt?: string;
  /** URLs PÚBLICAS das imagens — o fal busca sozinho (não aceita base64). */
  imageUrls: string[];
  /** Default: env.FAL_VISION_MODEL. */
  model?: string;
  maxTokens?: number;
}

/**
 * O any-llm pode responder HTTP 200 com `error` preenchido (e sem output),
 * então o erro do corpo é tratado explicitamente antes do output vazio.
 * `partial: true` = resposta truncada (estourou o max_tokens): o JSON vem
 * cortado e o parse falharia com uma mensagem enganosa ("JSON inválido").
 */
function unwrapLlmOutput(data: FalLlmResponse, endpoint: string): string {
  if (data.error) {
    throw new DomainError(`fal.ai (${endpoint}) retornou erro: ${data.error}`);
  }
  if (data.partial) {
    throw new DomainError(`fal.ai (${endpoint}) truncou a resposta (aumente max_tokens).`);
  }
  const output = data.output?.trim();
  if (!output) {
    throw new DomainError(`fal.ai (${endpoint}) não retornou texto.`);
  }
  return output;
}

/** Gera texto com o fal-ai/any-llm e devolve o conteúdo cru (string). */
export async function generateText(req: FalTextRequest): Promise<string> {
  ensureConfigured();

  const result = await fal.subscribe(LLM_ENDPOINT, {
    input: {
      prompt: req.prompt,
      model: req.model ?? env.FAL_LLM_MODEL,
      // Explícito (o default do any-llm já é false): com reasoning ligado, os
      // modelos gemini-2.5 gastam o max_tokens pensando e a resposta volta
      // `partial: true` (truncada) antes de terminar o JSON.
      reasoning: false,
      ...(req.systemPrompt ? { system_prompt: req.systemPrompt } : {}),
      ...(req.temperature != null ? { temperature: req.temperature } : {}),
      ...(req.maxTokens != null ? { max_tokens: req.maxTokens } : {}),
    },
  });

  return unwrapLlmOutput(result.data as FalLlmResponse, LLM_ENDPOINT);
}

/**
 * Gera texto a partir de imagem(ns) com o fal-ai/any-llm/vision.
 * As imagens são passadas por URL pública — o fal faz o download.
 */
export async function generateVisionText(req: FalVisionRequest): Promise<string> {
  ensureConfigured();

  if (req.imageUrls.length === 0) {
    throw new DomainError('fal.ai (visão) exige ao menos uma URL de imagem.');
  }

  const result = await fal.subscribe(LLM_VISION_ENDPOINT, {
    input: {
      prompt: req.prompt,
      image_urls: req.imageUrls,
      model: req.model ?? env.FAL_VISION_MODEL,
      // Mesmo motivo do generateText: reasoning consome o max_tokens (512 aqui).
      reasoning: false,
      ...(req.systemPrompt ? { system_prompt: req.systemPrompt } : {}),
      ...(req.maxTokens != null ? { max_tokens: req.maxTokens } : {}),
    },
  });

  return unwrapLlmOutput(result.data as FalLlmResponse, LLM_VISION_ENDPOINT);
}

/**
 * Sobe um buffer pro storage do fal e devolve a URL pública (CDN fal.media).
 * Útil como storage de fallback quando o R2 não está configurado.
 */
export async function uploadToFalStorage(
  body: Buffer,
  opts?: { contentType?: string; expiresIn?: '1h' | '1d' | '7d' | '30d' | '1y' | 'never' },
): Promise<string> {
  ensureConfigured();
  const blob = new Blob([new Uint8Array(body)], { type: opts?.contentType ?? 'image/png' });
  return fal.storage.upload(
    blob,
    opts?.expiresIn ? { lifecycle: { expiresIn: opts.expiresIn } } : undefined,
  );
}
