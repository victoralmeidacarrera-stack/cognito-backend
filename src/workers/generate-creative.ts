import { BriefingStatus, type Prisma } from '@prisma/client';
import { type Job } from 'bullmq';
import { logger } from '../config/logger.js';
import { tenantPrisma } from '../config/tenant.js';
import { resolveBriefingBackgrounds } from '../modules/backgrounds/backgrounds.service.js';
import { createCreativesFromVariations } from '../modules/creatives/creatives.service.js';
import {
  buildVariations,
  generateCopy,
  loadGenerationContext,
} from '../modules/generation/generation.service.js';
import { generateCreativePayloadSchema } from '../modules/jobs/job-payloads.js';
import {
  enqueueRenderImage,
  markJobCompleted,
  markJobFailed,
} from '../modules/jobs/jobs.service.js';
import { recordAiUsage, recordVariationUsage } from '../modules/usage/usage.service.js';
import { notifyCreativesReady } from '../modules/notifications/notifications.service.js';

export async function processGenerateCreative(job: Job): Promise<void> {
  const { jobId, organizationId, briefingId } = generateCreativePayloadSchema.parse(job.data);
  const db = tenantPrisma(organizationId);
  const log = logger.child({ worker: 'generate-creative', jobId, briefingId, organizationId });

  try {
    const ctx = await loadGenerationContext(db, organizationId, briefingId);

    const { output, usage, model } = await generateCopy(ctx);
    log.info(
      {
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
      },
      'copy gerada',
    );
    await recordAiUsage({ organizationId, briefingId, model, usage });

    const templates = await db.template.findMany({
      where: { format: ctx.briefing.format, isActive: true },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });

    // Resolve os fundos uma vez por briefing (foto real → Flux → cor sólida);
    // reusados em round-robin entre as variações. Best-effort (não quebra).
    const backgrounds = await resolveBriefingBackgrounds(db, {
      organizationId,
      briefingId,
      format: ctx.briefing.format,
      vehicle: ctx.vehicle,
    });
    log.info({ backgrounds: backgrounds.length }, 'fundos resolvidos');

    const variations = buildVariations(output, ctx.briefing.requestedVariations);
    const creatives = await createCreativesFromVariations(db, {
      briefingId,
      format: ctx.briefing.format,
      variations,
      templateIds: templates.map((t) => t.id),
      backgrounds,
    });

    await recordVariationUsage({ organizationId, briefingId, quantity: creatives.length });

    await db.briefing.updateMany({
      where: { id: briefingId },
      data: {
        aiOutput: output as unknown as Prisma.InputJsonValue,
        status: BriefingStatus.GENERATED,
        generatedAt: new Date(),
      },
    });

    // Enfileira o render de cada criativo.
    await Promise.all(
      creatives.map((creative) => enqueueRenderImage({ organizationId, creativeId: creative.id })),
    );

    // Notifica a org (best-effort; não falha o job se o email der erro).
    try {
      await notifyCreativesReady({
        organizationId,
        briefingTitle: ctx.briefing.title,
        count: creatives.length,
      });
    } catch (notifyErr) {
      log.warn({ err: notifyErr }, 'falha ao notificar criativos prontos');
    }

    await markJobCompleted(jobId);
    log.info({ creatives: creatives.length }, 'geração concluída');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'erro desconhecido';
    log.error({ err }, 'geração falhou');
    await db.briefing.updateMany({
      where: { id: briefingId },
      data: { status: BriefingStatus.FAILED, failedAt: new Date(), errorMessage: message },
    });
    await markJobFailed(jobId, message);
    throw err;
  }
}
