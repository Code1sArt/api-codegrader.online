import { rankLeaderboard } from './leaderboard';

describe('rankLeaderboard', () => {
  const base = { avatarUrl: null, completionTimeMs: 100, executionTimeMs: 10, memoryUsedKb: 100, solvedCount: 1 };

  it('prioritizes score, completion speed, execution time, then memory', () => {
    const ranked = rankLeaderboard([
      { ...base, userId: 'memory', displayName: 'Memory', totalScore: 80, memoryUsedKb: 50 },
      { ...base, userId: 'score', displayName: 'Score', totalScore: 100, completionTimeMs: 999 },
      { ...base, userId: 'fast', displayName: 'Fast', totalScore: 80, completionTimeMs: 50 },
    ]);
    expect(ranked.map((item) => item.userId)).toEqual(['score', 'fast', 'memory']);
  });
});
