import { describe, expect, it } from 'vitest';
import { createCreativesFromVariations } from '../src/modules/creatives/creatives.service.js';
import type { TenantPrisma } from '../src/config/tenant.js';
import type { CreativeCopy } from '../src/shared/schemas.js';

const copy: CreativeCopy = {
  headline: 'H',
  cta: 'C',
  sub_headline: 'sub',
  descricao: 'desc',
  emoji_sugerido: '🚗',
};

/** Stub mínimo do tenant db: registra cada create e devolve o id/index. */
function fakeDb(): { db: TenantPrisma; created: Record<string, unknown>[] } {
  const created: Record<string, unknown>[] = [];
  const db = {
    creative: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return Promise.resolve({ id: `c${created.length}`, variationIndex: data.variationIndex });
      },
    },
  } as unknown as TenantPrisma;
  return { db, created };
}

const variations = (n: number): CreativeCopy[] => Array.from({ length: n }, () => copy);

describe('createCreativesFromVariations — fundos', () => {
  it('reusa os 2 fundos em round-robin entre as variações', async () => {
    const { db, created } = fakeDb();
    await createCreativesFromVariations(db, {
      briefingId: 'b1',
      format: 'FEED',
      variations: variations(5),
      templateIds: ['t1'],
      backgrounds: ['bg0', 'bg1'],
    });
    expect(created.map((d) => d.backgroundUrl)).toEqual(['bg0', 'bg1', 'bg0', 'bg1', 'bg0']);
  });

  it('sem fundos, backgroundUrl é null (cor sólida)', async () => {
    const { db, created } = fakeDb();
    await createCreativesFromVariations(db, {
      briefingId: 'b1',
      format: 'FEED',
      variations: variations(2),
      templateIds: ['t1'],
    });
    expect(created.map((d) => d.backgroundUrl)).toEqual([null, null]);
  });

  it('lança quando não há template ativo', async () => {
    const { db } = fakeDb();
    await expect(
      createCreativesFromVariations(db, {
        briefingId: 'b1',
        format: 'FEED',
        variations: variations(1),
        templateIds: [],
      }),
    ).rejects.toThrow();
  });
});
