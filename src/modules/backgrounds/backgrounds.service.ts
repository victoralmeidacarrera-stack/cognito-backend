import { PhotoKind, type Vehicle } from '@prisma/client';
import { falEnabled, generateImage } from '../../config/fal.js';
import { logger } from '../../config/logger.js';
import { r2PublicUrl, uploadBuffer } from '../../config/r2.js';
import { type TenantPrisma } from '../../config/tenant.js';
import { buildBackgroundPrompt } from './background-prompt.js';

const log = logger.child({ module: 'backgrounds' });

/** Quantos fundos resolver por briefing (reusados entre as variações). */
const BACKGROUNDS_PER_BRIEFING = 2;

/** Fotos que servem como fundo de um criativo, em ordem de preferência. */
const USABLE_PHOTO_KINDS: PhotoKind[] = [
  PhotoKind.EXTERIOR,
  PhotoKind.BACKGROUND,
  PhotoKind.DETAIL,
  PhotoKind.INTERIOR,
];

export interface ResolveBackgroundsInput {
  organizationId: string;
  briefingId: string;
  format: 'FEED' | 'STORIES';
  vehicle: Vehicle | null;
}

/**
 * Resolve as URLs de fundo de um briefing — opção C:
 *   1. Se o veículo tem foto(s) real(is), usa-as (até 2, reusadas).
 *   2. Senão, e se o Flux estiver configurado, gera 2 fundos (cena sem texto)
 *      e os persiste no R2.
 *   3. Senão, devolve [] — os templates renderizam sobre cor sólida da marca.
 *
 * Best-effort: qualquer falha (Flux sem saldo, R2 indisponível) é logada e
 * devolve [] em vez de quebrar a geração.
 */
export async function resolveBriefingBackgrounds(
  db: TenantPrisma,
  input: ResolveBackgroundsInput,
): Promise<string[]> {
  // 1. Fotos reais do veículo têm prioridade absoluta.
  if (input.vehicle) {
    const photoUrls = await loadVehiclePhotoUrls(db, input.vehicle.id);
    if (photoUrls.length > 0) {
      log.info({ briefingId: input.briefingId, count: photoUrls.length }, 'fundo: foto real');
      return photoUrls;
    }
  }

  // 2. Sem foto real → Flux gera a cena (se configurado e com saldo).
  if (!falEnabled()) return [];
  try {
    const urls = await generateFluxBackgrounds(input);
    log.info({ briefingId: input.briefingId, count: urls.length }, 'fundo: Flux');
    return urls;
  } catch (err) {
    // Sem saldo na conta fal, timeout, etc. — segue com cor sólida.
    log.warn({ err, briefingId: input.briefingId }, 'falha ao gerar fundo Flux; usando cor sólida');
    return [];
  }
}

/** Carrega até N URLs públicas de fotos do veículo, na ordem de preferência. */
async function loadVehiclePhotoUrls(db: TenantPrisma, vehicleId: string): Promise<string[]> {
  const photos = await db.photo.findMany({
    where: { vehicleId, kind: { in: USABLE_PHOTO_KINDS } },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    take: BACKGROUNDS_PER_BRIEFING,
    select: { url: true, r2Key: true },
  });

  return photos.map((p) => p.url ?? r2PublicUrl(p.r2Key)).filter((u): u is string => Boolean(u));
}

/** Gera N fundos com o Flux e os sobe pro R2 (persistência > CDN temporária). */
async function generateFluxBackgrounds(input: ResolveBackgroundsInput): Promise<string[]> {
  const { width, height } = backgroundSize(input.format);
  const prompt = buildBackgroundPrompt(input.vehicle);
  // Prompt final visível no log — facilita ajustar em background-prompt.ts
  // ou via FLUX_BACKGROUND_PROMPT no .env.
  log.info({ briefingId: input.briefingId, prompt }, 'prompt do fundo Flux');

  const urls: string[] = [];
  for (let i = 0; i < BACKGROUNDS_PER_BRIEFING; i += 1) {
    const generated = await generateImage({ prompt, width, height, outputFormat: 'jpeg' });
    const persisted = await persistToR2(generated.url, input, i);
    urls.push(persisted);
  }
  return urls;
}

/**
 * Baixa a imagem da CDN do fal e a sobe pro R2 para uma URL estável.
 * Se o R2 não estiver configurado (url pública null), devolve a URL do fal.
 */
async function persistToR2(
  falUrl: string,
  input: ResolveBackgroundsInput,
  index: number,
): Promise<string> {
  try {
    const res = await fetch(falUrl);
    if (!res.ok) throw new Error(`download do fal falhou: HTTP ${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());
    const key = `backgrounds/${input.organizationId}/${input.briefingId}/${index}.jpg`;
    const { url } = await uploadBuffer({ key, body, contentType: 'image/jpeg' });
    return url ?? falUrl;
  } catch (err) {
    // R2 indisponível em dev — usa a URL do fal direto (efêmera, mas funciona).
    log.warn(
      { err, briefingId: input.briefingId },
      'falha ao persistir fundo no R2; usando CDN fal',
    );
    return falUrl;
  }
}

/** Dimensões do fundo conforme o formato (cobertas via object-fit no HTML). */
function backgroundSize(format: 'FEED' | 'STORIES'): { width: number; height: number } {
  return format === 'STORIES' ? { width: 1080, height: 1920 } : { width: 1080, height: 1350 };
}

// O prompt do fundo mora em ./background-prompt.ts (editável e com override
// via FLUX_BACKGROUND_PROMPT no .env).
