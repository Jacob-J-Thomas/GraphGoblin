import { humanize } from '../forms/introspect.js';

export const POLL_FIELD_LABELS = {
  dedupeKey: 'Whole-probe dedupe key (single-result only)',
  'items.dedupeKey': 'Per-item dedupe key',
};

/** Use the same field captions as the editor, with group names and one-based row numbers. */
export function triggerFieldLabel(config: unknown, path: string): string {
  if (
    typeof config === 'object' &&
    config !== null &&
    'type' in config &&
    config.type === 'poll' &&
    Object.hasOwn(POLL_FIELD_LABELS, path)
  )
    return POLL_FIELD_LABELS[path as keyof typeof POLL_FIELD_LABELS];
  return path
    .split('.')
    .map((part) => (/^\d+$/.test(part) ? String(Number(part) + 1) : humanize(part)))
    .join(' ');
}
