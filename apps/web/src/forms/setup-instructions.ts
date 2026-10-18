/** Presentation only. Validation and diagnostic messages retain the complete schema error. */
export function setupInstruction(value: unknown, path: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const config = value as Record<string, unknown>;
  const field = path
    .split('.')
    .reduce<unknown>(
      (current, key) =>
        current && typeof current === 'object'
          ? (current as Record<string, unknown>)[key]
          : undefined,
      value,
    );
  const empty = field === undefined || (typeof field === 'string' && field.trim() === '');
  if (!empty) return undefined;
  if (config['type'] === 'event' && path === 'eventType') return 'Enter an event type';
  if (config['kind'] !== 'classifier') return undefined;
  if (path === 'model') return 'Choose a classifier';
  if (path === 'question') return 'Enter a question for the classifier';
  if (/^answer\.(options\.\d+|true|false)\.criteria$/.test(path)) return 'Describe this option';
  if (/^answer\.anchors\.\d+$/.test(path)) return 'Describe this score anchor';
  if (/^answer\.bands\.\d+\.(min|max)$/.test(path)) return "Set each band's lower and upper bound";
  return undefined;
}
