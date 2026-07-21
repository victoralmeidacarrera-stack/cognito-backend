import { PhotoKind, type Vehicle } from '@prisma/client';
import { env } from '../../config/env.js';
import {
  falEnabled,
  generateImage,
  removeBackground,
  uploadToFalStorage,
} from '../../config/fal.js';
import { logger } from '../../config/logger.js';
import { getBrowser } from '../../config/puppeteer.js';
import { r2Configured, r2PublicUrl, uploadBuffer } from '../../config/r2.js';
import { type TenantPrisma } from '../../config/tenant.js';
import { buildBackgroundPrompt, buildEmptyScenePrompt } from './background-prompt.js';

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
  /** Prompt do fundo escrito pelo usuário no briefing (vence env/default). */
  promptOverride?: string | null;
}

/**
 * Resolve as URLs de fundo de um briefing:
 *   1. Veículo COM foto real → COMPOSIÇÃO: recorta o carro da foto (remoção
 *      de fundo via fal) e cola sobre cenas vazias geradas pelo Flux — o
 *      carro verdadeiro do estoque, no cenário publicitário da IA.
 *      (VEHICLE_COMPOSITE=false volta a usar a foto crua como fundo.)
 *   2. Veículo SEM foto → Flux gera a cena com o carro (prompt descritivo).
 *   3. Nada disponível → [] — templates renderizam sobre cor sólida da marca.
 *
 * Best-effort em TODAS as etapas: recorte/Flux/composição falhando, cai pro
 * degrau anterior (foto crua → cor sólida) sem quebrar a geração.
 */
export async function resolveBriefingBackgrounds(
  db: TenantPrisma,
  input: ResolveBackgroundsInput,
): Promise<string[]> {
  // 1. Fotos reais do veículo têm prioridade absoluta.
  if (input.vehicle) {
    const photoUrls = await loadVehiclePhotoUrls(db, input.vehicle.id);
    if (photoUrls.length > 0) {
      if (env.VEHICLE_COMPOSITE === 'true' && falEnabled()) {
        try {
          const urls = await composeVehicleBackgrounds(input, photoUrls[0]!);
          log.info(
            { briefingId: input.briefingId, count: urls.length },
            'fundo: composição (foto real recortada + cena Flux)',
          );
          return urls;
        } catch (err) {
          log.warn(
            { err, briefingId: input.briefingId },
            'composição falhou; usando a foto crua como fundo',
          );
        }
      }
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

// ── Composição: recorte da foto real sobre cena Flux ───────────────

/** Posição do carro na composição, por formato (a área de texto fica livre). */
const COMPOSITE_LAYOUT = {
  FEED: { bottomPct: 26, widthPct: 94, maxHeightPct: 52 },
  STORIES: { bottomPct: 31, widthPct: 96, maxHeightPct: 46 },
} as const;

/**
 * Gera os fundos compostos: 1 recorte do carro (reusado) sobre N cenas vazias
 * do Flux. Devolve as URLs dos PNGs finais persistidos.
 */
async function composeVehicleBackgrounds(
  input: ResolveBackgroundsInput,
  photoUrl: string,
): Promise<string[]> {
  const { width, height } = backgroundSize(input.format);

  const cutoutUrl = await removeBackground(photoUrl);
  log.info({ briefingId: input.briefingId }, 'recorte do veículo pronto');

  const prompt = buildEmptyScenePrompt(input.promptOverride);
  log.info({ briefingId: input.briefingId, prompt }, 'prompt da cena vazia (composição)');

  const urls: string[] = [];
  for (let i = 0; i < BACKGROUNDS_PER_BRIEFING; i += 1) {
    const scene = await generateImage({ prompt, width, height, outputFormat: 'jpeg' });
    const png = await composeScene({
      sceneUrl: scene.url,
      cutoutUrl,
      width,
      height,
      format: input.format,
    });
    const key = `backgrounds/${input.organizationId}/${input.briefingId}/composite-${i}.png`;
    urls.push(await persistBuffer(key, png));
  }
  return urls;
}

/** Cola o recorte (PNG transparente) sobre a cena, via Puppeteer. */
async function composeScene(opts: {
  sceneUrl: string;
  cutoutUrl: string;
  width: number;
  height: number;
  format: 'FEED' | 'STORIES';
}): Promise<Buffer> {
  const l = COMPOSITE_LAYOUT[opts.format];
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin: 0; padding: 0; }
    body { width: ${opts.width}px; height: ${opts.height}px; position: relative; overflow: hidden; background: #0A2540; }
    .scene { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .car {
      position: absolute; left: 50%; transform: translateX(-50%);
      bottom: ${l.bottomPct}%; width: ${l.widthPct}%; max-height: ${l.maxHeightPct}%;
      object-fit: contain;
      filter: drop-shadow(0 34px 42px rgba(0,0,0,0.45));
    }
  </style></head><body>
    <img class="scene" src="${opts.sceneUrl}" />
    <img class="car" src="${opts.cutoutUrl}" />
  </body></html>`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: opts.width, height: opts.height, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load', timeout: 60_000 });
    // Garante as duas imagens remotas decodificadas antes do screenshot
    // (string: executa no browser, onde `document` existe — o backend não tem lib DOM).
    await page.waitForFunction(
      'Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0)',
      { timeout: 60_000 },
    );
    const shot = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: opts.width, height: opts.height },
    });
    return Buffer.from(shot);
  } finally {
    await page.close();
  }
}

/** Persiste um buffer no storage disponível (R2 → fal) e devolve a URL. */
async function persistBuffer(key: string, body: Buffer): Promise<string> {
  if (r2Configured()) {
    const { url } = await uploadBuffer({ key, body, contentType: 'image/png' });
    if (url) return url;
  }
  return uploadToFalStorage(body, { contentType: 'image/png', expiresIn: '1y' });
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
  const prompt = buildBackgroundPrompt(input.vehicle, input.promptOverride);
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
