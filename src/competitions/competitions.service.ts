import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CompetitionStatus, ProblemStatus, SubmissionStatus, UserRole } from '@prisma/client';
import type { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompetitionDto } from './dto/competition.dto';
import { rankLeaderboard } from './leaderboard';

const JUDGED_STATUSES: SubmissionStatus[] = [
  SubmissionStatus.ACCEPTED,
  SubmissionStatus.PARTIAL,
  SubmissionStatus.WRONG_ANSWER,
  SubmissionStatus.COMPILE_ERROR,
  SubmissionStatus.RUNTIME_ERROR,
  SubmissionStatus.TIME_LIMIT_EXCEEDED,
  SubmissionStatus.MEMORY_LIMIT_EXCEEDED,
];

@Injectable()
export class CompetitionsService {
  constructor(private readonly prisma: PrismaService) {}

  list(user: AuthUser) {
    return this.prisma.competition.findMany({
      where: { deletedAt: null, ...(user.role === UserRole.ADMIN ? {} : { status: { in: [CompetitionStatus.PUBLISHED, CompetitionStatus.CLOSED] } }) },
      include: {
        _count: { select: { participants: true, problems: { where: { problem: { deletedAt: null } } } } },
        participants: { where: { userId: user.sub }, select: { joinedAt: true } },
      },
      orderBy: { startsAt: 'desc' },
    });
  }

  async get(user: AuthUser, id: string) {
    const competition = await this.prisma.competition.findFirst({
      where: { id, deletedAt: null, ...(user.role === UserRole.ADMIN ? {} : { status: { not: CompetitionStatus.DRAFT } }) },
      include: {
        problems: {
          where: { problem: { deletedAt: null } },
          include: { problem: { select: { id: true, slug: true, title: true, difficulty: true, allowedLanguages: true, timeLimitMs: true, memoryLimitMb: true } } },
          orderBy: { position: 'asc' },
        },
        participants: { where: { userId: user.sub }, select: { joinedAt: true } },
      },
    });
    if (!competition || competition.deletedAt) throw new NotFoundException('Competition not found');
    const started = competition.startsAt <= new Date();
    return {
      ...competition,
      problems: started || user.role === UserRole.ADMIN ? competition.problems : [],
      joined: competition.participants.length > 0,
    };
  }

