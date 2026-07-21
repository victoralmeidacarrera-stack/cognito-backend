import { BriefingStatus, type Prisma } from '@prisma/client';
import { type Job } from 'bullmq';
import { isProduction } from '../config/env.js';
import { logger } from '../config/logger.js';
import { tenantPrisma } from '../config/tenant.js';
import { resolveBriefingBackgrounds } from '../modules/backgrounds/backgrounds.service.js';
import { createCreativesFromVariations } from '../modules/creatives/creatives.service.js';
import {
  buildVariations,
  devFallbackOutput,
  generateCopy,
  loadGenerationContext,
  type GenerationResult,
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

    let generation: GenerationResult;
    try {
      generation = await generateCopy(ctx);
    } catch (err) {
      // Fora de produção, Claude indisponível (sem chave/sem crédito) não trava
      // o fluxo: usa copy determinística de fallback e segue o pipeline real.
      if (isProduction) throw err;
      log.warn({ err }, 'Claude indisponível — usando copy de fallback (dev)');
      generation = {
        output: devFallbackOutput(ctx),
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        model: 'dev-fallback',
      };
    }
    const { output, usage, model } = generation;
    log.info(
      {
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
      },
      'copy gerada',
    );
    if (model !== 'dev-fallback') {
      await recordAiUsage({ organizationId, briefingId, model, usage });
    }

    const templates = await db.template.findMany({
      where: { format: ctx.briefing.format, isActive: true },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });

    // Prompt do fundo escrito pelo usuário no briefing (opcional).
    const briefingInput = (ctx.briefing.input ?? {}) as Record<string, unknown>;
    const promptOverride =
      typeof briefingInput.backgroundPrompt === 'string' ? briefingInput.backgroundPrompt : null;

    // Resolve os fundos uma vez por briefing (foto real → Flux → cor sólida);
    // reusados em round-robin entre as variações. Best-effort (não quebra).
    const backgrounds = await resolveBriefingBackgrounds(db, {
      organizationId,
      briefingId,
      format: ctx.briefing.format,
      vehicle: ctx.vehicle,
      promptOverride,
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
