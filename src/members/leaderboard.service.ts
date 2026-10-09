import { Injectable } from "@nestjs/common";
import { SubmissionStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
@Injectable()
export class GlobalLeaderboardService {
  constructor(private readonly prisma: PrismaService) {}
  async get() {
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        privacyAcceptedAt: { not: null },
      },
      select: { id: true, displayName: true, avatarUrl: true },
    });
    const scores = await this.prisma.submission.groupBy({
      by: ["userId", "problemId"],
      where: {
        scoreResetAt: null,
        problem: { deletedAt: null, status: "PUBLISHED" },
        user: {
          isActive: true,
          deletedAt: null,
          privacyAcceptedAt: { not: null },
        },
        status: {
          notIn: [
            SubmissionStatus.QUEUED,
            SubmissionStatus.JUDGING,
            SubmissionStatus.SYSTEM_ERROR,
          ],
        },
      },
      _max: { score: true },
    });
    const totals = new Map<string, number>();
    for (const row of scores)
      totals.set(
        row.userId,
        (totals.get(row.userId) ?? 0) + Number(row._max.score ?? 0),
      );
    const entries = users.map((user) => ({
      userId: user.id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      totalScore: Math.round((totals.get(user.id) ?? 0) * 100) / 100,
    }));
    entries.sort(
      (a, b) =>
        b.totalScore - a.totalScore ||
        a.displayName.localeCompare(b.displayName) ||
        a.userId.localeCompare(b.userId),
    );
    let rank = 0;
    return {
      generatedAt: new Date(),
      entries: entries.map((row, index) => {
        if (!index || row.totalScore !== entries[index - 1].totalScore)
          rank = index + 1;
        return { ...row, rank };
      }),
    };
  }
}
