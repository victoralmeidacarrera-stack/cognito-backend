import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { type Prisma } from '@prisma/client';
import { getTenantDb } from '../../shared/context.js';
import { NotFoundError } from '../../shared/errors.js';
import { idParamSchema, paginationSchema } from '../../shared/schemas.js';

const createCampaignSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  format: z.enum(['FEED', 'STORIES']).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
});

const updateCampaignSchema = createCampaignSchema.partial();

const TAGS = ['Campanhas'];

export function registerCampaignRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/campaigns',
    { schema: { body: createCampaignSchema, tags: TAGS, summary: 'Cria campanha' } },
    async (request, reply) => {
      const campaign = await getTenantDb(request).campaign.create({
        data: request.body as Prisma.CampaignUncheckedCreateInput,
        select: { id: true },
      });
      return reply.status(201).send(campaign);
    },
  );

  r.get(
    '/campaigns',
    { schema: { querystring: paginationSchema, tags: TAGS, summary: 'Lista campanhas' } },
    async (request) => {
      const { page, perPage } = request.query;
      const db = getTenantDb(request);
      const [items, total] = await Promise.all([
        db.campaign.findMany({
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * perPage,
          take: perPage,
        }),
        db.campaign.count(),
      ]);
      return { items, total, page, perPage };
    },
  );

  r.get(
    '/campaigns/:id',
    { schema: { params: idParamSchema, tags: TAGS, summary: 'Detalha campanha' } },
    async (request) => {
      const campaign = await getTenantDb(request).campaign.findFirst({
        where: { id: request.params.id },
      });
      if (!campaign) throw new NotFoundError('Campanha');
      return campaign;
    },
  );

  r.patch(
    '/campaigns/:id',
    {
      schema: {
        params: idParamSchema,
        body: updateCampaignSchema,
        tags: TAGS,
        summary: 'Atualiza campanha',
      },
    },
    async (request) => {
      const result = await getTenantDb(request).campaign.updateMany({
        where: { id: request.params.id },
        data: request.body,
      });
      if (result.count === 0) throw new NotFoundError('Campanha');
      return { updated: true };
    },
  );
}
