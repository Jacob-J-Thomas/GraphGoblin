import type { RunRecord } from '@graphgoblin/contracts';
import { Card } from '../../components/ui/index.js';

export function RunLimits({ run }: { run: RunRecord }) {
  const limits = run.pinned.limits;
  const deadline = limits.runDeadlineSeconds;
  return (
    <Card title="Execution limits">
      <p>
        Maximum node visits: {limits.maxNodeVisits ?? 'Unlimited'}. Run deadline:{' '}
        {deadline === null ? 'none' : `${deadline} seconds`}.
      </p>
      {deadline !== null && run.startedAt ? (
        <p>Deadline at: {new Date(Date.parse(run.startedAt) + deadline * 1000).toISOString()}</p>
      ) : null}
      <p>
        Limits are pinned for this run. Gate pass limits and node watchdogs follow its pinned
        definition.
      </p>
    </Card>
  );
}
