import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { CompetitionStatus, Language, ProblemStatus, SubmissionStatus, UserRole } from '@prisma/client';
import type { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { PistonRunnerService } from '../runner/piston-runner.service';
import { CreateSubmissionDto } from './dto/create-submission.dto';

const TERMINAL_FAILURES = new Set<SubmissionStatus>([
  SubmissionStatus.COMPILE_ERROR,
  SubmissionStatus.RUNTIME_ERROR,
  SubmissionStatus.TIME_LIMIT_EXCEEDED,
  SubmissionStatus.MEMORY_LIMIT_EXCEEDED,
]);

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

  listMine(user: AuthUser) {
    return this.prisma.submission.findMany({
      where: { userId: user.sub },
      select: {
        id: true, language: true, status: true, score: true, passedCount: true, totalCount: true,
        executionTimeMs: true, memoryUsedKb: true, submittedAt: true, judgedAt: true,
        problem: { select: { id: true, slug: true, title: true, maxScore: true } },
        competitionId: true,
      },
      orderBy: { submittedAt: 'desc' },
      take: 100,
    });
  }

  async get(user: AuthUser, id: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id },
      include: {
        problem: { select: { id: true, slug: true, title: true, maxScore: true } },
        results: { include: { testCase: { select: { name: true, position: true, isSample: true } } }, orderBy: { testCase: { position: 'asc' } } },
      },
    });
    if (!submission) throw new NotFoundException('Submission not found');
    if (submission.userId !== user.sub && user.role !== UserRole.ADMIN) throw new ForbiddenException();
    return {
      ...submission,
      results: submission.results.map((result) => ({
        id: result.id,
        name: result.testCase.isSample ? result.testCase.name : `Test ${result.testCase.position}`,
        status: result.status,
        score: result.score,
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
        where: { id }, data: { status: SubmissionStatus.JUDGING, systemMessage: null },
        include: { problem: { include: { testCases: { orderBy: { position: 'asc' } } } } },
      });
      let score = 0;
      let passedCount = 0;
      let totalTime = 0;
      let maxMemory = 0;
      let finalStatus: SubmissionStatus = SubmissionStatus.ACCEPTED;
      let compilerOutput = '';

      for (const testCase of submission.problem.testCases) {
        const run = await this.runner.execute(
          submission.language,
          submission.sourceCode,
          testCase.input,
          submission.problem.timeLimitMs,
          submission.problem.memoryLimitMb,
        );
        let resultStatus: SubmissionStatus = run.status;
        if (resultStatus === SubmissionStatus.ACCEPTED && normalizeOutput(run.stdout) !== normalizeOutput(testCase.expectedOutput)) {
          resultStatus = SubmissionStatus.WRONG_ANSWER;
        }
        const passed = resultStatus === SubmissionStatus.ACCEPTED;
        if (passed) { score += Number(testCase.score); passedCount += 1; }
        totalTime += run.executionTimeMs ?? 0;
        maxMemory = Math.max(maxMemory, run.memoryUsedKb ?? 0);
        compilerOutput ||= run.compilerOutput;
        await this.prisma.submissionResult.create({
          data: {
            submissionId: id,
            testCaseId: testCase.id,
            status: resultStatus,
            score: passed ? testCase.score : 0,
            executionTimeMs: run.executionTimeMs,
            memoryUsedKb: run.memoryUsedKb,
            actualOutput: run.stdout,
            errorOutput: run.stderr || run.message || null,
          },
        });
        if (TERMINAL_FAILURES.has(resultStatus)) {
          finalStatus = resultStatus;
          break;
        }
        if (!passed) finalStatus = SubmissionStatus.WRONG_ANSWER;
      }
      if (passedCount === submission.problem.testCases.length) finalStatus = SubmissionStatus.ACCEPTED;
      else if (score > 0) finalStatus = SubmissionStatus.PARTIAL;
      await this.prisma.submission.update({
        where: { id },
        data: {
          status: finalStatus, score, passedCount,
          executionTimeMs: totalTime || null,
          memoryUsedKb: maxMemory || null,
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
