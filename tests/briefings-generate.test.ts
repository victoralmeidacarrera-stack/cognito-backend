import { BriefingStatus, UserRole } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Caminho de falha do enqueue: se o BullMQ não aceita o job, o briefing NÃO
 * pode ficar preso em GENERATING — foi o que aconteceu em produção (briefing
 * travado, errorMessage null, e toda retentativa caindo no ConflictError, sem
 * rota para destravar).
 */

const { createJobRecordMock, enqueueGenerateCreativeMock, markJobFailedMock } = vi.hoisted(() => ({
  createJobRecordMock: vi.fn<() => Promise<string>>(),
  enqueueGenerateCreativeMock: vi.fn<() => Promise<void>>(),
  markJobFailedMock: vi.fn<(jobId: string, errorMessage: string) => Promise<void>>(),
}));

vi.mock('../src/modules/jobs/jobs.service.js', () => ({
  createJobRecord: createJobRecordMock,
  enqueueGenerateCreative: enqueueGenerateCreativeMock,
  markJobFailed: markJobFailedMock,
}));

const { assertCanGenerateMock } = vi.hoisted(() => ({
  assertCanGenerateMock: vi.fn<() => Promise<void>>(),
}));

vi.mock('../src/modules/usage/usage.service.js', () => ({
  assertCanGenerate: assertCanGenerateMock,
}));

import { generateBriefing } from '../src/modules/briefings/briefings.service.js';
import { type TenantPrisma } from '../src/config/tenant.js';
import { ServiceUnavailableError } from '../src/shared/errors.js';
import { type RequestContext } from '../src/shared/types.js';

const ORG = 'org-demo';
const BRIEFING_ID = 'br-1';
const JOB_ID = 'job-1';

const ctx: RequestContext = { organizationId: ORG, userId: 'user-1', role: UserRole.ADMIN };

interface UpdateManyArgs {
  where: { id: string };
  data: {
    status?: BriefingStatus;
    failedAt?: Date | null;
    errorMessage?: string | null;
    idempotencyKey?: string | null;
  };
}

interface BriefingRow {
  id: string;
  status: BriefingStatus;
  requestedVariations: number;
  idempotencyKey: string | null;
}

/**
 * Fake do client já escopado por tenant (a extension é testada em tenant.test.ts).
 * Ele tem **estado**: o `findFirst` enxerga o que o `updateMany` gravou. Sem
 * isso uma 2ª chamada a `generateBriefing` leria sempre o briefing original e
 * o teste de replay pós-rollback passaria mesmo com o bug.
 */
function fakeDb(
  overrides: {
    updateMany?: (args: UpdateManyArgs) => Promise<unknown>;
    lastJobId?: string;
  } = {},
) {
  const row: BriefingRow = {
    id: BRIEFING_ID,
    status: BriefingStatus.DRAFT,
    requestedVariations: 6,
    idempotencyKey: null,
  };
  const updates: UpdateManyArgs[] = [];
  const updateMany = vi.fn(async (args: UpdateManyArgs) => {
    updates.push(args);
    // Se o override rejeita, a escrita não acontece — como num banco de verdade.
    if (overrides.updateMany) await overrides.updateMany(args);
    if (args.data.status !== undefined) row.status = args.data.status;
    if ('idempotencyKey' in args.data) row.idempotencyKey = args.data.idempotencyKey ?? null;
    return { count: 1 };
  });
  const db = {
    briefing: {
      findFirst: vi.fn(() => Promise.resolve({ ...row })),
      updateMany,
    },
    job: {
      findFirst: vi.fn(() =>
        Promise.resolve(overrides.lastJobId ? { id: overrides.lastJobId } : null),
      ),
    },
  };
  return { db: db as unknown as TenantPrisma, updates, row };
}

beforeEach(() => {
  createJobRecordMock.mockReset().mockResolvedValue(JOB_ID);
  enqueueGenerateCreativeMock.mockReset().mockResolvedValue(undefined);
  markJobFailedMock.mockReset().mockResolvedValue(undefined);
  assertCanGenerateMock.mockReset().mockResolvedValue(undefined);
});

describe('generateBriefing — enqueue OK', () => {
  it('devolve o job e deixa o briefing em GENERATING', async () => {
    const { db, updates } = fakeDb();

    const result = await generateBriefing(db, ctx, BRIEFING_ID, undefined);

    expect(result).toEqual({
      briefingId: BRIEFING_ID,
      jobId: JOB_ID,
      status: BriefingStatus.GENERATING,
      idempotentReplay: false,
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]?.data.status).toBe(BriefingStatus.GENERATING);
    expect(markJobFailedMock).not.toHaveBeenCalled();
  });
});

