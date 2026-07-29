import { type BrandBook, type Vehicle } from '@prisma/client';
import { layoutToRenderVars, parseLayout } from '../brand-books/layout.js';
import { r2PublicUrl } from '../../config/r2.js';
import { type CreativeCopy } from '../../shared/schemas.js';
import { formatPriceBRL } from '../../shared/utils.js';

/**
 * ════════════════════════════════════════════════════════════════════
 *  CONTRATO DE DADOS DO RENDER — o que todo template .hbs recebe.
 * ════════════════════════════════════════════════════════════════════
 *
 * Ponto único onde o `data` do Handlebars é montado (worker de render e
 * script de preview usam o MESMO builder — preview que mente não serve).
 *
 * Princípio: **nada aqui é inventado.** Preço vem do veículo; parcela, entrada,
 * taxa e validade vêm do que o usuário escreveu no briefing. Um template nunca
 * fabrica número financeiro — se o dado não veio, o bloco simplesmente não
 * renderiza (todo `.hbs` degrada com `{{#if}}`).
 */

/** Bloco de veículo já formatado para exibição (nunca `null` dentro). */
export interface VehicleRenderVars {
  nome: string;
  make: string;
  model: string;
  trim: string;
  anoLabel: string;
  kmLabel: string;
  condicaoLabel: string;
  isUsed: boolean;
  color: string;
  fuel: string;
  transmission: string;
  plateEnding: string;
  highlights: string[];
}

/** Condições comerciais escritas pelo usuário no briefing. */
export interface OfferRenderVars {
  parcela: string;
  entrada: string;
  taxa: string;
  validade: string;
  periodo: string;
  selo: string;
}

export interface BuildRenderDataInput {
  copy: CreativeCopy;
  vehicle: Pick<
    Vehicle,
    | 'make'
    | 'model'
    | 'trim'
    | 'year'
    | 'modelYear'
    | 'priceCents'
    | 'mileageKm'
    | 'color'
    | 'fuel'
    | 'transmission'
    | 'plateEnding'
    | 'condition'
    | 'highlights'
  > | null;
  brandBook: Pick<
    BrandBook,
    | 'name'
    | 'primaryColor'
    | 'secondaryColor'
    | 'accentColor'
    | 'typography'
    | 'logoR2Key'
    | 'layout'
  > | null;
  /** `Organization.factoryRestrictions` (JSON livre). */
  factoryRestrictions: unknown;
  /** `Briefing.input` (JSON livre preenchido na tela de briefing). */
  briefingInput: unknown;
  /** Fundo já resolvido (foto real, cena Flux ou vazio → cor sólida). */
  backgroundUrl: string | null;
  /** Nome da loja exibido na peça. Cai no nome do brand book. */
  storeName?: string | null;
  /** Dimensões do template — usadas pelo partial `base-style`. */
  canvas: { width: number; height: number };
}

const KM_FORMAT = new Intl.NumberFormat('pt-BR');

