import { GraphGoblinApiError, NETWORK_ERROR_STATUS } from '@graphgoblin/api-client';
import { clsx, type ClassValue } from 'clsx';

/** Join class names; falsy values are dropped. */
export function cn(...classes: ClassValue[]): string {
  return clsx(classes);
}

/** A short local date and time, or a dash when absent. */
export function formatDateTime(iso: string | undefined): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

/** Pretty JSON for display. `undefined` renders as an empty string. */
export function prettyJson(value: unknown): string {
  if (value === undefined) return '';
  return JSON.stringify(value, null, 2);
}

/** Thrown inside `prettyJsonPrefix` to stop the walk once the budget is spent; never escapes. */
const STOP = new Error('prettyJsonPrefix: budget spent');

/**
 * The first `limit` characters of `prettyJson(value)` and whether more would follow, produced
 * without formatting the whole value: the walk stops as soon as the budget is spent, so a
 * multi-megabyte variable costs only its first lines of work and memory (#259). The text is
 * exactly `prettyJson(value).slice(0, limit)`: the same key order, escaping, indentation and
 * treatment of `undefined`, functions, symbols, non-finite numbers and `toJSON` as `JSON.stringify`.
 */
export function prettyJsonPrefix(
  value: unknown,
  limit: number,
): { text: string; truncated: boolean } {
  if (value === undefined) return { text: '', truncated: false };
  const parts: string[] = [];
  let length = 0;
  const push = (part: string): void => {
    parts.push(part);
    length += part.length;
    if (length > limit) throw STOP;
  };
  const skipped = (item: unknown): boolean =>
    item === undefined || typeof item === 'function' || typeof item === 'symbol';
  const write = (item: unknown, indent: string): void => {
    if (
      item !== null &&
      typeof item === 'object' &&
      typeof (item as { toJSON?: unknown }).toJSON === 'function'
    ) {
      item = (item as { toJSON: () => unknown }).toJSON();
    }
    if (item === null || skipped(item)) return push('null');
    switch (typeof item) {
      case 'string':
        return push(JSON.stringify(item));
      case 'number':
        return push(Number.isFinite(item) ? String(item) : 'null');
      case 'boolean':
        return push(item ? 'true' : 'false');
      case 'bigint':
        throw new TypeError('Do not know how to serialize a BigInt');
      default:
        break;
    }
    const inner = `${indent}  `;
    if (Array.isArray(item)) {
      if (item.length === 0) return push('[]');
      push('[');
      item.forEach((element, index) => {
        push(`${index === 0 ? '' : ','}\n${inner}`);
        write(element, inner);
      });
      return push(`\n${indent}]`);
    }
    const record = item as Record<string, unknown>;
    // Properties are read one at a time, so a budget spent on an early property never touches
    // the later ones (a getter, a large value); the opening brace becomes `{}` if none is kept.
    const open = parts.length;
    push('{');
    let first = true;
    for (const key of Object.keys(record)) {
      const property = record[key];
      if (skipped(property)) continue;
      push(`${first ? '' : ','}\n${inner}${JSON.stringify(key)}: `);
      first = false;
      write(property, inner);
    }
    if (first) {
      parts[open] = '{}';
      length += 1;
      if (length > limit) throw STOP;
      return;
    }
    push(`\n${indent}}`);
  };
  try {
    write(value, '');
  } catch (error) {
    if (error !== STOP) throw error;
    return { text: parts.join('').slice(0, limit), truncated: true };
  }
  return { text: parts.join(''), truncated: false };
}

/** True when the error means the backend could not be reached. */
export function isOfflineError(error: unknown): boolean {
  return error instanceof GraphGoblinApiError && error.status === NETWORK_ERROR_STATUS;
}

/** A one-line human message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof GraphGoblinApiError) {
    if (error.status === NETWORK_ERROR_STATUS) return 'The GraphGoblin API cannot be reached.';
    const base = error.detail ? `${error.detail} (${error.code})` : error.code;
    // A schema refusal alone does not say which field was wrong; name the first one.
    const first = error.code === 'VALIDATION_FAILED' ? problemIssues(error)[0] : undefined;
    return first ? `${base}: ${first}` : base;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Problem-details `errors` as a list of strings, for 400 and 422 responses. */
export function problemIssues(error: unknown): string[] {
  if (!(error instanceof GraphGoblinApiError)) return [];
  const details =
    error.code === 'LOOP_IMPORT_ERROR' &&
    typeof error.errors === 'object' &&
    error.errors !== null &&
    'errors' in error.errors
      ? error.errors.errors
      : error.errors;
  if (!Array.isArray(details)) return [];
  return details.map((item: unknown) => {
    if (typeof item === 'object' && item !== null && 'message' in item) {
      const where =
        'nodeId' in item && typeof item.nodeId === 'string'
          ? `${item.nodeId}: `
          : 'path' in item && typeof item.path === 'string' && item.path
            ? `${item.path}: `
            : '';
      return `${where}${String(item.message)}`;
    }
    return String(item);
  });
}

/** Offer a JSON document as a file download. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** A filesystem-friendly slug for download names. */
export function fileSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'loop';
}

/** Parse JSON text, returning a discriminated result instead of throwing. */
export function parseJson(
  text: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
