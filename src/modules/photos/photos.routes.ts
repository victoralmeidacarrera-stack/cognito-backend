import { randomUUID } from 'node:crypto';
import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { type Prisma } from '@prisma/client';
import { falEnabled, uploadToFalStorage } from '../../config/fal.js';
import { presignPutUrl, r2Configured, r2PublicUrl, uploadBuffer } from '../../config/r2.js';
import { getCtx, getTenantDb } from '../../shared/context.js';
import { DomainError, NotFoundError } from '../../shared/errors.js';
import { cuidSchema } from '../../shared/schemas.js';

const photoKind = z.enum(['EXTERIOR', 'INTERIOR', 'DETAIL', 'BACKGROUND', 'LOGO', 'OTHER']);

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const vehicleParam = z.object({ vehicleId: cuidSchema });

const presignSchema = z.object({
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  kind: photoKind.optional(),
});

const confirmSchema = z.object({
  key: z.string().min(1),
  kind: photoKind.optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  bytes: z.number().int().positive().optional(),
});

const TAGS = ['Fotos'];

async function assertVehicle(db: ReturnType<typeof getTenantDb>, vehicleId: string): Promise<void> {
  const vehicle = await db.vehicle.findFirst({ where: { id: vehicleId }, select: { id: true } });
  if (!vehicle) throw new NotFoundError('Veículo');
}

export function registerPhotoRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // 1. URL assinada para o cliente subir o arquivo direto no R2.
  //    Sem R2 configurado, responde direct=true — o cliente deve usar o
  //    endpoint de upload direto (abaixo) em vez do PUT.
  r.post(
    '/vehicles/:vehicleId/photos/presign',
    {
      schema: {
        params: vehicleParam,
        body: presignSchema,
        tags: TAGS,
        summary: 'URL assinada de upload',
      },
    },
    async (request) => {
      const ctx = getCtx(request);
      const db = getTenantDb(request);
      await assertVehicle(db, request.params.vehicleId);

      const ext = EXT_BY_MIME[request.body.mimeType] ?? 'bin';
      const key = `photos/${ctx.organizationId}/${request.params.vehicleId}/${randomUUID()}.${ext}`;

      if (!r2Configured()) {
        // Presign sem R2 geraria uma URL inválida (s3.amazonaws.com falso).
        return { uploadUrl: null, key, direct: true };
      }

      const uploadUrl = await presignPutUrl({ key, contentType: request.body.mimeType });
      return { uploadUrl, key, direct: false };
    },
  );

  // 1b. Upload direto pelo backend (dev/sem R2): arquivo em base64 no JSON.
  //     Storage: R2 se configurado, senão o storage do fal (URL pública).
  r.post(
    '/vehicles/:vehicleId/photos/upload',
    {
      bodyLimit: 20 * 1024 * 1024, // fotos de veículo (base64 infla ~33%)
      schema: {
        params: vehicleParam,
        body: z.object({
          dataBase64: z.string().min(1),
          mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
          kind: photoKind.optional(),
        }),
        tags: TAGS,
        summary: 'Upload direto (sem presign)',
      },
    },
    async (request, reply) => {
      const ctx = getCtx(request);
      const db = getTenantDb(request);
      await assertVehicle(db, request.params.vehicleId);

      const body = Buffer.from(request.body.dataBase64, 'base64');
      if (body.length === 0) throw new DomainError('Arquivo vazio.');

      const ext = EXT_BY_MIME[request.body.mimeType] ?? 'bin';
      const key = `photos/${ctx.organizationId}/${request.params.vehicleId}/${randomUUID()}.${ext}`;

      let url: string | null;
      if (r2Configured()) {
        ({ url } = await uploadBuffer({ key, body, contentType: request.body.mimeType }));
      } else if (falEnabled()) {
        url = await uploadToFalStorage(body, {
          contentType: request.body.mimeType,
          expiresIn: '1y',
        });
      } else {
        throw new DomainError('Nenhum storage configurado para fotos (R2 ou fal).');
      }

      const photo = await db.photo.create({
        data: {
          vehicleId: request.params.vehicleId,
          r2Key: key,
          url,
          kind: request.body.kind ?? 'EXTERIOR',
          bytes: body.length,
        } as unknown as Prisma.PhotoUncheckedCreateInput,
        select: { id: true, url: true },
      });
      return reply.status(201).send(photo);
    },
  );

  // 2. Confirma o upload e registra a Photo.
  r.post(
    '/vehicles/:vehicleId/photos',
    {
      schema: {
        params: vehicleParam,
        body: confirmSchema,
        tags: TAGS,
        summary: 'Confirma e registra a foto',
      },
    },
    async (request, reply) => {
      const db = getTenantDb(request);
      await assertVehicle(db, request.params.vehicleId);

      const photo = await db.photo.create({
        data: {
          vehicleId: request.params.vehicleId,
          r2Key: request.body.key,
          url: r2PublicUrl(request.body.key),
          kind: request.body.kind ?? 'EXTERIOR',
          ...(request.body.width ? { width: request.body.width } : {}),
          ...(request.body.height ? { height: request.body.height } : {}),
          ...(request.body.bytes ? { bytes: request.body.bytes } : {}),
        } as unknown as Prisma.PhotoUncheckedCreateInput,
        select: { id: true, url: true },
      });
      return reply.status(201).send(photo);
    },
  );
}
