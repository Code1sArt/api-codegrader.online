import { rankLeaderboard } from './leaderboard';

describe('rankLeaderboard', () => {
  const base = { avatarUrl: null, completionTimeMs: 100, executionTimeMs: 10, memoryUsedKb: 100, solvedCount: 1 };

  it('prioritizes score, execution time, then memory regardless of submission time', () => {
    const ranked = rankLeaderboard([
      { ...base, userId: 'early', displayName: 'Early', totalScore: 80, completionTimeMs: 1, executionTimeMs: 30, memoryUsedKb: 1 },
      { ...base, userId: 'memory', displayName: 'Memory', totalScore: 80, completionTimeMs: 999, memoryUsedKb: 50 },
      { ...base, userId: 'score', displayName: 'Score', totalScore: 100, completionTimeMs: 999, executionTimeMs: 999, memoryUsedKb: 999 },
      { ...base, userId: 'fast', displayName: 'Fast', totalScore: 80, completionTimeMs: 9999, executionTimeMs: 5, memoryUsedKb: 500 },
      { ...base, userId: 'slower-memory', displayName: 'Slower memory', totalScore: 80, completionTimeMs: 2 },
    ]);
    expect(ranked.map((item) => item.userId)).toEqual(['score', 'fast', 'memory', 'slower-memory', 'early']);
    expect(ranked.map((item) => item.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it('uses a stable name order when performance is equal and ignores completion time', () => {
    const entries = [
      { ...base, userId: 'b', displayName: 'B', totalScore: 100, completionTimeMs: 1 },
      { ...base, userId: 'a', displayName: 'A', totalScore: 100, completionTimeMs: 999 },
    ];
    expect(rankLeaderboard(entries).map((item) => item.userId)).toEqual(['a', 'b']);
    expect(entries.map((item) => item.userId)).toEqual(['b', 'a']);
  });

  it('places missing runtime measurements behind measured submissions at equal score', () => {
    const ranked = rankLeaderboard([
      { ...base, userId: 'missing', displayName: 'Missing', totalScore: 0, executionTimeMs: Number.MAX_SAFE_INTEGER, memoryUsedKb: Number.MAX_SAFE_INTEGER },
      { ...base, userId: 'measured', displayName: 'Measured', totalScore: 0 },
    ]);
    expect(ranked.map((item) => item.userId)).toEqual(['measured', 'missing']);
  });
});
