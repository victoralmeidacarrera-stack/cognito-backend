import { describe, expect, it } from 'vitest';
import { buildRenderData, readableOn } from '../src/modules/render/render-data.js';
import {
  TEMPLATE_CATALOG,
  findTemplateDefinition,
} from '../src/modules/render/template-catalog.js';
import type { CreativeCopy } from '../src/shared/schemas.js';

const copy: CreativeCopy = {
  headline: 'Nivus 2025 com IPVA pago',
  cta: 'Agende seu test-drive',
  sub_headline: 'Tanque cheio',
  descricao: 'desc',
  emoji_sugerido: '🚗',
};

const canvas = { width: 1080, height: 1350 };

// Intl usa espaço não-quebrável (U+00A0) entre "R$" e o número.
const norm = (s: unknown): string => String(s).replace(/\s/g, ' ');

/** Entrada mínima: tudo ausente — é assim que chega um cliente novo. */
function baseInput() {
  return {
    copy,
    vehicle: null,
    brandBook: null,
    factoryRestrictions: null,
    briefingInput: null,
    backgroundUrl: null,
    canvas,
  } as const;
}

describe('readableOn', () => {
  it('usa texto escuro sobre cor clara e claro sobre cor escura', () => {
    expect(readableOn('#FFB300')).toBe('#111111'); // amarelo de marca
    expect(readableOn('#FFFFFF')).toBe('#111111');
    expect(readableOn('#0A2540')).toBe('#FFFFFF');
    expect(readableOn('#000000')).toBe('#FFFFFF');
  });

  it('cai em branco quando a cor é inválida', () => {
    expect(readableOn('roxo')).toBe('#FFFFFF');
    expect(readableOn('#FFF')).toBe('#FFFFFF');
  });
});

describe('buildRenderData', () => {
  it('degrada sem veículo, marca, oferta ou disclaimer', () => {
    const data = buildRenderData(baseInput());

    expect(data.vehicle).toBeNull();
    expect(data.price).toBe('');
    expect(data.disclaimer).toBe('');
    expect(data.photoUrl).toBe('');
    expect(data.offer).toEqual({
      parcela: '',
      entrada: '',
      taxa: '',
      validade: '',
      periodo: '',
      selo: '',
    });
  });

  it('formata ano, km e condição do veículo', () => {
    const data = buildRenderData({
      ...baseInput(),
      vehicle: {
        make: 'Volkswagen',
        model: 'Nivus',
        trim: 'Highline',
        year: 2024,
        modelYear: 2025,
        priceCents: 14_999_000,
        mileageKm: 32_400,
        color: 'Prata',
        fuel: 'Flex',
        transmission: 'Automático',
        plateEnding: '7',
        condition: 'USED',
        highlights: ['a', 'b', 'c', 'd', 'e'],
      },
    });

    const vehicle = data.vehicle as Record<string, unknown>;
    expect(vehicle.nome).toBe('Volkswagen Nivus Highline');
    expect(vehicle.anoLabel).toBe('2024/2025');
    expect(vehicle.kmLabel).toBe('32.400 km');
    expect(vehicle.condicaoLabel).toBe('Seminovo');
    expect(vehicle.isUsed).toBe(true);
    // Cortado em 4: nenhum layout comporta mais.
    expect(vehicle.highlights).toEqual(['a', 'b', 'c', 'd']);
    expect(norm(data.price)).toBe('R$ 149.990');
  });

  it('mostra um único ano quando fabricação e modelo coincidem, e 0 km em novo', () => {
    const data = buildRenderData({
      ...baseInput(),
      vehicle: {
        make: 'Fiat',
        model: 'Pulse',
        trim: null,
        year: 2025,
        modelYear: 2025,
        priceCents: null,
        mileageKm: null,
        color: null,
        fuel: null,
        transmission: null,
        plateEnding: null,
        condition: 'NEW',
        highlights: [],
      },
    });

    const vehicle = data.vehicle as Record<string, unknown>;
    expect(vehicle.nome).toBe('Fiat Pulse');
    expect(vehicle.anoLabel).toBe('2025');
    expect(vehicle.kmLabel).toBe('0 km');
    expect(vehicle.condicaoLabel).toBe('0 km');
    // Sem preço no cadastro, a peça não exibe preço (em vez de 'sob consulta').
    expect(data.price).toBe('');
  });

  it('lê as condições comerciais do briefing e nunca as calcula', () => {
    const data = buildRenderData({
      ...baseInput(),
      briefingInput: { parcela: 'R$ 1.290', entrada: '  R$ 29.900  ', taxa: '', juros: '0,99% a.m.' },
      vehicle: {
        make: 'VW',
        model: 'Nivus',
        trim: null,
        year: 2025,
        modelYear: null,
        priceCents: 14_999_000,
        mileageKm: 0,
        color: null,
        fuel: null,
        transmission: null,
        plateEnding: null,
        condition: 'NEW',
        highlights: [],
      },
    });

    const offer = data.offer as Record<string, string>;
    expect(offer.parcela).toBe('R$ 1.290');
    expect(offer.entrada).toBe('R$ 29.900'); // trim aplicado
    expect(offer.taxa).toBe('0,99% a.m.'); // cai na chave alternativa 'juros'
    // O preço do veículo existe, mas nenhuma parcela foi derivada dele.
    expect(offer.validade).toBe('');
  });

  it('deriva cores de texto legíveis a partir da marca', () => {
    const data = buildRenderData({
      ...baseInput(),
      brandBook: {
        name: 'Loja',
        primaryColor: '#FFFFFF',
        secondaryColor: '#0A2540',
        accentColor: '#FFB300',
        typography: {},
        logoR2Key: null,
        layout: {},
      },
    });

    const brand = data.brand as Record<string, string>;
    expect(brand.onPrimary).toBe('#111111');
    expect(brand.onSecondary).toBe('#FFFFFF');
    expect(brand.onAccent).toBe('#111111');
  });
});

describe('catálogo de templates', () => {
  it('tem feed e stories para toda família, sem slug repetido', () => {
    const slugs = TEMPLATE_CATALOG.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);

    const feed = TEMPLATE_CATALOG.filter((t) => t.format === 'FEED');
    const stories = TEMPLATE_CATALOG.filter((t) => t.format === 'STORIES');
    expect(feed.length).toBe(stories.length);
    for (const template of feed) {
      expect(findTemplateDefinition(`${template.slug}-stories`)).toBeDefined();
    }
  });

  it('usa as dimensões corretas por formato', () => {
    for (const template of TEMPLATE_CATALOG) {
      expect(template.width).toBe(1080);
      expect(template.height).toBe(template.format === 'FEED' ? 1350 : 1920);
    }
  });
});
