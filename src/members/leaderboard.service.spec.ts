import { Prisma, SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GlobalLeaderboardService } from './leaderboard.service';

describe('global leaderboard best score per problem', () => {
  it('requests one maximum per user and problem across practice and competitions', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      { userId: 'u', problemId: 'p1', _max: { score: new Prisma.Decimal(80) } },
      { userId: 'u', problemId: 'p2', _max: { score: new Prisma.Decimal(35) } },
    ]);
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue([
        { id: 'u', displayName: 'Student', avatarUrl: null },
        { id: 'v', displayName: 'New student', avatarUrl: null },
      ]) },
      submission: { groupBy },
    };
    const result = await new GlobalLeaderboardService(prisma as unknown as PrismaService).get();
    expect(groupBy).toHaveBeenCalledWith({
      by: ['userId', 'problemId'],
      _max: { score: true },
      where: {
        scoreResetAt: null,
        problem: { deletedAt: null, status: 'PUBLISHED' },
        user: { isActive: true, deletedAt: null, privacyAcceptedAt: { not: null } },
        status: { notIn: [SubmissionStatus.QUEUED, SubmissionStatus.JUDGING, SubmissionStatus.SYSTEM_ERROR] },
      },
    });
    expect(result.entries).toMatchObject([
      { userId: 'u', totalScore: 115, rank: 1 },
      { userId: 'v', totalScore: 0, rank: 2 },
    ]);
  });
});
