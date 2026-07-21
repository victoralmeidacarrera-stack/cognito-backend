import { z } from 'zod';

/**
 * ════════════════════════════════════════════════════════════════════
 *  LAYOUT DO TEXTO — disposição/fonte/tamanho por brand book.
 * ════════════════════════════════════════════════════════════════════
 *
 * Config persistida em `BrandBook.layout` (JSON). Controla ONDE e COMO o
 * texto (headline/preço/CTA) é composto por cima do fundo no render (hbs →
 * Puppeteer). O usuário edita pelos controles da tela de Brand book; a IA
 * (Claude vision) pode pré-preencher a partir de uma imagem de referência.
 *
 * Fontes ficam num conjunto curado (carregado no template via @import).
 */

/** Fontes disponíveis nos dropdowns (carregadas no hbs via Google Fonts). */
export const LAYOUT_FONTS = [
  'Syne',
  'Inter',
  'Poppins',
  'Montserrat',
  'Oswald',
  'Playfair Display',
  'Roboto',
  'Bebas Neue',
] as const;

/** Posição do bloco de texto sobre a peça (vertical-horizontal). */
export const TEXT_POSITIONS = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const;

export const OVERLAY_STYLES = ['gradient', 'solid', 'none'] as const;

export const layoutSchema = z.object({
  textPosition: z.enum(TEXT_POSITIONS).default('bottom-left'),
  headlineFont: z.enum(LAYOUT_FONTS).default('Syne'),
  headlineSize: z.number().int().min(24).max(160).default(84),
  bodyFont: z.enum(LAYOUT_FONTS).default('Inter'),
  bodySize: z.number().int().min(14).max(72).default(34),
  priceSize: z.number().int().min(20).max(120).default(56),
  ctaSize: z.number().int().min(16).max(80).default(40),
  textColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'cor hex inválida')
    .default('#FFFFFF'),
  overlay: z.enum(OVERLAY_STYLES).default('gradient'),
});

export type Layout = z.infer<typeof layoutSchema>;

/** Aplica defaults sobre um JSON possivelmente parcial/legado do banco. */
export function parseLayout(raw: unknown): Layout {
  const result = layoutSchema.safeParse(raw ?? {});
  return result.success ? result.data : layoutSchema.parse({});
}

/** Variáveis de CSS derivadas do layout, consumidas pelo template hbs. */
export interface LayoutRenderVars {
  justify: 'flex-start' | 'center' | 'flex-end';
  items: 'flex-start' | 'center' | 'flex-end';
  textAlign: 'left' | 'center' | 'right';
  overlayCss: string;
  headlineFont: string;
  headlineSize: number;
  bodyFont: string;
  bodySize: number;
  priceSize: number;
  ctaSize: number;
  textColor: string;
  fontsImport: string;
}

const VERTICAL: Record<string, LayoutRenderVars['justify']> = {
  top: 'flex-start',
  center: 'center',
  bottom: 'flex-end',
};
const HORIZONTAL: Record<string, LayoutRenderVars['items']> = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
};
const TEXT_ALIGN: Record<string, LayoutRenderVars['textAlign']> = {
  left: 'left',
  center: 'center',
  right: 'right',
};

/** @import do Google Fonts só para as fontes efetivamente usadas. */
function buildFontsImport(fonts: string[]): string {
  const families = Array.from(new Set(fonts))
    .map((f) => `family=${f.replaceAll(' ', '+')}:wght@400;600;700;800`)
    .join('&');
  return `@import url('https://fonts.googleapis.com/css2?${families}&display=swap');`;
}

/** Converte a config de layout em valores prontos para o template. */
export function layoutToRenderVars(layout: Layout): LayoutRenderVars {
  const [vertical, horizontal] = layout.textPosition.split('-') as [string, string];
  const primary = 'var(--primary)';

  let overlayCss = 'transparent';
  if (layout.overlay === 'solid') {
    overlayCss = primary;
  } else if (layout.overlay === 'gradient') {
    // Gradiente "sobe" do lado onde o texto está, pra dar contraste sem tapar tudo.
    if (vertical === 'top') overlayCss = `linear-gradient(to bottom, ${primary}, transparent 60%)`;
    else if (vertical === 'center')
      overlayCss = `linear-gradient(to top, transparent, ${primary} 50%, transparent)`;
    else overlayCss = `linear-gradient(to top, ${primary}, transparent 60%)`;
  }

  return {
    justify: VERTICAL[vertical] ?? 'flex-end',
    items: HORIZONTAL[horizontal] ?? 'flex-start',
    textAlign: TEXT_ALIGN[horizontal] ?? 'left',
    overlayCss,
    headlineFont: layout.headlineFont,
    headlineSize: layout.headlineSize,
    bodyFont: layout.bodyFont,
    bodySize: layout.bodySize,
    priceSize: layout.priceSize,
    ctaSize: layout.ctaSize,
    textColor: layout.textColor,
    fontsImport: buildFontsImport([layout.headlineFont, layout.bodyFont]),
  };
}
