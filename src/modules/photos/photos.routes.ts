import { randomUUID } from 'node:crypto';
import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { type Prisma } from '@prisma/client';
import { presignPutUrl, r2PublicUrl } from '../../config/r2.js';
import { getCtx, getTenantDb } from '../../shared/context.js';
import { NotFoundError } from '../../shared/errors.js';
import { cuidSchema } from '../../shared/schemas.js';

const photoKind = z.enum(['EXTERIOR', 'INTERIOR', 'DETAIL', 'BACKGROUND', 'LOGO', 'OTHER']);

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

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

async function assertVehicle(db: ReturnType<typeof getTenantDb>, vehicleId: string): Promise<void> {
  const vehicle = await db.vehicle.findFirst({ where: { id: vehicleId }, select: { id: true } });
  if (!vehicle) throw new NotFoundError('Veículo');
}

export function registerPhotoRoutes(app: FastifyInstance): void {
  // 1. URL assinada para o cliente subir o arquivo direto no R2.
  app.post('/vehicles/:vehicleId/photos/presign', async (request) => {
    const { vehicleId } = z.object({ vehicleId: cuidSchema }).parse(request.params);
    const body = presignSchema.parse(request.body);
    const ctx = getCtx(request);
    const db = getTenantDb(request);
    await assertVehicle(db, vehicleId);

    const ext = EXT_BY_MIME[body.mimeType] ?? 'bin';
    const key = `photos/${ctx.organizationId}/${vehicleId}/${randomUUID()}.${ext}`;
    const uploadUrl = await presignPutUrl({ key, contentType: body.mimeType });
    return { uploadUrl, key };
  });

  // 2. Confirma o upload e registra a Photo.
  app.post('/vehicles/:vehicleId/photos', async (request, reply) => {
    const { vehicleId } = z.object({ vehicleId: cuidSchema }).parse(request.params);
    const body = confirmSchema.parse(request.body);
    const db = getTenantDb(request);
    await assertVehicle(db, vehicleId);

    const photo = await db.photo.create({
      data: {
        vehicleId,
        r2Key: body.key,
        url: r2PublicUrl(body.key),
        kind: body.kind ?? 'EXTERIOR',
        ...(body.width ? { width: body.width } : {}),
        ...(body.height ? { height: body.height } : {}),
        ...(body.bytes ? { bytes: body.bytes } : {}),
      } as unknown as Prisma.PhotoUncheckedCreateInput,
      select: { id: true, url: true },
    });
    return reply.status(201).send(photo);
  });
}
