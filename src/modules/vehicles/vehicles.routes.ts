import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { type Prisma } from '@prisma/client';
import { getTenantDb } from '../../shared/context.js';
import { NotFoundError } from '../../shared/errors.js';
import { idParamSchema, paginationSchema } from '../../shared/schemas.js';

const createVehicleSchema = z.object({
  make: z.string().min(1).max(100),
  model: z.string().min(1).max(100),
  trim: z.string().max(100).optional(),
  year: z.number().int().min(1950).max(2100),
  modelYear: z.number().int().min(1950).max(2100).optional(),
  priceCents: z.number().int().nonnegative().optional(),
  mileageKm: z.number().int().nonnegative().optional(),
  color: z.string().max(60).optional(),
  fuel: z.string().max(40).optional(),
  transmission: z.string().max(40).optional(),
  plateEnding: z.string().max(4).optional(),
  condition: z.enum(['NEW', 'USED']).optional(),
  highlights: z.array(z.string().max(120)).optional(),
  externalId: z.string().max(120).optional(),
});

const updateVehicleSchema = createVehicleSchema.partial();

export function registerVehicleRoutes(app: FastifyInstance): void {
  app.post('/vehicles', async (request, reply) => {
    const data = createVehicleSchema.parse(request.body);
    const vehicle = await getTenantDb(request).vehicle.create({
      data: data as unknown as Prisma.VehicleUncheckedCreateInput,
      select: { id: true },
    });
    return reply.status(201).send(vehicle);
  });

  app.get('/vehicles', async (request) => {
    const { page, perPage } = paginationSchema.parse(request.query);
    const db = getTenantDb(request);
    const [items, total] = await Promise.all([
      db.vehicle.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      db.vehicle.count(),
    ]);
    return { items, total, page, perPage };
  });

  app.get('/vehicles/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const vehicle = await getTenantDb(request).vehicle.findFirst({
      where: { id },
      include: { photos: { orderBy: { position: 'asc' } } },
    });
    if (!vehicle) throw new NotFoundError('Veículo');
    return vehicle;
  });

  app.patch('/vehicles/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const data = updateVehicleSchema.parse(request.body);
    const result = await getTenantDb(request).vehicle.updateMany({
      where: { id },
      data: data,
    });
    if (result.count === 0) throw new NotFoundError('Veículo');
    return { updated: true };
  });
}
