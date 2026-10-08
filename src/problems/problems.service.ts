import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ProblemStatus, UserRole } from '@prisma/client';
import type { AuthUser } from '../common/auth-user';
import { readTestCaseZip } from './test-case-zip';
import { PrismaService } from '../prisma/prisma.service';
import { UploadTestCaseZipDto, AssignTestCaseDto, SubtaskDto, CreateProblemDto, UpdateProblemDto, UploadTestCaseDto } from './dto/problem.dto';

@Injectable()
export class ProblemsService {
  constructor(private readonly prisma: PrismaService) {}

  list(user: AuthUser) {
    return this.prisma.problem.findMany({
      where: user.role === UserRole.ADMIN ? {} : { status: ProblemStatus.PUBLISHED },
      select: {
        id: true, slug: true, title: true, difficulty: true, allowedLanguages: true,
        timeLimitMs: true, memoryLimitMb: true, maxScore: true, status: true,
        _count: user.role === UserRole.ADMIN ? { select: { testCases: true, submissions: true } } : undefined,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(user: AuthUser, idOrSlug: string) {
    const problem = await this.prisma.problem.findFirst({
      where: {
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
        ...(user.role === UserRole.ADMIN ? {} : { status: ProblemStatus.PUBLISHED }),
      },
      include: { subtasks: { orderBy: { position: 'asc' } }, testCases: { where: user.role === UserRole.ADMIN ? {} : { isSample: true }, orderBy: { position: 'asc' } } },
    });
    if (!problem) throw new NotFoundException('Problem not found');
    if (user.role === UserRole.ADMIN) return {
      ...problem,
      scoringEditable: problem.status === ProblemStatus.DRAFT && !(await this.prisma.submission.count({ where: { problemId: problem.id } })),
    };
    return {
      ...problem,
      testCases: problem.testCases.map(({ id, name, input, expectedOutput, position }) => ({
        id, name, input, expectedOutput, position,
      })),
    };
  }

  create(user: AuthUser, dto: CreateProblemDto) {
    return this.prisma.problem.create({
      data: { ...dto, allowedLanguages: dto.allowedLanguages, createdById: user.sub },
    });
  }

  async update(id: string, dto: UpdateProblemDto) {
    const problem = await this.ensureProblem(id);
    const changesScoring = (dto.maxScore !== undefined && dto.maxScore !== Number(problem.maxScore))
      || (dto.timeLimitMs !== undefined && dto.timeLimitMs !== problem.timeLimitMs)
      || (dto.memoryLimitMb !== undefined && dto.memoryLimitMb !== problem.memoryLimitMb);
    if (changesScoring && await this.prisma.subtask.count({ where: { problemId: id } })) {
      await this.ensureScoringEditable(id, problem);
    }
    return this.prisma.problem.update({
      where: { id },
      data: { ...dto, allowedLanguages: dto.allowedLanguages ?? undefined },
    });
  }

  async setStatus(id: string, status: ProblemStatus) {
    const problem = await this.prisma.problem.findUnique({
      where: { id }, include: { subtasks: true, testCases: { select: { score: true, subtaskId: true } } },
    });
    if (!problem) throw new NotFoundException('Problem not found');
    if (status === ProblemStatus.PUBLISHED) {
      if (!problem.testCases.length) throw new BadRequestException('Add at least one test case before publishing');
      if (problem.subtasks.some((group) => !problem.testCases.some((test) => test.subtaskId === group.id))) {
        throw new BadRequestException('Every subtask must contain at least one test case');
      }
      const total = problem.subtasks.reduce((sum, group) => sum + Number(group.score), 0)
        + problem.testCases.filter((test) => !test.subtaskId).reduce((sum, item) => sum + Number(item.score), 0);
      if (Math.abs(total - Number(problem.maxScore)) > 0.001) {
        throw new BadRequestException(`Subtask and individual test scores (${total}) must equal max score (${Number(problem.maxScore)})`);
      }
    }
    return this.prisma.problem.update({ where: { id }, data: { status } });
  }

  async addTestCase(
    problemId: string,
    dto: UploadTestCaseDto,
    files: { inputFile?: Express.Multer.File[]; solutionFile?: Express.Multer.File[] },
  ) {
    const problem = await this.ensureProblem(problemId);
    const subtaskId = dto.subtaskId || null;
    if (subtaskId || await this.prisma.subtask.count({ where: { problemId } })) await this.ensureScoringEditable(problemId, problem);
    if (subtaskId) await this.ensureSubtask(problemId, subtaskId);
    const inputFile = files?.inputFile?.[0];
    const solutionFile = files?.solutionFile?.[0];
    if (!inputFile || !solutionFile) throw new BadRequestException('inputFile and solutionFile are required');
    if (!inputFile.originalname.toLowerCase().endsWith('.in')) {
      throw new BadRequestException('inputFile must use the .in extension');
    }
    if (!solutionFile.originalname.toLowerCase().endsWith('.sol')) {
      throw new BadRequestException('solutionFile must use the .sol extension');
    }
    const input = this.decodeUtf8(inputFile.buffer, 'inputFile');
    const expectedOutput = this.decodeUtf8(solutionFile.buffer, 'solutionFile');
    return this.prisma.testCase.create({
      data: { problemId, ...dto, subtaskId, score: subtaskId ? 0 : dto.score, input, expectedOutput },
    });
  }

  async addTestCaseZip(problemId: string, dto: UploadTestCaseZipDto, file?: Express.Multer.File) {
    await this.ensureScoringEditable(problemId);
    await this.ensureSubtask(problemId, dto.subtaskId);
    if (!file || !file.originalname.toLowerCase().endsWith('.zip')) throw new BadRequestException('แนบไฟล์ .zip ที่มีคู่ไฟล์ .in / .sol');
    const cases = await readTestCaseZip(file.buffer);
    // Validate the entire archive before writing, and serialize bulk imports on this problem.
    return this.prisma.$transaction(async (tx) => {
      const problem = await tx.problem.update({ where: { id: problemId }, data: { updatedAt: new Date() } });
      if (problem.status !== ProblemStatus.DRAFT || await tx.submission.count({ where: { problemId } })) {
        throw new BadRequestException('นำเข้า ZIP ได้เฉพาะโจทย์ฉบับร่างที่ยังไม่มีคำตอบ');
      }
      if (!await tx.subtask.findFirst({ where: { id: dto.subtaskId, problemId } })) throw new BadRequestException('Subtask does not belong to this problem');
      const previous = await tx.testCase.aggregate({ where: { problemId }, _max: { position: true } });
      const startPosition = (previous._max.position ?? 0) + 1;
      await tx.testCase.createMany({ data: cases.map((test, index) => ({ ...test, problemId, subtaskId: dto.subtaskId, position: startPosition + index, score: 0, isSample: false })) });
      return { count: cases.length, subtaskId: dto.subtaskId, startPosition };
    });
  }

  async saveSubtask(problemId: string, dto: SubtaskDto, subtaskId?: string) {
    await this.ensureScoringEditable(problemId);
    if (subtaskId) {
      await this.ensureSubtask(problemId, subtaskId);
      return this.prisma.subtask.update({ where: { id: subtaskId }, data: dto });
    }
    return this.prisma.subtask.create({ data: { problemId, ...dto } });
  }

  async removeSubtask(problemId: string, subtaskId: string) {
    await this.ensureScoringEditable(problemId);
    await this.ensureSubtask(problemId, subtaskId);
    if (await this.prisma.testCase.count({ where: { subtaskId } })) {
      throw new BadRequestException('Move or delete the test cases before deleting this subtask');
    }
    await this.prisma.subtask.delete({ where: { id: subtaskId } });
    return { deleted: true, id: subtaskId };
  }

  async assignTestCase(problemId: string, testCaseId: string, dto: AssignTestCaseDto) {
    await this.ensureScoringEditable(problemId);
    const testCase = await this.prisma.testCase.findFirst({ where: { id: testCaseId, problemId } });
    if (!testCase) throw new NotFoundException('Test case not found');
    const subtaskId = dto.subtaskId || null;
    if (subtaskId) await this.ensureSubtask(problemId, subtaskId);
    return this.prisma.testCase.update({ where: { id: testCaseId }, data: { subtaskId, score: subtaskId ? 0 : dto.score } });
  }

  private async ensureSubtask(problemId: string, subtaskId: string) {
    const group = await this.prisma.subtask.findFirst({ where: { id: subtaskId, problemId } });
    if (!group) throw new BadRequestException('Subtask does not belong to this problem');
    return group;
  }

  private async ensureScoringEditable(problemId: string, existing?: { status: ProblemStatus }) {
    const problem = existing ?? await this.ensureProblem(problemId);
    if (problem.status !== ProblemStatus.DRAFT) throw new BadRequestException('Close publishing before editing subtasks');
    if (await this.prisma.submission.count({ where: { problemId } })) {
      throw new BadRequestException('This problem already has submissions. Create a new problem to change subtask scoring');
    }
  }

  async removeTestCase(problemId: string, testCaseId: string) {
    if (await this.prisma.subtask.count({ where: { problemId } })) await this.ensureScoringEditable(problemId);
    const result = await this.prisma.testCase.deleteMany({ where: { id: testCaseId, problemId } });
    if (!result.count) throw new NotFoundException('Test case not found');
    return { deleted: true, id: testCaseId };
  }

  async remove(id: string) {
    await this.ensureProblem(id);
    const submissionCount = await this.prisma.submission.count({ where: { problemId: id } });
    if (submissionCount) throw new BadRequestException('Archive a problem that already has submissions');
    await this.prisma.problem.delete({ where: { id } });
    return { deleted: true, id };
  }

  private async ensureProblem(id: string) {
    const problem = await this.prisma.problem.findUnique({ where: { id } });
    if (!problem) throw new NotFoundException('Problem not found');
    return problem;
  }

  private decodeUtf8(buffer: Buffer, field: string) {
    const value = buffer.toString('utf8');
    if (value.includes('\uFFFD')) throw new BadRequestException(`${field} must be UTF-8 text`);
    return value.replace(/^\uFEFF/, '');
  }
}
