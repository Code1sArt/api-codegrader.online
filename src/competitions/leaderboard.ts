export type LeaderboardEntry = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  totalScore: number;
  completionTimeMs: number;
  executionTimeMs: number;
  memoryUsedKb: number;
  solvedCount: number;
};

export function rankLeaderboard(entries: LeaderboardEntry[]) {
  return [...entries]
    .sort((a, b) =>
      b.totalScore - a.totalScore ||
      a.completionTimeMs - b.completionTimeMs ||
      a.executionTimeMs - b.executionTimeMs ||
      a.memoryUsedKb - b.memoryUsedKb ||
      a.displayName.localeCompare(b.displayName),
    )
    .map((entry, index) => ({ rank: index + 1, ...entry }));
}
