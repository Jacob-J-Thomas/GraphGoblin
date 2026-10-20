import type { JsonValue } from '@graphgoblin/contracts';

/** Validate untrusted JSON without consuming the call stack on deeply nested probe output. */
export function isJsonValue(input: unknown): input is JsonValue {
  type Frame = { kind: 'value'; value: unknown } | { kind: 'leave'; value: object };
  const stack: Frame[] = [{ kind: 'value', value: input }];
  const ancestors = new WeakSet<object>();
  while (stack.length) {
    const frame = stack.pop()!;
    if (frame.kind === 'leave') {
      ancestors.delete(frame.value);
      continue;
    }
    const value = frame.value;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') continue;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return false;
      continue;
    }
    if (typeof value !== 'object') return false;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;
    if (ancestors.has(value)) return false;
    ancestors.add(value);
    stack.push({ kind: 'leave', value });
    const children: unknown[] = Array.isArray(value) ? value : Object.values(value);
    for (const child of children) stack.push({ kind: 'value', value: child });
  }
  return true;
}
