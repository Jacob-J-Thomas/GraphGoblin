import type { RunEvent } from '@graphgoblin/contracts';
import { Icon } from '../../components/icons/index.js';
import { prettyJson } from '../../lib/utils.js';
import { describeEvent, nodeActivity } from '../projections.js';

/** Per node: harness progress, sessions, usage, decisions, and heartbeats as they arrive. */
export function ProgressDrawer({ events }: { events: RunEvent[] }) {
  const activity = nodeActivity(events);
  return (
    <details className="group min-w-0 rounded-lg border border-default bg-surface-raised px-5 py-4 shadow-1">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-sm font-semibold [&::-webkit-details-marker]:hidden">
        <Icon
          name="chevron"
          className="-rotate-90 text-muted transition-transform group-open:rotate-0"
        />
        Node progress ({activity.size} nodes)
      </summary>
      {[...activity.entries()].map(([nodeId, items]) => (
        <div key={nodeId} className="mt-3 grid gap-1">
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
    </details>
  );
}
