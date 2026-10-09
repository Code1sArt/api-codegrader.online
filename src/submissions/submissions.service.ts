import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma, CompetitionStatus, Language, ProblemStatus, SubmissionStatus, UserRole } from '@prisma/client';
import type { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { PistonRunnerService } from '../runner/piston-runner.service';
import { scoreSubtasks, type JudgedTest } from './subtask-scoring';
import { CreateSubmissionDto } from './dto/create-submission.dto';

@Injectable()
export class SubmissionsService implements OnModuleInit {
  private readonly processing = new Set<string>();

  constructor(private readonly prisma: PrismaService, private readonly runner: PistonRunnerService) {}

  async onModuleInit() {
    const stale = await this.prisma.submission.findMany({
      where: { status: { in: [SubmissionStatus.QUEUED, SubmissionStatus.JUDGING] } },
      select: { id: true },
    });
    if (stale.length) {
      await this.prisma.submission.updateMany({ where: { id: { in: stale.map((item) => item.id) } }, data: { status: SubmissionStatus.QUEUED } });
      stale.forEach((item) => void this.judge(item.id));
    }
  }

  async submit(user: AuthUser, dto: CreateSubmissionDto) {
    const problem = await this.prisma.problem.findFirst({
      where: { id: dto.problemId, status: ProblemStatus.PUBLISHED },
      include: { testCases: { select: { id: true } } },
    });
    if (!problem) throw new NotFoundException('Published problem not found');
    const allowed = problem.allowedLanguages as Language[];
    if (!allowed.includes(dto.language)) throw new BadRequestException('Language is not allowed for this problem');
    if (!problem.testCases.length) throw new BadRequestException('Problem has no test cases');

    if (dto.competitionId) await this.assertCompetitionEntry(user.sub, dto.competitionId, problem.id);
    const submission = await this.prisma.submission.create({
      data: {
        userId: user.sub,
        problemId: problem.id,
        competitionId: dto.competitionId,
        language: dto.language,
        sourceCode: dto.sourceCode,
        totalCount: problem.testCases.length,
      },
      select: { id: true, status: true, submittedAt: true },
    });
    void this.judge(submission.id);
    return submission;
  }

  async listMine(user: AuthUser) {
    const rows = await this.prisma.submission.findMany({
      where: { userId: user.sub },
      select: {
        id: true, language: true, status: true, score: true, passedCount: true, totalCount: true,
        executionTimeMs: true, memoryUsedKb: true, submittedAt: true, judgedAt: true,
        problem: { select: { id: true, slug: true, title: true, maxScore: true } },
        competitionId: true, scoreResetAt: true,
      },
      orderBy: { submittedAt: 'desc' },
      take: 100,
    });
    return rows.map(effectiveScore);
  }

  async problemSummaries(userId?: string) {
    const where = userId ? { userId } : {};
    const [counts, scores] = await Promise.all([
      this.prisma.submission.groupBy({ by: ['problemId', 'userId'], where, _count: { _all: true }, _max: { submittedAt: true } }),
      this.prisma.submission.groupBy({ by: ['problemId'], where: { ...where, scoreResetAt: null }, _max: { score: true } }),
    ]);
    const problems = await this.prisma.problem.findMany({ where: { id: { in: [...new Set(counts.map(row => row.problemId))] } }, select: problemInfo });
    return problems.map(problem => {
      const rows = counts.filter(row => row.problemId === problem.id);
      return { problem, submissionCount: rows.reduce((sum, row) => sum + row._count._all, 0), userCount: rows.length,
        bestScore: Number(scores.find(row => row.problemId === problem.id)?._max.score ?? 0),
        lastSubmittedAt: rows.reduce((latest, row) => row._max.submittedAt && row._max.submittedAt > latest ? row._max.submittedAt : latest, new Date(0)) };
    }).sort((a, b) => b.lastSubmittedAt.getTime() - a.lastSubmittedAt.getTime());
  }

  async respondents(problemId: string) {
    const problem = await this.prisma.problem.findUnique({ where: { id: problemId }, select: problemInfo });
    if (!problem) throw new NotFoundException('Problem not found');
    const [counts, scores] = await Promise.all([
      this.prisma.submission.groupBy({ by: ['userId'], where: { problemId }, _count: { _all: true }, _max: { submittedAt: true } }),
      this.prisma.submission.groupBy({ by: ['userId'], where: { problemId, scoreResetAt: null }, _max: { score: true } }),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: counts.map(row => row.userId) } }, select: { id: true, displayName: true, avatarUrl: true } });
    const respondents = users.map(user => ({ user, submissionCount: counts.find(row => row.userId === user.id)!._count._all,
      lastSubmittedAt: counts.find(row => row.userId === user.id)!._max.submittedAt,
      bestScore: Number(scores.find(row => row.userId === user.id)?._max.score ?? 0) }));
    respondents.sort((a, b) => b.bestScore - a.bestScore || a.user.displayName.localeCompare(b.user.displayName) || a.user.id.localeCompare(b.user.id));
    return { problem, respondents };
  }

  async history(problemId: string, userId: string, page = 1) {
    const problem = await this.prisma.problem.findUnique({ where: { id: problemId }, select: problemInfo });
    if (!problem) throw new NotFoundException('Problem not found');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, displayName: true, avatarUrl: true } });
    if (!user) throw new NotFoundException('User not found');
    const where = { problemId, userId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.submission.count({ where }),
      this.prisma.submission.findMany({ where, select: { id: true, language: true, status: true, score: true, scoreResetAt: true,
        passedCount: true, totalCount: true, executionTimeMs: true, memoryUsedKb: true, submittedAt: true, judgedAt: true, competitionId: true, problem: { select: problemInfo } },
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 50, take: 50 }),
    ]);
    return { problem, user, items: rows.map(effectiveScore), total, page, pageSize: 50 };
  }

  async resetScores(problemId: string, userId?: string) {
    if (!await this.prisma.problem.count({ where: { id: problemId } })) throw new NotFoundException('Problem not found');
    const result = await this.prisma.submission.updateMany({ where: { problemId, ...(userId ? { userId } : {}), scoreResetAt: null }, data: { scoreResetAt: new Date() } });
    return { resetCount: result.count };
  }

  async get(user: AuthUser, id: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id },
      include: {
        problem: { select: { id: true, slug: true, title: true, maxScore: true } },
        results: { include: { testCase: { select: { name: true, position: true, isSample: true, subtaskId: true } } }, orderBy: { testCase: { position: 'asc' } } },
      },
    });
    if (!submission) throw new NotFoundException('Submission not found');
    if (submission.userId !== user.sub && user.role !== UserRole.ADMIN) throw new ForbiddenException();
    return {
      ...effectiveScore(submission),
      subtaskResults: submission.scoreResetAt && Array.isArray(submission.subtaskResults)
        ? submission.subtaskResults.map(group => group && typeof group === 'object' && !Array.isArray(group) ? { ...group, score: 0 } : group) : submission.subtaskResults,
      results: submission.results.map((result) => ({
        id: result.id,
        subtaskId: result.testCase.subtaskId,
        name: result.testCase.isSample ? result.testCase.name : `Test ${result.testCase.position}`,
        status: result.status,
        score: submission.scoreResetAt ? 0 : result.score,
        executionTimeMs: result.executionTimeMs,
        memoryUsedKb: result.memoryUsedKb,
        ...(user.role === UserRole.ADMIN || result.testCase.isSample
          ? { actualOutput: result.actualOutput, errorOutput: result.errorOutput }
          : {}),
      })),
    };
  }

  private async assertCompetitionEntry(userId: string, competitionId: string, problemId: string) {
    const now = new Date();
    const competition = await this.prisma.competition.findFirst({
      where: {
        id: competitionId,
        status: CompetitionStatus.PUBLISHED,
        startsAt: { lte: now },
        endsAt: { gte: now },
        participants: { some: { userId } },
        problems: { some: { problemId } },
      },
    });
    if (!competition) throw new BadRequestException('Competition is inactive, not joined, or does not contain this problem');
  }

  private async judge(id: string) {
    if (this.processing.has(id)) return;
    this.processing.add(id);
    try {
      const submission = await this.prisma.submission.update({
        where: { id }, data: { status: SubmissionStatus.JUDGING, systemMessage: null, score: 0, passedCount: 0, subtaskResults: Prisma.DbNull },
        include: { problem: { include: { subtasks: { orderBy: { position: 'asc' } }, testCases: { orderBy: { position: 'asc' } } } } },
      });
      await this.prisma.submissionResult.deleteMany({ where: { submissionId: id } });
      const judgedTests: JudgedTest[] = [];
      let passedCount = 0;
      let totalTime = 0;
      let maxMemory = 0;
      let finalStatus: SubmissionStatus = SubmissionStatus.ACCEPTED;
      let compilerOutput = '';
      const failedGroups = new Set<string>();
      const systemMessages: string[] = [];
      const groupOrder = new Map(submission.problem.subtasks.map((group, index) => [group.id, index]));
      const orderedTests = [...submission.problem.testCases].sort((a, b) =>
        (groupOrder.get(a.subtaskId ?? '') ?? groupOrder.size) - (groupOrder.get(b.subtaskId ?? '') ?? groupOrder.size));

      for (const testCase of orderedTests) {
        if (testCase.subtaskId && failedGroups.has(testCase.subtaskId)) continue;
        let run: Omit<Awaited<ReturnType<PistonRunnerService['execute']>>, 'status'> & { status: SubmissionStatus };
        try {
          run = await this.runner.execute(
            submission.language,
            submission.sourceCode,
            testCase.input,
            submission.problem.timeLimitMs,
            submission.problem.memoryLimitMb,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown runner error';
          systemMessages.push(message);
          run = { status: SubmissionStatus.SYSTEM_ERROR, stdout: '', stderr: '', compilerOutput: '', message, executionTimeMs: null, memoryUsedKb: null };
        }
        let resultStatus: SubmissionStatus = run.status;
        if (resultStatus === SubmissionStatus.ACCEPTED && normalizeOutput(run.stdout) !== normalizeOutput(testCase.expectedOutput)) {
          resultStatus = SubmissionStatus.WRONG_ANSWER;
        }
        const passed = resultStatus === SubmissionStatus.ACCEPTED;
        if (passed) passedCount += 1;
        judgedTests.push({ testCaseId: testCase.id, status: resultStatus, executionTimeMs: run.executionTimeMs, memoryUsedKb: run.memoryUsedKb });
        totalTime += run.executionTimeMs ?? 0;
        maxMemory = Math.max(maxMemory, run.memoryUsedKb ?? 0);
        compilerOutput ||= run.compilerOutput;
        await this.prisma.submissionResult.create({
          data: {
            submissionId: id,
            testCaseId: testCase.id,
            status: resultStatus,
            score: passed && !testCase.subtaskId ? testCase.score : 0,
            executionTimeMs: run.executionTimeMs,
            memoryUsedKb: run.memoryUsedKb,
            actualOutput: run.stdout,
            errorOutput: run.stderr || run.message || null,
          },
        });
        if (resultStatus === SubmissionStatus.COMPILE_ERROR) {
          finalStatus = resultStatus;
          break;
        }
        if (!passed && testCase.subtaskId) failedGroups.add(testCase.subtaskId);
        if (!passed && finalStatus === SubmissionStatus.ACCEPTED) finalStatus = resultStatus;
      }
      const { score, subtaskResults } = scoreSubtasks(submission.problem.testCases, submission.problem.subtasks, judgedTests, finalStatus);
      if (passedCount === submission.problem.testCases.length) finalStatus = SubmissionStatus.ACCEPTED;
      else if (score > 0) finalStatus = SubmissionStatus.PARTIAL;
      if (systemMessages.length) finalStatus = SubmissionStatus.SYSTEM_ERROR;
      await this.prisma.submission.update({
        where: { id },
        data: {
          status: finalStatus, score, passedCount, subtaskResults,
          systemMessage: systemMessages.length ? [...new Set(systemMessages)].join("\n").slice(0, 2000) : null,
          executionTimeMs: judgedTests.length && judgedTests.every((run) => run.executionTimeMs !== null) ? totalTime : null,
          memoryUsedKb: judgedTests.length && judgedTests.every((run) => run.memoryUsedKb !== null) ? maxMemory : null,
          compilerOutput: compilerOutput || null,
          judgedAt: new Date(),
        },
      });
    } catch (error) {
      await this.prisma.submission.update({
        where: { id },
        data: {
          status: SubmissionStatus.SYSTEM_ERROR,
          systemMessage: error instanceof Error ? error.message.slice(0, 2000) : 'Unknown judge error',
          judgedAt: new Date(),
        },
      }).catch(() => undefined);
    } finally {
      this.processing.delete(id);
    }
  }
}

export function normalizeOutput(value: string) {
  return value.replace(/\r\n/g, '\n').split('\n').map((line) => line.trimEnd()).join('\n').trim();
}

const problemInfo = { id: true, slug: true, title: true, maxScore: true } as const;
function effectiveScore<T extends { score: unknown; scoreResetAt: Date | null }>(submission: T) {
  return { ...submission, score: submission.scoreResetAt ? 0 : submission.score };
}