/** Lê uma string não-vazia de um JSON livre; `''` quando ausente/inválida. */
function readString(source: unknown, ...keys: string[]): string {
  if (!source || typeof source !== 'object') return '';
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

/** "2024/2025" quando o ano-modelo difere do de fabricação; senão "2025". */
function buildAnoLabel(year: number | null, modelYear: number | null): string {
  if (year && modelYear && year !== modelYear) return `${year}/${modelYear}`;
  const single = modelYear ?? year;
  return single ? String(single) : '';
}

/** "42.000 km" · "0 km" para veículo novo · '' quando não informado. */
function buildKmLabel(mileageKm: number | null, isUsed: boolean): string {
  if (mileageKm == null || !Number.isFinite(mileageKm)) return isUsed ? '' : '0 km';
  return `${KM_FORMAT.format(Math.max(0, Math.round(mileageKm)))} km`;
}

function buildVehicleVars(vehicle: BuildRenderDataInput['vehicle']): VehicleRenderVars | null {
  if (!vehicle) return null;

  const isUsed = vehicle.condition !== 'NEW';
  const nome = [vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' ');

  return {
    nome,
    make: vehicle.make ?? '',
    model: vehicle.model ?? '',
    trim: vehicle.trim ?? '',
    anoLabel: buildAnoLabel(vehicle.year ?? null, vehicle.modelYear ?? null),
    kmLabel: buildKmLabel(vehicle.mileageKm ?? null, isUsed),
    condicaoLabel: isUsed ? 'Seminovo' : '0 km',
    isUsed,
    color: vehicle.color ?? '',
    fuel: vehicle.fuel ?? '',
    transmission: vehicle.transmission ?? '',
    plateEnding: vehicle.plateEnding ?? '',
    // Cortado em 4: nenhum layout comporta mais que isso sem virar lista ilegível.
    highlights: readStringArray(vehicle.highlights).slice(0, 4),
  };
}

/**
 * Condições comerciais — **só o que o usuário digitou no briefing**.
 * Nenhum valor é calculado a partir do preço: simular financiamento sem CET
 * seria propaganda enganosa, e o template não é o lugar dessa conta.
 */
function buildOfferVars(briefingInput: unknown): OfferRenderVars {
  return {
    parcela: readString(briefingInput, 'parcela', 'parcelas'),
    entrada: readString(briefingInput, 'entrada'),
    taxa: readString(briefingInput, 'taxa', 'juros'),
    validade: readString(briefingInput, 'validade', 'valido_ate'),
    periodo: readString(briefingInput, 'periodo', 'data'),
    selo: readString(briefingInput, 'selo', 'campanha'),
  };
}

/** Luminância relativa (WCAG) de uma cor hex `#RRGGBB`. */
function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/**
 * Cor de texto legível sobre um fundo — preto ou branco, o que tiver mais
 * contraste. Existe porque a cor da marca vem do cliente: uma concessionária
 * com amarelo como primária geraria peça branco-no-branco sem isso.
 */
export function readableOn(hex: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return '#FFFFFF';
  return relativeLuminance(hex) > 0.45 ? '#111111' : '#FFFFFF';
}

function disclaimerFrom(factoryRestrictions: unknown): string {
  return readString(factoryRestrictions, 'disclaimerObrigatorio', 'disclaimer');
}

/** Monta o `data` completo entregue ao template Handlebars. */
export function buildRenderData(input: BuildRenderDataInput): Record<string, unknown> {
  const { copy, brandBook } = input;
  const layout = layoutToRenderVars(parseLayout(brandBook?.layout));
  const vehicle = buildVehicleVars(input.vehicle);
  const priceCents = input.vehicle?.priceCents ?? null;

  const primaryColor = brandBook?.primaryColor ?? '#0A2540';
  const secondaryColor = brandBook?.secondaryColor ?? '#1565C0';
  const accentColor = brandBook?.accentColor ?? '#FFB300';

  return {
    headline: copy.headline,
    cta: copy.cta,
    sub_headline: copy.sub_headline ?? '',
    descricao: copy.descricao ?? '',
    emoji: copy.emoji_sugerido ?? '',
    // Fundo da composição (foto real ou cena Flux). Vazio = cor sólida.
    photoUrl: input.backgroundUrl ?? '',
    // Só renderiza preço quando há veículo com preço — 'sob consulta' seria
    // ruído numa peça que já não fala de preço.
    price: priceCents != null ? formatPriceBRL(priceCents) : '',
    disclaimer: disclaimerFrom(input.factoryRestrictions),
    vehicle,
    offer: buildOfferVars(input.briefingInput),
    store: {
      name: input.storeName ?? brandBook?.name ?? '',
      logoUrl: brandBook?.logoR2Key ? (r2PublicUrl(brandBook.logoR2Key) ?? '') : '',
    },
    canvas: input.canvas,
    layout,
    brand: {
      primaryColor,
      secondaryColor,
      accentColor,
      // Texto legível sobre cada cor da marca — os templates usam estes em vez
      // de assumir branco (ver readableOn).
      onPrimary: readableOn(primaryColor),
      onSecondary: readableOn(secondaryColor),
      onAccent: readableOn(accentColor),
      typography: brandBook?.typography ?? {},
    },
  };
}
