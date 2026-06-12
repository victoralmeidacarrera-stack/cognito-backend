import { type FastifyInstance } from 'fastify';
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

export function registerBrandBookRoutes(app: FastifyInstance): void {
  app.post('/brand-books', async (request, reply) => {
    const data = createBrandBookSchema.parse(request.body);
    const brandBook = await getTenantDb(request).brandBook.create({
      data: data as unknown as Prisma.BrandBookUncheckedCreateInput,
      select: { id: true },
    });
    return reply.status(201).send(brandBook);
  });

  app.get('/brand-books', async (request) => {
    const items = await getTenantDb(request).brandBook.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    return { items };
  });

  app.get('/brand-books/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const brandBook = await getTenantDb(request).brandBook.findFirst({ where: { id } });
    if (!brandBook) throw new NotFoundError('Brand book');
    return brandBook;
  });

  app.patch('/brand-books/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const data = updateBrandBookSchema.parse(request.body);
    const result = await getTenantDb(request).brandBook.updateMany({
      where: { id },
      data: data,
    });
    if (result.count === 0) throw new NotFoundError('Brand book');
    return { updated: true };
  });
}
