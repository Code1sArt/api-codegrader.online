import { Prisma, ProblemStatus } from '@prisma/client';
import { ProblemsService } from './problems.service';
import { PrismaService } from '../prisma/prisma.service';
import { testZip } from './test-zip.fixture';

function setup() {
  const tx = {
    problem: { update: jest.fn().mockResolvedValue({ status: ProblemStatus.DRAFT }) },
    submission: { count: jest.fn().mockResolvedValue(0) },
    subtask: { findFirst: jest.fn().mockResolvedValue({ id: 'g1' }) },
    testCase: { aggregate: jest.fn().mockResolvedValue({ _max: { position: 7 } }), createMany: jest.fn<Promise<{ count: number }>, [Prisma.TestCaseCreateManyArgs]>().mockResolvedValue({ count: 2 }) },
  };
  const prisma = {
    problem: { findUnique: jest.fn().mockResolvedValue({ status: ProblemStatus.DRAFT }) },
    submission: { count: jest.fn().mockResolvedValue(0) },
    subtask: { findFirst: jest.fn().mockResolvedValue({ id: 'g1' }) },
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const file = (buffer: Buffer) => ({ originalname: 'cases.zip', buffer } as Express.Multer.File);
  return { service: new ProblemsService(prisma as unknown as PrismaService), prisma, tx, file };
}
describe('bulk ZIP import', () => {
  it('creates all pairs in one transaction, continuing positions with zero individual scores', async () => {
    const { service, tx, file } = setup();
    const result = await service.addTestCaseZip('p1', { subtaskId: 'g1' }, file(testZip([['2.in', '2'], ['2.sol', '2'], ['1.in', '1'], ['1.sol', '1']])));
    expect(result).toEqual({ count: 2, subtaskId: 'g1', startPosition: 8 });
    expect(tx.testCase.createMany.mock.calls[0][0]).toEqual({ data: [
      { problemId: 'p1', subtaskId: 'g1', name: '1', input: '1', expectedOutput: '1', score: 0, isSample: false, position: 8 },
      { problemId: 'p1', subtaskId: 'g1', name: '2', input: '2', expectedOutput: '2', score: 0, isSample: false, position: 9 },
    ] });
  });
  it('does not open a write transaction for an incomplete archive', async () => {
    const { service, prisma, tx, file } = setup();
    await expect(service.addTestCaseZip('p1', { subtaskId: 'g1' }, file(testZip([['1.in', '1']])))).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.testCase.createMany).not.toHaveBeenCalled();
  });
  it('rejects foreign groups before parsing the archive', async () => {
    const { service, prisma, file } = setup();
    prisma.subtask.findFirst.mockResolvedValue(null);
    await expect(service.addTestCaseZip('p1', { subtaskId: 'other' }, file(testZip([])))).rejects.toThrow('does not belong');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('rechecks scoring locks inside the transaction', async () => {
    const { service, tx, file } = setup();
    tx.submission.count.mockResolvedValue(1);
    await expect(service.addTestCaseZip('p1', { subtaskId: 'g1' }, file(testZip([['1.in', '1'], ['1.sol', '1']])))).rejects.toThrow('ยังไม่มีคำตอบ');
    expect(tx.testCase.createMany).not.toHaveBeenCalled();
  });
});
