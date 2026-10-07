import type { RunEvent } from '@graphgoblin/contracts';
import { Disclosure } from '../../components/ui/index.js';
import { prettyJson } from '../../lib/utils.js';
import { describeEvent, nodeActivity } from '../projections.js';

function describeCommandProgress(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = (value as Record<string, unknown>)['item'];
  if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
  const command = item as Record<string, unknown>;
  if (
    command['type'] !== 'command' ||
    (command['status'] !== 'ok' &&
      command['status'] !== 'failed' &&
      command['status'] !== 'running')
  ) {
    return undefined;
  }

  const label = command['status'] === 'ok' ? 'succeeded' : command['status'];
  const preview =
    typeof command['commandPreview'] === 'string' ? command['commandPreview'].slice(0, 160) : '';
  const exitCode =
    typeof command['exitCode'] === 'number' && Number.isInteger(command['exitCode'])
      ? ` (exit ${command['exitCode']})`
      : '';
  return `Command ${label}${preview ? `: ${preview}` : ''}${exitCode}`;
}

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
                {'progress' in e
                  ? (describeCommandProgress(e.progress) ?? prettyJson(e.progress))
                  : 'usage' in e
                    ? prettyJson(e.usage)
                    : prettyJson(describeEvent(e))}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Disclosure>
  );
}
