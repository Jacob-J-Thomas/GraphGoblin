import type { RunSnapshot } from '@graphgoblin/api-client';
export function provenance(run: RunSnapshot) {
  const script = run.failure?.script;
  const visitId: string | undefined = script?.visitId;
  const dispatchId: string | undefined = script?.dispatchId;
  const exitCode: number | undefined = script?.exitCode;
  const state: 'definitely-not-started' | 'outcome-uncertain' | 'completed' | undefined =
    script?.state;
  return { visitId, dispatchId, exitCode, state };
}
