import { type FastifyInstance } from 'fastify';
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

export function registerCampaignRoutes(app: FastifyInstance): void {
  app.post('/campaigns', async (request, reply) => {
    const data = createCampaignSchema.parse(request.body);
    // organizationId é injetado pela tenant extension; os tipos estáticos ainda
    // o exigem, daí o cast para o input "unchecked".
    const campaign = await getTenantDb(request).campaign.create({
      data: data as Prisma.CampaignUncheckedCreateInput,
      select: { id: true },
    });
    return reply.status(201).send(campaign);
  });

  app.get('/campaigns', async (request) => {
    const { page, perPage } = paginationSchema.parse(request.query);
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
  });

  app.get('/campaigns/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const campaign = await getTenantDb(request).campaign.findFirst({ where: { id } });
    if (!campaign) throw new NotFoundError('Campanha');
    return campaign;
  });

  app.patch('/campaigns/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const data = updateCampaignSchema.parse(request.body);
    const result = await getTenantDb(request).campaign.updateMany({
      where: { id },
      data: data,
    });
    if (result.count === 0) throw new NotFoundError('Campanha');
    return { updated: true };
  });
}
