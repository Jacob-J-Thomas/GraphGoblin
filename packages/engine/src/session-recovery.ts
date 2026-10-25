import type { RunRecord } from '@graphgoblin/contracts';
import type { EnginePorts } from './ports.js';

/** A parent's historical missing-session cause can be resolved by its own child's explicit recovery. */
export async function childSessionRecovered(ports: EnginePorts, run: RunRecord): Promise<boolean> {
  const details = run.failure?.details;
  if (
    run.failure?.code !== 'HARNESS_SESSION_MISSING' ||
    typeof details !== 'object' ||
    details === null ||
    Array.isArray(details) ||
    typeof details.childRunId !== 'string'
  )
    return false;
  const child = await ports.runs.get(details.childRunId);
  if (
    !child ||
    child.parentRunId !== run.id ||
    child.ownerId !== run.ownerId ||
    child.failure !== undefined
  )
    return false;
  const events = await ports.events.read(child.id);
  const failed = events.findLast(
    (event) => event.type === 'run.failed' && event.failure.code === 'HARNESS_SESSION_MISSING',
  );
  // A direct fresh-session choice or an explicitly resumed containing child is durable proof.
  // Plain Resume cannot produce either before the missing conversation has been dealt with.
  return (
    failed !== undefined &&
    events.some((event) => event.type === 'run.resumed' && event.seq > failed.seq)
  );
}
