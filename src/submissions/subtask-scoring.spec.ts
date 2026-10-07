import { SubmissionStatus as S } from '@prisma/client';
import { scoreSubtasks } from './subtask-scoring';

const groups = [
  { id: 'small', name: 'Small', description: 'n ≤ 100', score: 20, position: 1 },
  { id: 'large', name: 'Large', description: 'n ≤ 200000', score: 80, position: 2 },
];
const tests = [
  { id: 's1', subtaskId: 'small', score: 999 },
  { id: 's2', subtaskId: 'small', score: 999 },
  { id: 'l1', subtaskId: 'large', score: 999 },
  { id: 'l2', subtaskId: 'large', score: 999 },
];
const run = (testCaseId: string, status = S.ACCEPTED as S, executionTimeMs: number | null = 10, memoryUsedKb: number | null = 128) =>
  ({ testCaseId, status, executionTimeMs, memoryUsedKb });

describe('subtask scoring', () => {
  it('awards each group once only if every test passes', () => {
    const result = scoreSubtasks(tests, groups, [run('s1'), run('s2'), run('l1'), run('l2', S.WRONG_ANSWER)]);
    expect(result.score).toBe(20);
    expect(result.subtaskResults.map((group) => group.score)).toEqual([20, 0]);
    expect(result.subtaskResults[1]).toMatchObject({ status: S.WRONG_ANSWER, passedCount: 1, totalCount: 2 });
  });
  it('awards full score and aggregates total time and peak memory per group', () => {
    const result = scoreSubtasks(tests, groups, [run('s1', S.ACCEPTED, 0, 64), run('s2', S.ACCEPTED, 15, 128), run('l1'), run('l2')]);
    expect(result.score).toBe(100);
    expect(result.subtaskResults[0]).toMatchObject({ executionTimeMs: 15, memoryUsedKb: 128, status: S.ACCEPTED });
  });
  it('does not grant partial credit for missing tests or compile failures', () => {
    const result = scoreSubtasks(tests, groups, [run('s1', S.COMPILE_ERROR, null, null)], S.COMPILE_ERROR);
    expect(result.score).toBe(0);
    expect(result.subtaskResults.every((group) => group.status === S.COMPILE_ERROR && group.executionTimeMs === null)).toBe(true);
  });
  it('preserves legacy scoring and supports unscored samples', () => {
    expect(scoreSubtasks([{ id: 'a', score: 30 }, { id: 'b', score: 70 }, { id: 'sample', score: 0 }], [], [run('a'), run('b', S.WRONG_ANSWER), run('sample')])).toEqual({ score: 30, subtaskResults: [] });
  });
  it('supports mixed groups and individual tests without double counting', () => {
    const result = scoreSubtasks([...tests, { id: 'individual', score: 5 }], groups, [...tests.map((test) => run(test.id)), run('individual')]);
    expect(result.score).toBe(105);
  });
  it('does not invent measurements or accept an empty group', () => {
    const result = scoreSubtasks(tests, groups, [run('s1', S.ACCEPTED, null, null), run('s2')]);
    expect(result.subtaskResults[0]).toMatchObject({ score: 20, executionTimeMs: null, memoryUsedKb: null });
    expect(scoreSubtasks([], groups, []).subtaskResults[0]).toMatchObject({ score: 0, status: S.SYSTEM_ERROR });
  });
  it('retains fractional scores without floating point drift', () => {
    const result = scoreSubtasks([{ id: 'a', score: .1 }, { id: 'b', score: .2 }], [], [run('a'), run('b')]);
    expect(result.score).toBe(.3);
  });
});
