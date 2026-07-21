import { describe, expect, it } from 'vitest';
import { layoutToRenderVars, parseLayout } from '../src/modules/brand-books/layout.js';

describe('parseLayout', () => {
  it('preenche defaults sobre JSON vazio/legado', () => {
    const l = parseLayout({});
    expect(l.textPosition).toBe('bottom-left');
    expect(l.headlineFont).toBe('Syne');
    expect(l.headlineSize).toBe(84);
    expect(l.overlay).toBe('gradient');
  });

  it('respeita campos válidos e descarta inválidos caindo pro default', () => {
    expect(parseLayout({ textPosition: 'top-center', headlineSize: 120 }).textPosition).toBe(
      'top-center',
    );
    // valor fora do domínio → safeParse falha → volta tudo pro default
    expect(parseLayout({ textPosition: 'diagonal' }).textPosition).toBe('bottom-left');
  });
});

describe('layoutToRenderVars', () => {
  it('mapeia posição para flexbox e alinhamento', () => {
    const top = layoutToRenderVars(parseLayout({ textPosition: 'top-right' }));
    expect(top.justify).toBe('flex-start');
    expect(top.items).toBe('flex-end');
    expect(top.textAlign).toBe('right');

    const bottom = layoutToRenderVars(parseLayout({ textPosition: 'bottom-left' }));
    expect(bottom.justify).toBe('flex-end');
    expect(bottom.items).toBe('flex-start');
    expect(bottom.textAlign).toBe('left');
  });

  it('direciona o gradiente conforme a vertical do texto', () => {
    expect(
      layoutToRenderVars(parseLayout({ textPosition: 'top-left', overlay: 'gradient' })).overlayCss,
    ).toContain('to bottom');
    expect(
      layoutToRenderVars(parseLayout({ textPosition: 'bottom-left', overlay: 'gradient' }))
        .overlayCss,
    ).toContain('to top');
    expect(layoutToRenderVars(parseLayout({ overlay: 'none' })).overlayCss).toBe('transparent');
    expect(layoutToRenderVars(parseLayout({ overlay: 'solid' })).overlayCss).toBe('var(--primary)');
  });

  it('inclui apenas as fontes usadas no @import', () => {
    const vars = layoutToRenderVars(parseLayout({ headlineFont: 'Oswald', bodyFont: 'Roboto' }));
    expect(vars.fontsImport).toContain('family=Oswald');
    expect(vars.fontsImport).toContain('family=Roboto');
    expect(vars.fontsImport).not.toContain('Playfair');
  });
});
