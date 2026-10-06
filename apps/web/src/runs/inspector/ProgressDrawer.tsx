import type { RunEvent } from '@graphgoblin/contracts';
import { Disclosure } from '../../components/ui/index.js';
import { prettyJson } from '../../lib/utils.js';
import { describeEvent, nodeActivity } from '../projections.js';

/** Per node: harness progress, sessions, usage, decisions, and heartbeats as they arrive. */
export function ProgressDrawer({ events }: { events: RunEvent[] }) {
  const activity = nodeActivity(events);
  return (
    <Disclosure
      label={<span className="font-semibold">Node progress ({activity.size} nodes)</span>}
      variant="row"
      className="rounded-lg border border-default bg-surface-raised px-5 py-4 shadow-1"
    >
      {[...activity.entries()].map(([nodeId, items]) => (
        <div key={nodeId} className="grid gap-1">
          <h3 className="font-mono text-xs font-semibold">{nodeId}</h3>
          <ul className="grid gap-0.5 text-xs text-muted">
            {items.map((e) => (
              <li key={e.seq} className="break-words">
                <code className="text-default">{e.type}</code>{' '}
                {prettyJson(
                  'progress' in e ? e.progress : 'usage' in e ? e.usage : describeEvent(e),
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Disclosure>
  );
}
