import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

/**
 * Isolamento multi-tenant via Prisma client extension.
 *
 * `tenantPrisma(organizationId)` devolve um client estendido que injeta
 * automaticamente `organizationId` em TODA query dos modelos tenant:
 *  - em `where` (find/update/delete/count/aggregate/groupBy/upsert)
 *  - em `data` (create/createMany/upsert.create)
 *
 * Depende de `extendedWhereUnique` (GA no Prisma 6): por isso podemos somar
 * `organizationId` ao where de findUnique/update/delete sem quebrar.
 *
 * `Organization` é a raiz do tenant (não possui organizationId) e fica de fora.
 */

const TENANT_MODELS: ReadonlySet<string> = new Set([
  'User',
  'BrandBook',
  'Vehicle',
  'Photo',
  'Campaign',
  'Briefing',
  'Template',
  'Job',
  'Creative',
  'Approval',
  'UsageLog',
]);

type MutableArgs = {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | Record<string, unknown>[];
  create?: Record<string, unknown>;
};

function injectWhere(args: MutableArgs, organizationId: string): void {
  args.where = { ...(args.where ?? {}), organizationId };
}

function injectData(args: MutableArgs, organizationId: string): void {
  if (Array.isArray(args.data)) {
    args.data = args.data.map((row) => ({ organizationId, ...row }));
  } else if (args.data) {
    args.data = { organizationId, ...args.data };
  }
}

export type TenantPrisma = ReturnType<typeof tenantPrisma>;

export function tenantPrisma(organizationId: string) {
  return prisma.$extends({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) {
            return query(args);
          }

          const mutable = args as MutableArgs;

          switch (operation) {
            case 'create':
              injectData(mutable, organizationId);
              break;
            case 'createMany':
            case 'createManyAndReturn':
              injectData(mutable, organizationId);
              break;
            case 'upsert':
              injectWhere(mutable, organizationId);
              if (mutable.create) {
                mutable.create = { organizationId, ...mutable.create };
              }
              break;
            case 'findUnique':
            case 'findUniqueOrThrow':
            case 'findFirst':
            case 'findFirstOrThrow':
            case 'findMany':
            case 'update':
            case 'updateMany':
            case 'delete':
            case 'deleteMany':
            case 'count':
            case 'aggregate':
            case 'groupBy':
              injectWhere(mutable, organizationId);
              break;
            default:
              break;
          }

          return query(args);
        },
      },
    },
  });
}

// Reexport útil para tipar enums/inputs nos módulos sem importar de dois lugares.
export { Prisma };
