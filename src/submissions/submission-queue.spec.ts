import { ConfigService } from '@nestjs/config';
import { Prisma, ProblemStatus, Language, SubmissionStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from '../members/usage.service';
import { PistonRunnerService } from '../runner/piston-runner.service';
import { SubmissionsService } from './submissions.service';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

describe('classroom submission queue', () => {
  function setup() {
    let sequence = 0;
    const prisma = {
      problem: { findFirst: jest.fn().mockResolvedValue({ id: 'p', status: ProblemStatus.PUBLISHED, allowedLanguages: [Language.PYTHON], testCases: [{ id: 't' }] }) },
      submission: {
        create: jest.fn().mockImplementation(() => Promise.resolve({ id: `s${++sequence}`, status: SubmissionStatus.QUEUED, submittedAt: new Date() })),
        findMany: jest.fn().mockResolvedValue(Array.from({ length: 40 }, (_, i) => ({ id: `s${i + 1}` }))),
        updateMany: jest.fn<Promise<unknown>, [Prisma.SubmissionUpdateManyArgs]>().mockResolvedValue({ count: 40 }),
      },
    };
    const service = new SubmissionsService(prisma as unknown as PrismaService, {} as PistonRunnerService,
      { record: jest.fn().mockResolvedValue(undefined) } as unknown as UsageService);
    const finish: Array<() => void> = [];
    const started: string[] = [];
    const judge = jest.spyOn(service as unknown as { judge(id: string): Promise<void> }, 'judge')
      .mockImplementation(id => new Promise<void>(resolve => { started.push(id); finish.push(resolve); }));
    return { prisma, service, judge, finish, started };
  }

  it('accepts 40 simultaneous submissions without waiting for judging, then drains in FIFO order', async () => {
    const { service, judge, finish, started } = setup();
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => service.submit(
      { sub: `student${i}`, email: `${i}@test.local`, role: UserRole.USER },
      { problemId: 'p', language: Language.PYTHON, sourceCode: 'print(1)' },
    )));
    expect(results).toHaveLength(40);
    expect(results.every(result => result.status === SubmissionStatus.QUEUED)).toBe(true);
    expect(judge).toHaveBeenCalledTimes(2);
    for (let wave = 0; wave < 20; wave++) {
      expect(finish).toHaveLength(2);
      finish.splice(0).forEach(resolve => resolve());
      await flush();
    }
    expect(started).toEqual(results.map(result => result.id));
    expect(finish).toHaveLength(0);
  });

  it('recovers 40 saved jobs after restart without starting all jobs at once', async () => {
    const { service, prisma, judge, finish } = setup();
    await service.onModuleInit();
    expect(prisma.submission.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: SubmissionStatus.QUEUED } }));
    expect(judge).toHaveBeenCalledTimes(2);
    // Repeated recovery does not schedule the same active or waiting job twice.
    await service.onModuleInit();
    for (let wave = 0; wave < 20; wave++) {
      finish.splice(0).forEach(resolve => resolve());
      await flush();
    }
    expect(judge).toHaveBeenCalledTimes(40);
  });

  it('frees a worker after a failed job and respects configured concurrency', async () => {
    const config = { get: () => '1' } as unknown as ConfigService;
    const service = new SubmissionsService({} as PrismaService, {} as PistonRunnerService, {} as UsageService, config);
    const judge = jest.spyOn(service as unknown as { judge(id: string): Promise<void> }, 'judge')
      .mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValue(undefined);
    service['enqueue']('failed');
    service['enqueue']('next');
    expect(judge).toHaveBeenCalledTimes(1);
    await flush();
    expect(judge.mock.calls.map(([id]) => id)).toEqual(['failed', 'next']);
  });
});
