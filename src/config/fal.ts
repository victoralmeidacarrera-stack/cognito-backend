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
