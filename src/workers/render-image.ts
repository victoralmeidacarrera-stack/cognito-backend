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
import { renderAndUpload } from '../modules/render/render.service.js';
import { type CreativeCopy } from '../shared/schemas.js';

function disclaimerFrom(factoryRestrictions: unknown): string {
  if (factoryRestrictions && typeof factoryRestrictions === 'object') {
    const value = (factoryRestrictions as Record<string, unknown>).disclaimerObrigatorio;
    if (typeof value === 'string') return value;
  }
  return '';
}

export async function processRenderImage(job: Job): Promise<void> {
  const { jobId, organizationId, creativeId } = renderImagePayloadSchema.parse(job.data);
  const db = tenantPrisma(organizationId);
  const log = logger.child({ worker: 'render-image', creativeId, organizationId });

  try {
    const creative = await db.creative.findFirst({
      where: { id: creativeId },
      include: { template: true },
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
        select: { factoryRestrictions: true },
      }),
    ]);

    const copy = creative.copy as unknown as CreativeCopy;
    const data: Record<string, unknown> = {
      headline: copy.headline,
      cta: copy.cta,
      sub_headline: copy.sub_headline ?? '',
      descricao: copy.descricao ?? '',
      emoji: copy.emoji_sugerido ?? '',
      disclaimer: disclaimerFrom(org.factoryRestrictions),
      brand: brandBook
        ? {
            primaryColor: brandBook.primaryColor ?? '#0A2540',
            secondaryColor: brandBook.secondaryColor ?? '#1565C0',
            accentColor: brandBook.accentColor ?? '#FFB300',
            typography: brandBook.typography,
          }
        : {},
    };

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
