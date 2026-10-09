import { ForbiddenException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { ROLES_KEY } from '../common/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { PistonRunnerService } from '../runner/piston-runner.service';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ResetScoresDto, SubmissionHistoryDto } from './dto/submission-history.dto';

function setup() {
  const prisma = {
    problem: { count: jest.fn().mockResolvedValue(1), findUnique: jest.fn().mockResolvedValue({ id: 'p' }), findMany: jest.fn().mockResolvedValue([{ id: 'p', title: 'Problem' }]) },
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'u' }), findMany: jest.fn().mockResolvedValue([{ id: 'u', displayName: 'U' }, { id: 'v', displayName: 'V' }]) },
    submission: {
      groupBy: jest.fn<Promise<unknown[]>, [Prisma.SubmissionGroupByArgs]>(),
      findMany: jest.fn<Promise<unknown[]>, [Prisma.SubmissionFindManyArgs]>().mockResolvedValue([]),
      findUnique: jest.fn<Promise<unknown>, [Prisma.SubmissionFindUniqueArgs]>(),
      count: jest.fn().mockResolvedValue(51),
      updateMany: jest.fn<Promise<{ count: number }>, [Prisma.SubmissionUpdateManyArgs]>().mockResolvedValue({ count: 2 }),
    },
    $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
  };
  const service = new SubmissionsService(prisma as unknown as PrismaService, {} as PistonRunnerService);
  return { service, prisma };
}

describe('submission browsing and score resets', () => {
  it('groups all history without truncating it to the last 100 submissions', async () => {
    const { service, prisma } = setup();
    const date = new Date();
    prisma.submission.groupBy.mockResolvedValueOnce([{ problemId: 'p', userId: 'u', _count: { _all: 150 }, _max: { submittedAt: date } }]).mockResolvedValueOnce([{ problemId: 'p', _max: { score: 80 } }]);
    expect(await service.problemSummaries('u')).toMatchObject([{ submissionCount: 150, userCount: 1, bestScore: 80 }]);
    expect(prisma.submission.groupBy.mock.calls[1][0].where).toEqual({ userId: 'u', scoreResetAt: null });
  });
  it('ranks respondents by their highest non-reset score', async () => {
    const { service, prisma } = setup();
    prisma.submission.groupBy.mockResolvedValueOnce([{ userId: 'u', _count: { _all: 3 }, _max: { submittedAt: new Date() } }, { userId: 'v', _count: { _all: 1 }, _max: { submittedAt: new Date() } }]).mockResolvedValueOnce([{ userId: 'u', _max: { score: 20 } }, { userId: 'v', _max: { score: 100 } }]);
    expect((await service.respondents('p')).respondents.map(row => row.user.id)).toEqual(['v', 'u']);
  });
  it('paginates a single user and problem without returning source code in the list', async () => {
    const { service, prisma } = setup();
    prisma.submission.findMany.mockResolvedValueOnce([{ id: 's', score: 80, scoreResetAt: new Date() }]);
    const result = await service.history('p', 'u', 2);
    expect(result).toMatchObject({ total: 51, page: 2, pageSize: 50, items: [{ score: 0 }] });
    expect(prisma.submission.findMany.mock.calls[0][0]).toMatchObject({ where: { problemId: 'p', userId: 'u' }, skip: 50, take: 50 });
    expect(prisma.submission.findMany.mock.calls[0][0].select?.sourceCode).toBeUndefined();
  });
  it.each([undefined, 'u'])('resets only the requested scope and preserves in-flight and historical records (%s)', async userId => {
    const { service, prisma } = setup();
    expect(await service.resetScores('p', userId)).toEqual({ resetCount: 2 });
    const args = prisma.submission.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ problemId: 'p', ...(userId ? { userId } : {}), scoreResetAt: null });
    expect(Object.keys(args.data)).toEqual(['scoreResetAt']);
    expect(args.data.scoreResetAt).toBeInstanceOf(Date);
  });
  it('hides another users source code while allowing admins to inspect it', async () => {
    const { service, prisma } = setup();
    prisma.submission.findUnique.mockResolvedValue({ id: 's', userId: 'v', sourceCode: 'private code', score: 100, scoreResetAt: new Date(), subtaskResults: [{ score: 100 }], results: [] });
    await expect(service.get({ sub: 'u', email: 'u@example.test', role: UserRole.USER }, 's')).rejects.toBeInstanceOf(ForbiddenException);
    expect(await service.get({ sub: 'u', email: 'u@example.test', role: UserRole.ADMIN }, 's')).toMatchObject({ sourceCode: 'private code', score: 0, subtaskResults: [{ score: 0 }] });
  });
  it('requires the admin role for every admin endpoint', () => {
    for (const method of ['adminProblems', 'adminRespondents', 'adminHistory', 'reset'] as const) {
      const handler: unknown = Object.getOwnPropertyDescriptor(SubmissionsController.prototype, method)?.value;
      if (typeof handler !== 'function') throw new Error('Missing controller method');
      const roles: unknown = Reflect.getMetadata(ROLES_KEY, handler);
      expect(roles).toEqual([UserRole.ADMIN]);
    }
  });
  it('rejects ambiguous reset scopes and invalid page numbers', async () => {
    expect(await validate(plainToInstance(ResetScoresDto, { userId: null }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(ResetScoresDto, { userId: '' }))).not.toHaveLength(0);
    for (const page of ['bad', 0, 1.5, 1000001]) expect(await validate(plainToInstance(SubmissionHistoryDto, { page }))).not.toHaveLength(0);
  });
});
