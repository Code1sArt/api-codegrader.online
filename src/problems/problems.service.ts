import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ProblemStatus, UserRole } from '@prisma/client';
import type { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProblemDto, UpdateProblemDto, UploadTestCaseDto } from './dto/problem.dto';

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
      include: { testCases: { where: user.role === UserRole.ADMIN ? {} : { isSample: true }, orderBy: { position: 'asc' } } },
    });
    if (!problem) throw new NotFoundException('Problem not found');
    if (user.role === UserRole.ADMIN) return problem;
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
    await this.ensureProblem(id);
    return this.prisma.problem.update({
      where: { id },
      data: { ...dto, allowedLanguages: dto.allowedLanguages ?? undefined },
    });
  }

  async setStatus(id: string, status: ProblemStatus) {
    const problem = await this.prisma.problem.findUnique({
      where: { id }, include: { testCases: { select: { score: true } } },
    });
    if (!problem) throw new NotFoundException('Problem not found');
    if (status === ProblemStatus.PUBLISHED) {
      if (!problem.testCases.length) throw new BadRequestException('Add at least one test case before publishing');
      const total = problem.testCases.reduce((sum, item) => sum + Number(item.score), 0);
      if (Math.abs(total - Number(problem.maxScore)) > 0.001) {
        throw new BadRequestException(`Test case scores (${total}) must equal max score (${Number(problem.maxScore)})`);
      }
    }
    return this.prisma.problem.update({ where: { id }, data: { status } });
  }

  async addTestCase(
    problemId: string,
    dto: UploadTestCaseDto,
    files: { inputFile?: Express.Multer.File[]; solutionFile?: Express.Multer.File[] },
  ) {
    await this.ensureProblem(problemId);
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
      data: { problemId, ...dto, input, expectedOutput },
    });
  }

  async removeTestCase(problemId: string, testCaseId: string) {
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
