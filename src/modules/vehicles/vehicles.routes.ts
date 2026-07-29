import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { type Prisma } from '@prisma/client';
import { getTenantDb } from '../../shared/context.js';
import { NotFoundError } from '../../shared/errors.js';
import { idParamSchema, paginationSchema } from '../../shared/schemas.js';
import { buildImportTemplateXlsx, importVehiclesFromXlsx } from './import.service.js';
import {
  createVehicleSchema,
  importReportSchema,
  importVehiclesSchema,
  updateVehicleSchema,
} from './vehicles.schemas.js';

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

  // Import em massa. Rota estática tem precedência sobre `/vehicles/:id` no
  // find-my-way (independe da ordem de registro), mas fica declarada antes
  // para deixar isso óbvio na leitura.
  r.post(
    '/vehicles/import',
    {
      bodyLimit: 15 * 1024 * 1024, // planilha do DMS em base64 (infla ~33%)
      schema: {
        body: importVehiclesSchema,
        response: { 200: importReportSchema },
        tags: TAGS,
        summary: 'Importa catálogo de uma planilha .xlsx',
      },
    },
    async (request) => {
      const file = Buffer.from(request.body.fileBase64, 'base64');
      return importVehiclesFromXlsx(getTenantDb(request), file, {
        dryRun: request.body.dryRun ?? false,
      });
    },
  );

  // Modelo da planilha. Sem schema de response: o corpo é binário.
  r.get(
    '/vehicles/import/template',
    { schema: { tags: TAGS, summary: 'Baixa a planilha modelo de importação' } },
    async (_request, reply) => {
      const file = await buildImportTemplateXlsx();
      return reply
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', 'attachment; filename="modelo-catalogo-cognito.xlsx"')
        .send(file);
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
