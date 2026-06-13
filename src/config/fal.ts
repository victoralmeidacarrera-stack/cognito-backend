import { env } from './env.js';
import { DomainError } from '../shared/errors.js';

/**
 * fal.ai (Flux 1.1 Pro) — geração de imagem de fundo.
 * PLACEHOLDER: a interface está pronta para plugar, mas a integração real
 * ainda não foi implementada (decisão do projeto na Fase 1/2).
 */
export interface FalImageRequest {
  prompt: string;
  imageSize?: 'square' | 'portrait_16_9' | 'landscape_16_9';
}

export function falEnabled(): boolean {
  return Boolean(env.FAL_API_KEY);
}

export function generateBackgroundImage(_request: FalImageRequest): Promise<{ url: string }> {
  if (!falEnabled()) {
    throw new DomainError('fal.ai não configurado (FAL_API_KEY ausente).');
  }
  // TODO(fase futura): chamar o endpoint do Flux 1.1 Pro e devolver a URL.
  throw new DomainError('Integração fal.ai ainda não implementada (placeholder).');
}
