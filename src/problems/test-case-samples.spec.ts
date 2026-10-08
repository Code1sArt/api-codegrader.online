import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { SetTestCaseSamplesDto } from './dto/problem.dto';
import { validate } from 'class-validator';
import { ProblemsService } from './problems.service';
import { PrismaService } from '../prisma/prisma.service';

function setup() {
  const tx = { testCase: {
    count: jest.fn().mockResolvedValue(2),
    updateMany: jest.fn<Promise<{ count: number }>, [Prisma.TestCaseUpdateManyArgs]>().mockResolvedValue({ count: 2 }),
  } };
  const prisma = {
    problem: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', status: 'PUBLISHED' }) },
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  return { tx, service: new ProblemsService(prisma as unknown as PrismaService) };
}
describe('bulk test visibility', () => {
  it('updates only isSample for selected tests, including published problems', async () => {
    const { service, tx } = setup();
    expect(await service.setTestCaseSamples('p1', { testCaseIds: ['t1', 't2'], isSample: true })).toEqual({ count: 2, isSample: true });
    expect(tx.testCase.updateMany.mock.calls[0][0]).toEqual({ where: { problemId: 'p1', id: { in: ['t1', 't2'] } }, data: { isSample: true } });
    await service.setTestCaseSamples('p1', { testCaseIds: ['t1', 't2'], isSample: false });
    expect(tx.testCase.updateMany.mock.calls[1][0].data).toEqual({ isSample: false });
  });
  it('rejects foreign or missing tests before changing any visibility', async () => {
    const { service, tx } = setup();
    tx.testCase.count.mockResolvedValue(1);
    await expect(service.setTestCaseSamples('p1', { testCaseIds: ['t1', 'foreign'], isSample: true })).rejects.toThrow('ไม่อยู่ในโจทย์นี้');
    expect(tx.testCase.updateMany).not.toHaveBeenCalled();
  });
  it('fails the transaction if the selected set changes during the update', async () => {
    const { service, tx } = setup();
    tx.testCase.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.setTestCaseSamples('p1', { testCaseIds: ['t1', 't2'], isSample: true })).rejects.toThrow('รายการเทสเปลี่ยนแปลง');
  });
  it('requires unique, nonempty test IDs and an actual boolean', async () => {
    for (const payload of [ { testCaseIds: [], isSample: true }, { testCaseIds: ['t1', 't1'], isSample: true }, { testCaseIds: [''], isSample: true }, { testCaseIds: ['t1'], isSample: 'false' } ]) {
      expect((await validate(Object.assign(new SetTestCaseSamplesDto(), payload))).length).toBeGreaterThan(0);
    }
  });
});
