import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CompetitionsService } from './competitions.service';

describe('competition best score per problem', () => {
  const startsAt = new Date('2026-10-09T00:00:00Z');
  const submission = (problemId: string, score: number, userId = 'u') => ({
    userId, problemId, score: new Prisma.Decimal(score),
    executionTimeMs: 10, memoryUsedKb: 100,
    submittedAt: new Date(startsAt.getTime() + 1000),
  });

  async function leaderboard(submissions: ReturnType<typeof submission>[]) {
    const findFirst = jest.fn<Promise<unknown>, [Prisma.CompetitionFindFirstArgs]>().mockResolvedValue({
      id: 'c', deletedAt: null, startsAt,
      problems: [
        { problemId: 'p1', score: new Prisma.Decimal(200), problem: { maxScore: new Prisma.Decimal(100) } },
        { problemId: 'p2', score: new Prisma.Decimal(50), problem: { maxScore: new Prisma.Decimal(100) } },
      ],
      participants: [{ userId: 'u', user: { id: 'u', displayName: 'Student', avatarUrl: null } }],
      submissions,
    });
    const prisma = { competition: { findFirst } };
    const result = await new CompetitionsService(prisma as unknown as PrismaService).leaderboard('c');
    expect(findFirst.mock.calls[0][0].include?.submissions).toMatchObject({ where: {
      scoreResetAt: null, problem: { deletedAt: null },
    } });
    return result.entries[0];
  }

  it('does not add duplicate or lower scores, regardless of submission order', async () => {
    const attempts = [submission('p1', 40), submission('p1', 80), submission('p1', 80), submission('p1', 20), submission('p2', 60), submission('p1', 100, 'other')];
    for (const submissions of [attempts, [...attempts].reverse()]) {
      expect(await leaderboard(submissions)).toMatchObject({
        totalScore: 190, executionTimeMs: 20, memoryUsedKb: 200, solvedCount: 0,
      });
    }
  });

  it('increases the total only by the improvement in the best score', async () => {
    const attempts = [submission('p1', 80), submission('p2', 60)];
    const before = await leaderboard(attempts);
    const after = await leaderboard([...attempts, submission('p1', 100)]);
    expect(before.totalScore).toBe(190);
    expect(after.totalScore).toBe(230);
    expect(after.solvedCount).toBe(1);
  });
});