describe('generateBriefing — enqueue falha', () => {
  it('marca briefing FAILED com a causa real e o job como falho', async () => {
    enqueueGenerateCreativeMock.mockRejectedValue(new Error('connect ECONNREFUSED ::1:6379'));
    const { db, updates } = fakeDb();

    await expect(generateBriefing(db, ctx, BRIEFING_ID, undefined)).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );

    // 1ª atualização = GENERATING; 2ª = rollback para FAILED.
    expect(updates).toHaveLength(2);
    const rollback = updates[1];
    expect(rollback?.where).toEqual({ id: BRIEFING_ID });
    expect(rollback?.data.status).toBe(BriefingStatus.FAILED);
    expect(rollback?.data.failedAt).toBeInstanceOf(Date);
    // A mensagem tem que apontar a causa, não um texto genérico.
    expect(rollback?.data.errorMessage).toContain('ECONNREFUSED');

    expect(markJobFailedMock).toHaveBeenCalledWith(JOB_ID, 'connect ECONNREFUSED ::1:6379');
  });

  it('propaga 503 SERVICE_UNAVAILABLE com a causa na mensagem', async () => {
    enqueueGenerateCreativeMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND redis'));
    const { db } = fakeDb();

    const error = await generateBriefing(db, ctx, BRIEFING_ID, undefined).catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(ServiceUnavailableError);
    const appError = error as ServiceUnavailableError;
    expect(appError.statusCode).toBe(503);
    expect(appError.code).toBe('SERVICE_UNAVAILABLE');
    expect(appError.message).toContain('ENOTFOUND');
  });

  it('rollback quebrado não mascara o erro do enqueue', async () => {
    enqueueGenerateCreativeMock.mockRejectedValue(new Error('fila fora do ar'));
    const { db } = fakeDb({
      updateMany: (args) =>
        args.data.status === BriefingStatus.FAILED
          ? Promise.reject(new Error('banco caiu no rollback'))
          : Promise.resolve({ count: 1 }),
    });

    const error = await generateBriefing(db, ctx, BRIEFING_ID, undefined).catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect((error as Error).message).toContain('fila fora do ar');
    expect((error as Error).message).not.toContain('banco caiu');
  });

  it('as duas escritas do rollback são independentes: briefing falha, job ainda é marcado', async () => {
    enqueueGenerateCreativeMock.mockRejectedValue(new Error('fila fora do ar'));
    const { db } = fakeDb({
      updateMany: (args) =>
        args.data.status === BriefingStatus.FAILED
          ? Promise.reject(new Error('banco caiu no rollback'))
          : Promise.resolve({ count: 1 }),
    });

    await expect(generateBriefing(db, ctx, BRIEFING_ID, undefined)).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );

    // Se as duas escritas estivessem no mesmo try, o Job ficaria QUEUED p/ sempre.
    expect(markJobFailedMock).toHaveBeenCalledWith(JOB_ID, 'fila fora do ar');
  });

  it('markJobFailed quebrado também não mascara o erro do enqueue', async () => {
    enqueueGenerateCreativeMock.mockRejectedValue(new Error('fila fora do ar'));
    markJobFailedMock.mockRejectedValue(new Error('banco caiu ao marcar o job'));
    const { db, updates } = fakeDb();

    const error = await generateBriefing(db, ctx, BRIEFING_ID, undefined).catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect((error as Error).message).toContain('fila fora do ar');
    expect((error as Error).message).not.toContain('marcar o job');
    // O briefing foi destravado antes, e continua destravado.
    expect(updates[1]?.data.status).toBe(BriefingStatus.FAILED);
  });

  it('cota do Upstash estourada: o ReplyError cru chega ao briefing e ao 503', async () => {
    // Formato exato do que o ioredis devolve quando o free tier acaba — foi o
    // que derrubou a geração em 03/08/2026 com o readiness verde.
    const quotaError = new Error('ERR max requests limit exceeded. Limit: 500000, Usage: 500000');
    quotaError.name = 'ReplyError';
    enqueueGenerateCreativeMock.mockRejectedValue(quotaError);
    const { db, updates } = fakeDb();

    const error = await generateBriefing(db, ctx, BRIEFING_ID, undefined).catch(
      (err: unknown) => err,
    );

    expect(updates[1]?.data.status).toBe(BriefingStatus.FAILED);
    expect(updates[1]?.data.errorMessage).toContain(
      'ERR max requests limit exceeded. Limit: 500000, Usage: 500000',
    );
    expect(markJobFailedMock).toHaveBeenCalledWith(
      JOB_ID,
      'ERR max requests limit exceeded. Limit: 500000, Usage: 500000',
    );
    expect((error as Error).message).toContain('max requests limit exceeded');
  });

  it('normaliza a mensagem: uma linha, sem stack, e nunca vazia', async () => {
    enqueueGenerateCreativeMock.mockRejectedValue(
      new Error(
        'ERR max requests limit exceeded.\n    at Socket.onData (ioredis)\n  Limit: 500000',
      ),
    );
    const { db, updates } = fakeDb();

    await expect(generateBriefing(db, ctx, BRIEFING_ID, undefined)).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );

    const message = updates[1]?.data.errorMessage ?? '';
    expect(message).not.toContain('\n');
    expect(message).toContain('ERR max requests limit exceeded. at Socket.onData (ioredis) Limit');
  });

  it('erro sem mensagem cai no nome do erro, não em texto vazio', async () => {
    const nameless = new Error('');
    nameless.name = 'ReplyError';
    enqueueGenerateCreativeMock.mockRejectedValue(nameless);
    const { db, updates } = fakeDb();

    await expect(generateBriefing(db, ctx, BRIEFING_ID, undefined)).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
    expect(updates[1]?.data.errorMessage).toContain('ReplyError');
  });

  it('erro não-Error vira string na mensagem, sem quebrar o rollback', async () => {
    enqueueGenerateCreativeMock.mockRejectedValue('boom');
    const { db, updates } = fakeDb();

    await expect(generateBriefing(db, ctx, BRIEFING_ID, undefined)).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
    expect(updates[1]?.data.errorMessage).toContain('boom');
  });
});

