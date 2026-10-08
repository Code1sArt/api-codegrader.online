import { Prisma, ProblemStatus as P, UserRole } from '@prisma/client';
import { ProblemsService } from './problems.service';
import { PrismaService } from '../prisma/prisma.service';

function setup() {
  const problem = { id: 'p1', status: P.DRAFT as P, maxScore: 100, subtasks: [{ id: 'g1', score: 100 }], testCases: [{ id: 't1', subtaskId: 'g1', score: 999 }] };
  const prisma = {
    problem: { findUnique: jest.fn().mockResolvedValue(problem), findFirst: jest.fn<Promise<unknown>, [Prisma.ProblemFindFirstArgs]>().mockResolvedValue(problem), update: jest.fn() },
    submission: { count: jest.fn().mockResolvedValue(0) },
    subtask: { findFirst: jest.fn().mockResolvedValue({ id: 'g1', problemId: 'p1' }), count: jest.fn().mockResolvedValue(1), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    testCase: { count: jest.fn().mockResolvedValue(1), findFirst: jest.fn().mockResolvedValue(problem.testCases[0]), update: jest.fn(), create: jest.fn() },
  };
  return { problem, prisma, service: new ProblemsService(prisma as unknown as PrismaService) };
}
const dto = { name: 'Small', score: 20, position: 1 };
describe('subtask configuration', () => {
  it('counts group scores once rather than summing member test scores when publishing', async () => {
    const { service, prisma } = setup();
    await service.setStatus('p1', P.PUBLISHED);
    expect(prisma.problem.update).toHaveBeenCalled();
  });
  it('rejects empty groups and totals different from maximum score', async () => {
    const { service, prisma, problem } = setup();
    problem.testCases = [];
    await expect(service.setStatus('p1', P.PUBLISHED)).rejects.toThrow('at least one test');
    problem.testCases = [{ id: 't1', subtaskId: 'other', score: 0 }];
    await expect(service.setStatus('p1', P.PUBLISHED)).rejects.toThrow('Every subtask');
    problem.testCases[0].subtaskId = 'g1';
    problem.subtasks[0].score = 20;
    await expect(service.setStatus('p1', P.PUBLISHED)).rejects.toThrow('must equal max score');
    expect(prisma.problem.update).not.toHaveBeenCalled();
  });
  it('rejects assigning a test to another problem subtask', async () => {
    const { service, prisma } = setup();
    prisma.subtask.findFirst.mockResolvedValue(null);
    await expect(service.assignTestCase('p1', 't1', { subtaskId: 'foreign', score: 0 })).rejects.toThrow('does not belong');
    expect(prisma.testCase.update).not.toHaveBeenCalled();
  });
  it('sets member test score to zero and allows a move back to individual scoring', async () => {
    const { service, prisma } = setup();
    await service.assignTestCase('p1', 't1', { subtaskId: 'g1', score: 50 });
    expect(prisma.testCase.update).toHaveBeenLastCalledWith({ where: { id: 't1' }, data: { subtaskId: 'g1', score: 0 } });
    await service.assignTestCase('p1', 't1', { subtaskId: '', score: 50 });
    expect(prisma.testCase.update).toHaveBeenLastCalledWith({ where: { id: 't1' }, data: { subtaskId: null, score: 50 } });
  });
  it('locks scoring on published problems and problems with previous submissions', async () => {
    const { service, prisma, problem } = setup();
    problem.status = P.PUBLISHED;
    await expect(service.saveSubtask('p1', dto)).rejects.toThrow('Close publishing');
    problem.status = P.DRAFT;
    prisma.submission.count.mockResolvedValue(1);
    await expect(service.saveSubtask('p1', dto)).rejects.toThrow('already has submissions');
    expect(prisma.subtask.create).not.toHaveBeenCalled();
  });
  it('prevents changing score limits after submissions on subtask problems', async () => {
    const { service, prisma } = setup();
    prisma.submission.count.mockResolvedValue(1);
    await expect(service.update('p1', { maxScore: 200 })).rejects.toThrow('already has submissions');
    expect(prisma.problem.update).not.toHaveBeenCalled();
  });
  it('prevents deleting a group with member tests', async () => {
    const { service, prisma } = setup();
    await expect(service.removeSubtask('p1', 'g1')).rejects.toThrow('Move or delete');
    expect(prisma.subtask.delete).not.toHaveBeenCalled();
  });
  it('exposes group descriptions to users without leaking hidden test input', async () => {
    const { service, prisma, problem } = setup();
    prisma.problem.findFirst.mockResolvedValue({ ...problem, testCases: [] });
    const result = await service.get({ sub: 'u1', role: UserRole.USER, email: 'u@example.test' }, 'p1');
    expect(result.subtasks).toEqual(problem.subtasks);
    expect(result.testCases).toEqual([]);
    expect(prisma.problem.findFirst.mock.calls[0][0]).toMatchObject({ include: { testCases: { where: { isSample: true } } } });
  });
});
