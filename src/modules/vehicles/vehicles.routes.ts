import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
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

const TAGS = ['Veículos'];

export function registerVehicleRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/vehicles',
    { schema: { body: createVehicleSchema, tags: TAGS, summary: 'Cadastra veículo' } },
    async (request, reply) => {
      const vehicle = await getTenantDb(request).vehicle.create({
        data: request.body as unknown as Prisma.VehicleUncheckedCreateInput,
        select: { id: true },
      });
      return reply.status(201).send(vehicle);
    },
  );

  r.get(
    '/vehicles',
    { schema: { querystring: paginationSchema, tags: TAGS, summary: 'Lista veículos' } },
    async (request) => {
      const { page, perPage } = request.query;
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
    },
  );

  r.get(
    '/vehicles/:id',
    { schema: { params: idParamSchema, tags: TAGS, summary: 'Detalha veículo' } },
    async (request) => {
      const vehicle = await getTenantDb(request).vehicle.findFirst({
        where: { id: request.params.id },
        include: { photos: { orderBy: { position: 'asc' } } },
      });
      if (!vehicle) throw new NotFoundError('Veículo');
      return vehicle;
    },
  );

  r.patch(
    '/vehicles/:id',
    {
      schema: {
        params: idParamSchema,
        body: updateVehicleSchema,
        tags: TAGS,
        summary: 'Atualiza veículo',
      },
    },
    async (request) => {
      const result = await getTenantDb(request).vehicle.updateMany({
        where: { id: request.params.id },
        data: request.body,
      });
      if (result.count === 0) throw new NotFoundError('Veículo');
      return { updated: true };
    },
  );
}
