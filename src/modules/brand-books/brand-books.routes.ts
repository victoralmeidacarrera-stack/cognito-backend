import { randomUUID } from 'node:crypto';
import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { type Prisma } from '@prisma/client';
import { falEnabled, uploadToFalStorage } from '../../config/fal.js';
import { r2Configured, uploadBuffer } from '../../config/r2.js';
import { getTenantDb } from '../../shared/context.js';
import { DomainError, NotFoundError } from '../../shared/errors.js';
import { idParamSchema } from '../../shared/schemas.js';
import { analyzeReferenceLayout } from './analyze-reference.js';
import { layoutSchema } from './layout.js';

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
  // Disposição do texto (posição/fonte/tamanho) — parcial; defaults no render.
  layout: layoutSchema.partial().optional(),
});

const updateBrandBookSchema = createBrandBookSchema.partial();

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const TAGS = ['Brand books'];

/** Lê o array de URLs de referência do brand book (JSON no banco). */
function referenceUrls(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((u): u is string => typeof u === 'string') : [];
}

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

  // Anexa uma imagem de referência (base64) ao brand book. Storage: R2 → fal.
  r.post(
    '/brand-books/:id/references',
    {
      bodyLimit: 12 * 1024 * 1024, // referências (base64 infla ~33%)
      schema: {
        params: idParamSchema,
        body: z.object({
          dataBase64: z.string().min(1),
          mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        }),
        tags: TAGS,
        summary: 'Anexa imagem de referência',
      },
    },
    async (request) => {
      const db = getTenantDb(request);
      const brandBook = await db.brandBook.findFirst({
        where: { id: request.params.id },
        select: { organizationId: true, referenceImages: true },
      });
      if (!brandBook) throw new NotFoundError('Brand book');

      const body = Buffer.from(request.body.dataBase64, 'base64');
      if (body.length === 0) throw new DomainError('Arquivo vazio.');

      const ext = EXT_BY_MIME[request.body.mimeType] ?? 'bin';
      const key = `brandbooks/${brandBook.organizationId}/${request.params.id}/${randomUUID()}.${ext}`;

      let url: string | null;
      if (r2Configured()) {
        ({ url } = await uploadBuffer({ key, body, contentType: request.body.mimeType }));
      } else if (falEnabled()) {
        url = await uploadToFalStorage(body, {
          contentType: request.body.mimeType,
          expiresIn: '1y',
        });
      } else {
        throw new DomainError('Nenhum storage configurado para referências (R2 ou fal).');
      }
      if (!url) throw new DomainError('Falha ao obter a URL da referência.');

      const urls = [...referenceUrls(brandBook.referenceImages), url];
      await db.brandBook.updateMany({
        where: { id: request.params.id },
        data: { referenceImages: urls },
      });
      return { url, referenceImages: urls };
    },
  );

  // Remove uma imagem de referência (por URL).
  r.delete(
    '/brand-books/:id/references',
    {
      schema: {
        params: idParamSchema,
        body: z.object({ url: z.string().min(1) }),
        tags: TAGS,
        summary: 'Remove imagem de referência',
      },
    },
    async (request) => {
      const db = getTenantDb(request);
      const brandBook = await db.brandBook.findFirst({
        where: { id: request.params.id },
        select: { referenceImages: true },
      });
      if (!brandBook) throw new NotFoundError('Brand book');

      const urls = referenceUrls(brandBook.referenceImages).filter((u) => u !== request.body.url);
      await db.brandBook.updateMany({
        where: { id: request.params.id },
        data: { referenceImages: urls },
      });
      return { referenceImages: urls };
    },
  );

  // Analisa uma referência com Claude vision e devolve sugestão de layout.
  // Não persiste: o frontend aplica ao formulário e o usuário salva se quiser.
  r.post(
    '/brand-books/:id/analyze-reference',
    {
      schema: {
        params: idParamSchema,
        body: z.object({ imageUrl: z.string().min(1) }),
        tags: TAGS,
        summary: 'Sugere layout a partir de uma referência (IA)',
      },
    },
    async (request) => {
      const db = getTenantDb(request);
      const brandBook = await db.brandBook.findFirst({
        where: { id: request.params.id },
        select: { id: true },
      });
      if (!brandBook) throw new NotFoundError('Brand book');

      const layout = await analyzeReferenceLayout(request.body.imageUrl);
      return { layout };
    },
  );
}