/**
 * O 503 diz "tente novamente em instantes". Um cliente idempotente correto
 * retenta com a MESMA Idempotency-Key — e é aí que o rollback tem que ter
 * soltado a chave, senão o replay lá em cima devolve 200 com o job morto e o
 * briefing fica em FAILED permanente, sem rota para destravar.
 */
describe('generateBriefing — idempotência depois do rollback', () => {
  const KEY = 'chave-do-cliente';

  it('rollback limpa o idempotencyKey', async () => {
    enqueueGenerateCreativeMock.mockRejectedValue(new Error('ERR max requests limit exceeded'));
    const { db, updates, row } = fakeDb();

    await expect(generateBriefing(db, ctx, BRIEFING_ID, KEY)).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );

    expect(updates[0]?.data.idempotencyKey).toBe(KEY);
    expect(updates[1]?.data.idempotencyKey).toBeNull();
    expect(row.idempotencyKey).toBeNull();
  });

  it('retry com a mesma chave volta a enfileirar (não é replay do job morto)', async () => {
    enqueueGenerateCreativeMock.mockRejectedValueOnce(
      new Error('ERR max requests limit exceeded. Limit: 500000, Usage: 500000'),
    );
    // Se o replay disparar, é este job antigo (falho) que seria devolvido.
    const { db } = fakeDb({ lastJobId: 'job-antigo' });

    await expect(generateBriefing(db, ctx, BRIEFING_ID, KEY)).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );

    const retry = await generateBriefing(db, ctx, BRIEFING_ID, KEY);

    expect(retry).toEqual({
      briefingId: BRIEFING_ID,
      jobId: JOB_ID,
      status: BriefingStatus.GENERATING,
      idempotentReplay: false,
    });
    expect(enqueueGenerateCreativeMock).toHaveBeenCalledTimes(2);
  });

  it('replay idempotente continua valendo quando o enqueue deu certo', async () => {
    const { db } = fakeDb({ lastJobId: JOB_ID });

    await generateBriefing(db, ctx, BRIEFING_ID, KEY);
    const replay = await generateBriefing(db, ctx, BRIEFING_ID, KEY);

    expect(replay).toEqual({
      briefingId: BRIEFING_ID,
      jobId: JOB_ID,
      status: BriefingStatus.GENERATING,
      idempotentReplay: true,
    });
    // O ponto do replay: o job NÃO é enfileirado de novo.
    expect(enqueueGenerateCreativeMock).toHaveBeenCalledTimes(1);
  });
});