  async create(user: AuthUser, dto: CreateCompetitionDto) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt) throw new BadRequestException('endsAt must be after startsAt');
    const problemIds = dto.problems.map((item) => item.problemId);
    if (new Set(problemIds).size !== problemIds.length) throw new BadRequestException('Duplicate problem');
    const count = await this.prisma.problem.count({ where: { id: { in: problemIds }, status: ProblemStatus.PUBLISHED, deletedAt: null } });
    if (count !== problemIds.length) throw new BadRequestException('Every competition problem must be published');
    return this.prisma.competition.create({
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        startsAt,
        endsAt,
        createdById: user.sub,
        problems: { create: dto.problems.map((problem, index) => ({ ...problem, position: index + 1 })) },
      },
      include: { problems: true },
    });
  }

  async setStatus(id: string, status: CompetitionStatus) {
    const competition = await this.prisma.competition.findUnique({ where: { id }, include: { _count: { select: { problems: { where: { problem: { deletedAt: null } } } } } } });
    if (!competition || competition.deletedAt) throw new NotFoundException('Competition not found');
    if (status === CompetitionStatus.PUBLISHED && !competition._count.problems) {
      throw new BadRequestException('Competition must contain at least one problem');
    }
    return this.prisma.competition.update({ where: { id }, data: { status } });
  }

  async remove(id: string) {
    const result = await this.prisma.competition.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), status: CompetitionStatus.CLOSED } });
    if (!result.count) throw new NotFoundException('Competition not found');
    return { deleted: true };
  }

  async join(user: AuthUser, id: string) {
    const competition = await this.prisma.competition.findFirst({
      where: { id, deletedAt: null, status: CompetitionStatus.PUBLISHED, endsAt: { gt: new Date() } },
    });
    if (!competition || competition.deletedAt) throw new BadRequestException('Competition is not open for joining');
    return this.prisma.competitionParticipant.upsert({
      where: { competitionId_userId: { competitionId: id, userId: user.sub } },
      update: {},
      create: { competitionId: id, userId: user.sub },
    });
  }

  async leaderboard(id: string) {
    const competition = await this.prisma.competition.findFirst({
      where: { id, deletedAt: null, status: { not: CompetitionStatus.DRAFT } },
      include: {
        problems: { where: { problem: { deletedAt: null } }, include: { problem: { select: { maxScore: true } } } },
        participants: {
          where: { user: { isActive: true, deletedAt: null } },
          include: {
            user: { select: { id: true, displayName: true, avatarUrl: true } },
          },
        },
        submissions: {
          where: { status: { in: JUDGED_STATUSES }, scoreResetAt: null, problem: { deletedAt: null } },
          select: { userId: true, problemId: true, score: true, executionTimeMs: true, memoryUsedKb: true, submittedAt: true },
        },
      },
    });
    if (!competition || competition.deletedAt) throw new NotFoundException('Competition not found');
    const problemMap = new Map(competition.problems.map((item) => [item.problemId, item]));
    const entries = competition.participants.map((participant) => {
      const bestByProblem = new Map<string, (typeof competition.submissions)[number]>();
      for (const submission of competition.submissions) {
        if (submission.userId !== participant.userId) continue;
        const current = bestByProblem.get(submission.problemId);
        if (!current || isBetterSubmission(submission, current)) bestByProblem.set(submission.problemId, submission);
      }
      let totalScore = 0;
      let executionTimeMs = 0;
      let memoryUsedKb = 0;
      let solvedCount = 0;
      let latestBestAt = competition.startsAt;
      for (const [problemId, submission] of bestByProblem) {
        const config = problemMap.get(problemId);
        if (!config) continue;
        const max = Number(config.problem.maxScore);
        totalScore += max ? (Number(submission.score) / max) * Number(config.score) : 0;
        executionTimeMs += submission.executionTimeMs ?? Number.MAX_SAFE_INTEGER / 1000;
        memoryUsedKb += submission.memoryUsedKb ?? Number.MAX_SAFE_INTEGER / 1000;
        if (Number(submission.score) >= max) solvedCount += 1;
        if (submission.submittedAt > latestBestAt) latestBestAt = submission.submittedAt;
      }
      return {
        userId: participant.user.id,
        displayName: participant.user.displayName,
        avatarUrl: participant.user.avatarUrl,
        totalScore: Number(totalScore.toFixed(2)),
        completionTimeMs: bestByProblem.size ? latestBestAt.getTime() - competition.startsAt.getTime() : Number.MAX_SAFE_INTEGER,
        executionTimeMs: bestByProblem.size ? Math.round(executionTimeMs) : Number.MAX_SAFE_INTEGER,
        memoryUsedKb: bestByProblem.size ? Math.round(memoryUsedKb) : Number.MAX_SAFE_INTEGER,
        solvedCount,
      };
    });
    return { competitionId: id, generatedAt: new Date(), entries: rankLeaderboard(entries) };
  }
}

type ComparableSubmission = { score: unknown; executionTimeMs: number | null; memoryUsedKb: number | null; submittedAt: Date };

function isBetterSubmission(next: ComparableSubmission, current: ComparableSubmission) {
  return Number(next.score) > Number(current.score) ||
    (Number(next.score) === Number(current.score) &&
      ((next.executionTimeMs ?? Number.MAX_SAFE_INTEGER) < (current.executionTimeMs ?? Number.MAX_SAFE_INTEGER) ||
        ((next.executionTimeMs ?? Number.MAX_SAFE_INTEGER) === (current.executionTimeMs ?? Number.MAX_SAFE_INTEGER) &&
          ((next.memoryUsedKb ?? Number.MAX_SAFE_INTEGER) < (current.memoryUsedKb ?? Number.MAX_SAFE_INTEGER) ||
            ((next.memoryUsedKb ?? Number.MAX_SAFE_INTEGER) === (current.memoryUsedKb ?? Number.MAX_SAFE_INTEGER) &&
              next.submittedAt < current.submittedAt)))));
}
