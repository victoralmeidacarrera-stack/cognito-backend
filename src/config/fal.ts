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
