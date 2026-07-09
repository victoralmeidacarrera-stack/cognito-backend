import { type CreativeFormat } from '@prisma/client';
import { env } from '../../config/env.js';
import { falEnabled, uploadToFalStorage } from '../../config/fal.js';
import { logger } from '../../config/logger.js';
import { getBrowser } from '../../config/puppeteer.js';
import { uploadBuffer } from '../../config/r2.js';
import { loadTemplate } from './template-loader.js';

export interface RenderInput {
  format: CreativeFormat;
  slug: string;
  width: number;
  height: number;
  data: Record<string, unknown>;
}

/** Renderiza HTML (Handlebars) em PNG via Puppeteer. */
export async function renderToPng(input: RenderInput): Promise<Buffer> {
  const template = await loadTemplate(input.format, input.slug);
  const html = template(input.data);

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: input.width, height: input.height, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    const screenshot = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: input.width, height: input.height },
    });
    return Buffer.from(screenshot);
  } finally {
    await page.close();
  }
}

/** R2 está de fato configurado para uploads? (credenciais presentes) */
function r2Configured(): boolean {
  return Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY);
}

/**
 * Renderiza e sobe a imagem do criativo.
 * Storage primário: R2. Sem R2 configurado, cai pro storage do fal (URL
 * pública na CDN fal.media, expira em 30d) — bom para dev/demo; para produção
 * configure o R2 (URL estável e sob seu domínio).
 */
export async function renderAndUpload(input: {
  organizationId: string;
  creativeId: string;
  render: RenderInput;
}): Promise<{ key: string; url: string | null }> {
  const png = await renderToPng(input.render);
  const key = `creatives/${input.organizationId}/${input.creativeId}.png`;

  if (r2Configured()) {
    return uploadBuffer({ key, body: png, contentType: 'image/png' });
  }

  if (falEnabled()) {
    logger.warn({ creativeId: input.creativeId }, 'R2 não configurado — subindo PNG pro fal');
    const url = await uploadToFalStorage(png, { contentType: 'image/png', expiresIn: '30d' });
    return { key, url };
  }

  throw new Error('Nenhum storage configurado para o render (R2 ou fal).');
}
