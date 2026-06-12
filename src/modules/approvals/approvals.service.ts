import { ApprovalStatus, type Prisma } from '@prisma/client';
import { type TenantPrisma } from '../../config/tenant.js';
import { NotFoundError } from '../../shared/errors.js';
import { type RequestContext } from '../../shared/types.js';

/** Garante uma aprovação PENDENTE para o criativo (idempotente). */
export async function ensurePendingApproval(db: TenantPrisma, creativeId: string): Promise<void> {
  await db.approval.upsert({
    where: { creativeId },
    update: {},
    // organizationId injetado pela tenant extension.
    create: { creativeId, status: ApprovalStatus.PENDING } as Prisma.ApprovalUncheckedCreateInput,
  });
}

/** Decisão do cliente (self-service): aprova ou rejeita o próprio criativo. */
export async function decideApproval(
  db: TenantPrisma,
  ctx: RequestContext,
  input: { creativeId: string; status: 'APPROVED' | 'REJECTED'; note?: string | undefined },
): Promise<{ id: string; status: ApprovalStatus }> {
  const existing = await db.approval.findFirst({
    where: { creativeId: input.creativeId },
    select: { id: true },
  });
  if (!existing) throw new NotFoundError('Aprovação');

  await db.approval.updateMany({
    where: { creativeId: input.creativeId },
    data: {
      status: ApprovalStatus[input.status],
      decidedById: ctx.userId,
      decidedAt: new Date(),
      ...(input.note ? { note: input.note } : {}),
    },
  });

  return { id: existing.id, status: ApprovalStatus[input.status] };
}
