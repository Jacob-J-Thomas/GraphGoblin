import { COMMAND_PREVIEW_MAX, type RunEvent } from '@graphgoblin/contracts';
import { Disclosure } from '../../components/ui/index.js';
import { prettyJson } from '../../lib/utils.js';
import { describeEvent, nodeActivity } from '../projections.js';

function describeStatusProgress(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = (value as Record<string, unknown>)['item'];
  if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
  const progressItem = item as Record<string, unknown>;
  if (
    typeof progressItem['type'] !== 'string' ||
    (progressItem['status'] !== 'ok' &&
      progressItem['status'] !== 'failed' &&
      progressItem['status'] !== 'running')
  ) {
    return undefined;
  }

  const type = progressItem['type'];
  const label = progressItem['status'] === 'ok' ? 'succeeded' : progressItem['status'];
  const noun =
    type === 'command'
      ? 'Command'
      : type === 'tool-call'
        ? 'Tool call'
        : type === 'file-change'
          ? 'File change'
          : 'Harness item';
  let summary = typeof progressItem['summary'] === 'string' ? progressItem['summary'] : '';
  if (type === 'error') summary = 'Harness reported an error';
  if (type === 'tool-call') {
    const diagnostic = summary.indexOf(' failed: ');
    if (diagnostic >= 0) summary = summary.slice(0, diagnostic);
    else if (progressItem['status'] === 'failed' && summary.endsWith(' failed')) {
      summary = summary.slice(0, -' failed'.length);
    }
  }
  if (type === 'file-change') summary = summary.replace(/ \(failed\)$/, '');
  const preview =
    type === 'command' && typeof progressItem['commandPreview'] === 'string'
      ? progressItem['commandPreview'].slice(0, COMMAND_PREVIEW_MAX)
      : summary;
  const exitCode =
    type === 'command' &&
    typeof progressItem['exitCode'] === 'number' &&
    Number.isInteger(progressItem['exitCode'])
      ? ` (exit ${progressItem['exitCode']})`
      : '';
  return `${noun} ${label}${preview ? `: ${preview}` : ''}${exitCode}`;
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
                  ? (describeStatusProgress(e.progress) ?? prettyJson(e.progress))
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
