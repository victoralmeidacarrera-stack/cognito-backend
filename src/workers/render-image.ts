import { CreativeStatus } from '@prisma/client';
import { type Job } from 'bullmq';
import { logger } from '../config/logger.js';
import { prisma } from '../config/prisma.js';
import { tenantPrisma } from '../config/tenant.js';
import { ensurePendingApproval } from '../modules/approvals/approvals.service.js';
import {
  applyRenderResult,
  markCreativeRenderFailed,
} from '../modules/creatives/creatives.service.js';
import { renderImagePayloadSchema } from '../modules/jobs/job-payloads.js';
import { markJobCompleted, markJobFailed } from '../modules/jobs/jobs.service.js';
import { buildRenderData } from '../modules/render/render-data.js';
import { renderAndUpload } from '../modules/render/render.service.js';
import { type CreativeCopy } from '../shared/schemas.js';

export async function processRenderImage(job: Job): Promise<void> {
  const { jobId, organizationId, creativeId } = renderImagePayloadSchema.parse(job.data);
  const db = tenantPrisma(organizationId);
  const log = logger.child({ worker: 'render-image', creativeId, organizationId });

  try {
    const creative = await db.creative.findFirst({
      where: { id: creativeId },
      include: { template: true, briefing: { include: { vehicle: true } } },
    });
    if (!creative) throw new Error('Creative não encontrado');
    if (!creative.template) throw new Error('Creative sem template associado');

    await db.creative.updateMany({
      where: { id: creativeId },
      data: { status: CreativeStatus.RENDERING },
    });

    const [brandBook, org] = await Promise.all([
      db.brandBook.findFirst({ where: { isActive: true }, orderBy: { updatedAt: 'desc' } }),
      prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { factoryRestrictions: true, name: true },
      }),
    ]);

    // Contrato de dados centralizado em render-data.ts (mesmo builder usado
    // pelo script de preview dos templates).
    const data = buildRenderData({
      copy: creative.copy as unknown as CreativeCopy,
      vehicle: creative.briefing?.vehicle ?? null,
      brandBook,
      factoryRestrictions: org.factoryRestrictions,
      briefingInput: creative.briefing?.input ?? null,
      backgroundUrl: creative.backgroundUrl,
      storeName: org.name,
      canvas: { width: creative.template.width, height: creative.template.height },
    });

    const result = await renderAndUpload({
      organizationId,
      creativeId,
      render: {
        format: creative.template.format,
        slug: creative.template.slug,
        width: creative.template.width,
        height: creative.template.height,
        data,
      },
    });

    await applyRenderResult(db, creativeId, result);
    await ensurePendingApproval(db, creativeId);

    if (jobId) await markJobCompleted(jobId);
    log.info({ key: result.key }, 'render concluído');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'erro desconhecido';
    log.error({ err }, 'render falhou');
    await markCreativeRenderFailed(db, creativeId);
    if (jobId) await markJobFailed(jobId, message);
    throw err;
  }
}
