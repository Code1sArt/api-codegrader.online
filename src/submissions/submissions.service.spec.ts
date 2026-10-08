import { normalizeOutput } from './submissions.service';

describe('normalizeOutput', () => {
  it('normalizes line endings and trailing whitespace', () => {
    expect(normalizeOutput('1  \r\n2\r\n')).toBe('1\n2');
  });

  it('does not ignore meaningful spaces inside a line', () => {
    expect(normalizeOutput('hello  world')).not.toBe(normalizeOutput('hello world'));
  });
});

import { Prisma, Language, SubmissionStatus as S } from '@prisma/client';
import { SubmissionsService } from './submissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { PistonRunnerService } from '../runner/piston-runner.service';

function judgeSetup(statuses: S[]) {
  const problem = {
    timeLimitMs: 1000, memoryLimitMb: 128,
    subtasks: [
      { id: 'small', name: 'Small', description: 'n ≤ 100', score: 20, position: 1 },
      { id: 'large', name: 'Large', description: 'n ≤ 200000', score: 80, position: 2 },
    ],
    testCases: [
      { id: 's1', subtaskId: 'small', score: 0, input: 'small', expectedOutput: 'ok' },
      { id: 'l1', subtaskId: 'large', score: 0, input: 'large1', expectedOutput: 'ok' },
      { id: 'l2', subtaskId: 'large', score: 0, input: 'large2', expectedOutput: 'ok' },
    ],
  };
  const prisma = {
    submission: { update: jest.fn<Promise<unknown>, [Prisma.SubmissionUpdateArgs]>().mockResolvedValue({ language: Language.PYTHON, sourceCode: 'print("ok")', problem }) },
    submissionResult: { deleteMany: jest.fn(), create: jest.fn<Promise<unknown>, [Prisma.SubmissionResultCreateArgs]>() },
  };
  const runner = { execute: jest.fn() };
  statuses.forEach((status) => runner.execute.mockResolvedValueOnce({ status, stdout: 'ok', stderr: '', message: '', compilerOutput: '', executionTimeMs: 10, memoryUsedKb: 64 }));
  const service = new SubmissionsService(prisma as unknown as PrismaService, runner as unknown as PistonRunnerService);
  return { service, prisma, runner, problem };
}
describe('subtask judging integration', () => {
  it('continues after timeout and persists zero score for the incomplete group', async () => {
    const { service, prisma, runner } = judgeSetup([S.ACCEPTED, S.TIME_LIMIT_EXCEEDED, S.ACCEPTED]);
    await service['judge']('submission');
    expect(runner.execute).toHaveBeenCalledTimes(3);
    expect(prisma.submission.update.mock.calls.at(-1)?.[0]).toMatchObject({ data: { status: S.PARTIAL, score: 20, passedCount: 2, executionTimeMs: 30, memoryUsedKb: 64, subtaskResults: [{ score: 20, status: S.ACCEPTED }, { score: 0, status: S.TIME_LIMIT_EXCEEDED }] } });
    expect(prisma.submissionResult.create.mock.calls.every(([args]) => args.data.score === 0)).toBe(true);
  });
  it('grants full score when all groups pass and clears stale results before judging', async () => {
    const { service, prisma } = judgeSetup([S.ACCEPTED, S.ACCEPTED, S.ACCEPTED]);
    await service['judge']('submission');
    expect(prisma.submissionResult.deleteMany).toHaveBeenCalledWith({ where: { submissionId: 'submission' } });
    expect(prisma.submission.update.mock.calls.at(-1)?.[0]).toMatchObject({ data: { status: S.ACCEPTED, score: 100, passedCount: 3 } });
  });
  it('stops compilation failures and still reports every subtask', async () => {
    const { service, prisma, runner } = judgeSetup([S.COMPILE_ERROR]);
    await service['judge']('submission');
    expect(runner.execute).toHaveBeenCalledTimes(1);
    expect(prisma.submission.update.mock.calls.at(-1)?.[0]).toMatchObject({ data: { status: S.COMPILE_ERROR, score: 0, subtaskResults: [{ status: S.COMPILE_ERROR, score: 0 }, { status: S.COMPILE_ERROR, score: 0 }] } });
  });
  it('records runner outages as system errors rather than awarding group scores', async () => {
    const { service, prisma, runner } = judgeSetup([]);
    runner.execute.mockRejectedValue(new Error('runner offline'));
    await service['judge']('submission');
    expect(prisma.submission.update.mock.calls.at(-1)?.[0]).toMatchObject({ data: { status: S.SYSTEM_ERROR, systemMessage: 'runner offline' } });
  });
  it('retains individual test scoring for existing problems', async () => {
    const { service, prisma, problem } = judgeSetup([S.ACCEPTED, S.WRONG_ANSWER, S.ACCEPTED]);
    problem.subtasks = [];
    problem.testCases.forEach((test) => { test.subtaskId = ''; test.score = 10; });
    await service['judge']('submission');
    expect(prisma.submission.update.mock.calls.at(-1)?.[0]).toMatchObject({ data: { status: S.PARTIAL, score: 20, subtaskResults: [] } });
  });
});
