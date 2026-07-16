import { type CreativeFormat, CreativeStatus, type Prisma } from '@prisma/client';
import { type TenantPrisma } from '../../config/tenant.js';
import { DomainError } from '../../shared/errors.js';
import { type CreativeCopy } from '../../shared/schemas.js';

export interface CreatedCreative {
  id: string;
  variationIndex: number;
}

/** Cria 1 Creative por variação, pareando templates em round-robin. */
export async function createCreativesFromVariations(
  db: TenantPrisma,
  input: {
    briefingId: string;
    format: CreativeFormat;
    variations: CreativeCopy[];
    templateIds: string[];
    // Fundos resolvidos 1x por briefing (foto real ou Flux), reusados em
    // round-robin. Vazio = sem fundo (template renderiza sobre cor sólida).
    backgrounds?: string[];
  },
): Promise<CreatedCreative[]> {
  if (input.templateIds.length === 0) {
    throw new DomainError('Nenhum template ativo para o formato solicitado.');
  }

  const backgrounds = input.backgrounds ?? [];
  const created: CreatedCreative[] = [];
  for (let i = 0; i < input.variations.length; i += 1) {
    const copy = input.variations[i];
    const templateId = input.templateIds[i % input.templateIds.length];
    if (!copy || !templateId) continue;

    const backgroundUrl = backgrounds.length > 0 ? backgrounds[i % backgrounds.length] : null;

    const creative = await db.creative.create({
      // organizationId injetado pela tenant extension.
      data: {
        briefingId: input.briefingId,
        templateId,
        format: input.format,
        status: CreativeStatus.COPY_READY,
        variationIndex: i,
        copy: copy as unknown as Prisma.InputJsonValue,
        backgroundUrl,
      } as unknown as Prisma.CreativeUncheckedCreateInput,
      select: { id: true, variationIndex: true },
    });
    created.push(creative);
  }
  return created;
}

/** Persiste o resultado do render (imagem no R2). */
export async function applyRenderResult(
  db: TenantPrisma,
  creativeId: string,
  result: { key: string; url: string | null },
): Promise<void> {
  await db.creative.updateMany({
    where: { id: creativeId },
    data: {
      imageR2Key: result.key,
      imageUrl: result.url,
      status: CreativeStatus.RENDERED,
    },
  });
}

export async function markCreativeRenderFailed(
  db: TenantPrisma,
  creativeId: string,
): Promise<void> {
  await db.creative.updateMany({
    where: { id: creativeId },
    data: { status: CreativeStatus.FAILED },
  });
}
