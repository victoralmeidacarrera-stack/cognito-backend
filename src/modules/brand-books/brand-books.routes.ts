import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { type Prisma } from '@prisma/client';
import { getTenantDb } from '../../shared/context.js';
import { NotFoundError } from '../../shared/errors.js';
import { idParamSchema } from '../../shared/schemas.js';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'cor hex inválida');

const createBrandBookSchema = z.object({
  name: z.string().min(1).max(200),
  isActive: z.boolean().optional(),
  primaryColor: hexColor.optional(),
  secondaryColor: hexColor.optional(),
  accentColor: hexColor.optional(),
  palette: z.array(hexColor).optional(),
  typography: z.record(z.string(), z.string()).optional(),
  logoR2Key: z.string().optional(),
  toneOfVoice: z.string().max(4000).optional(),
  guidelines: z.string().max(20000).optional(),
});

const updateBrandBookSchema = createBrandBookSchema.partial();

const TAGS = ['Brand books'];

export function registerBrandBookRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/brand-books',
    { schema: { body: createBrandBookSchema, tags: TAGS, summary: 'Cria brand book' } },
    async (request, reply) => {
      const brandBook = await getTenantDb(request).brandBook.create({
        data: request.body as unknown as Prisma.BrandBookUncheckedCreateInput,
        select: { id: true },
      });
      return reply.status(201).send(brandBook);
    },
  );

  r.get(
    '/brand-books',
    { schema: { tags: TAGS, summary: 'Lista brand books' } },
    async (request) => {
      const items = await getTenantDb(request).brandBook.findMany({
        orderBy: { updatedAt: 'desc' },
      });
      return { items };
    },
  );

  r.get(
    '/brand-books/:id',
    { schema: { params: idParamSchema, tags: TAGS, summary: 'Detalha brand book' } },
    async (request) => {
      const brandBook = await getTenantDb(request).brandBook.findFirst({
        where: { id: request.params.id },
      });
      if (!brandBook) throw new NotFoundError('Brand book');
      return brandBook;
    },
  );

  r.patch(
    '/brand-books/:id',
    {
      schema: {
        params: idParamSchema,
        body: updateBrandBookSchema,
        tags: TAGS,
        summary: 'Atualiza brand book',
      },
    },
    async (request) => {
      const result = await getTenantDb(request).brandBook.updateMany({
        where: { id: request.params.id },
        data: request.body,
      });
      if (result.count === 0) throw new NotFoundError('Brand book');
      return { updated: true };
    },
  );
}
