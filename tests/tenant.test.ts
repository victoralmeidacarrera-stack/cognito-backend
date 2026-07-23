import { describe, expect, it, vi } from 'vitest';

/**
 * Isolamento multi-tenant — a garantia mais crítica do produto: uma
 * concessionária nunca pode ler nem escrever dados de outra.
 *
 * A extension é 100% client-side (só reescreve os args antes de mandar pro
 * Prisma), então dá pra testar sem banco: trocamos o client por um fake que
 * implementa o contrato de query-extension e captura os args finais.
 */

type Handler = (ctx: {
  model: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}) => Promise<unknown>;

/** Última chamada que chegaria ao Prisma de verdade. */
let lastArgs: Record<string, unknown> | undefined;

vi.mock('../src/config/prisma.js', () => {
  const fakeClient = {
    $extends(ext: { query: { $allModels: { $allOperations: Handler } } }) {
      const handler = ext.query.$allModels.$allOperations;
      // Proxy: db.user.findMany(args) -> handler({ model: 'User', ... })
      return new Proxy(
        {},
        {
          get(_t, accessor: string) {
            const model = accessor.charAt(0).toUpperCase() + accessor.slice(1);
            return new Proxy(
              {},
              {
                get(_t2, operation: string) {
                  return (args: unknown) =>
                    handler({
                      model,
                      operation,
                      args,
                      query: (finalArgs: unknown) => {
                        lastArgs = finalArgs as Record<string, unknown>;
                        return Promise.resolve(finalArgs);
                      },
                    });
                },
              },
            );
          },
        },
      );
    },
  };
  return { prisma: fakeClient };
});

const { tenantPrisma } = await import('../src/config/tenant.js');

/** Visão simplificada do client só para o teste: `db(org).creative.findMany(args)`. */
type Op = (args?: Record<string, unknown>) => Promise<unknown>;
interface ModelOps {
  findMany: Op;
  findFirst: Op;
  findUnique: Op;
  count: Op;
  aggregate: Op;
  groupBy: Op;
  delete: Op;
  deleteMany: Op;
  create: Op;
  createMany: Op;
  update: Op;
  updateMany: Op;
  upsert: Op;
}
interface FakeDb {
  creative: ModelOps;
  vehicle: ModelOps;
  briefing: ModelOps;
  campaign: ModelOps;
  photo: ModelOps;
  brandBook: ModelOps;
  organization: ModelOps;
}
const db = (orgId: string) => tenantPrisma(orgId) as unknown as FakeDb;

const ORG = 'org-legitima';
const OUTRA = 'org-invasora';

describe('tenantPrisma — leitura escopada', () => {
  const readOps: (keyof ModelOps)[] = [
    'findMany',
    'findFirst',
    'findUnique',
    'count',
    'aggregate',
    'groupBy',
    'delete',
    'deleteMany',
  ];

  it.each(readOps)('%s recebe organizationId no where', async (op) => {
    await db(ORG).creative[op]({ where: { id: 'c1' } });
    expect(lastArgs?.where).toMatchObject({ id: 'c1', organizationId: ORG });
  });

  it('injeta o where mesmo quando o chamador não passa where', async () => {
    await db(ORG).vehicle.findMany({});
    expect(lastArgs?.where).toEqual({ organizationId: ORG });
  });

  it('where forjado com outra org é sobrescrito pelo tenant', async () => {
    await db(ORG).briefing.findMany({ where: { organizationId: OUTRA } });
    expect(lastArgs?.where).toEqual({ organizationId: ORG });
  });
});

describe('tenantPrisma — escrita não pode escapar do tenant', () => {
  it('create carimba a org do tenant', async () => {
    await db(ORG).campaign.create({ data: { name: 'X' } });
    expect(lastArgs?.data).toEqual({ name: 'X', organizationId: ORG });
  });

  it('create com organizationId forjado no input não vence o tenant', async () => {
    await db(ORG).campaign.create({ data: { name: 'X', organizationId: OUTRA } });
    expect(lastArgs?.data).toEqual({ name: 'X', organizationId: ORG });
  });

  it('createMany carimba a org em todas as linhas', async () => {
    await db(ORG).photo.createMany({
      data: [{ url: 'a' }, { url: 'b', organizationId: OUTRA }],
    });
    expect(lastArgs?.data).toEqual([
      { url: 'a', organizationId: ORG },
      { url: 'b', organizationId: ORG },
    ]);
  });

  it('update não reatribui a org (where escopado + data fixada)', async () => {
    await db(ORG).creative.update({
      where: { id: 'c1' },
      data: { status: 'APPROVED', organizationId: OUTRA },
    });
    expect(lastArgs?.where).toMatchObject({ id: 'c1', organizationId: ORG });
    expect(lastArgs?.data).toEqual({ status: 'APPROVED', organizationId: ORG });
  });

  it('updateMany não reatribui a org', async () => {
    await db(ORG).creative.updateMany({
      where: { status: 'PENDING' },
      data: { organizationId: OUTRA },
    });
    expect(lastArgs?.where).toMatchObject({ organizationId: ORG });
    expect(lastArgs?.data).toEqual({ organizationId: ORG });
  });

  it('upsert escopa where e carimba os dois ramos', async () => {
    await db(ORG).brandBook.upsert({
      where: { id: 'b1' },
      create: { name: 'novo', organizationId: OUTRA },
      update: { name: 'edit', organizationId: OUTRA },
    });
    expect(lastArgs?.where).toMatchObject({ id: 'b1', organizationId: ORG });
    expect(lastArgs?.create).toEqual({ name: 'novo', organizationId: ORG });
    expect(lastArgs?.update).toEqual({ name: 'edit', organizationId: ORG });
  });

  it('update sem data não inventa data', async () => {
    await db(ORG).creative.update({ where: { id: 'c1' } });
    expect(lastArgs?.data).toBeUndefined();
  });
});

describe('tenantPrisma — modelos fora do tenant', () => {
  it('Organization é a raiz e passa intacta', async () => {
    await db(ORG).organization.findUnique({ where: { id: ORG } });
    expect(lastArgs?.where).toEqual({ id: ORG });
  });
});

describe('tenantPrisma — orgs diferentes não se enxergam', () => {
  it('dois clients carimbam orgs distintas', async () => {
    await db('org-a').creative.findMany({});
    expect(lastArgs?.where).toEqual({ organizationId: 'org-a' });
    await db('org-b').creative.findMany({});
    expect(lastArgs?.where).toEqual({ organizationId: 'org-b' });
  });
});
