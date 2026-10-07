import { SubmissionStatus } from '@prisma/client';

type Test = { id: string; subtaskId?: string | null; score: unknown };
type Group = { id: string; name: string; description: string | null; score: unknown; position: number };
export type JudgedTest = {
  testCaseId: string;
  status: SubmissionStatus;
  executionTimeMs: number | null;
  memoryUsedKb: number | null;
};

// Group scores are awarded once, only when every member has an accepted result.
// Missing results never count as passes. Test scores inside a group are ignored.
export function scoreSubtasks(tests: Test[], groups: Group[], results: JudgedTest[], stoppedStatus?: SubmissionStatus) {
  const byTest = new Map(results.map((result) => [result.testCaseId, result]));
  const subtaskResults = [...groups].sort((a, b) => a.position - b.position).map((group) => {
    const members = tests.filter((test) => test.subtaskId === group.id);
    const runs = members.map((test) => byTest.get(test.id));
    const passedCount = runs.filter((run) => run?.status === SubmissionStatus.ACCEPTED).length;
    const accepted = members.length > 0 && passedCount === members.length;
    const status = accepted ? SubmissionStatus.ACCEPTED
      : runs.find((run) => run && run.status !== SubmissionStatus.ACCEPTED)?.status
        ?? (stoppedStatus !== SubmissionStatus.ACCEPTED ? stoppedStatus : undefined) ?? SubmissionStatus.SYSTEM_ERROR;
    const executionTimeMs = runs.length && runs.every((run) => run?.executionTimeMs != null)
      ? runs.reduce((sum, run) => sum + run!.executionTimeMs!, 0) : null;
    const memoryUsedKb = runs.length && runs.every((run) => run?.memoryUsedKb != null)
      ? Math.max(...runs.map((run) => run!.memoryUsedKb!)) : null;
    return {
      subtaskId: group.id, name: group.name, description: group.description,
      maxScore: Number(group.score), score: accepted ? Number(group.score) : 0,
      status, passedCount, totalCount: members.length, executionTimeMs, memoryUsedKb,
    };
  });
  const individualScore = tests.filter((test) => !test.subtaskId).reduce((sum, test) =>
    sum + (byTest.get(test.id)?.status === SubmissionStatus.ACCEPTED ? Number(test.score) : 0), 0);
  return {
    score: Math.round((individualScore + subtaskResults.reduce((sum, group) => sum + group.score, 0)) * 100) / 100,
    subtaskResults,
  };
}
