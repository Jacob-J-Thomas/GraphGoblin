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
/** Characters of a string quoted at a time, so a huge string costs only its first chunks. */
const QUOTE_CHUNK = 1_024;

/**
 * The first `limit` characters of `prettyJson(value)` and whether more would follow, produced
 * without formatting the whole value: the walk stops as soon as the budget is spent, strings and
 * property names are quoted in chunks up to the remaining budget, and object properties are read
 * one at a time, so a multi-megabyte variable costs only its first lines of work and memory
 * (#259). The text is exactly `prettyJson(value).slice(0, limit)` for JSON data (what the API
 * returns: objects, arrays, strings, numbers, booleans, null) and the usual extras that reach it
 * from JavaScript: the same key order, escaping, indentation, array holes, same-realm boxed
 * primitives, `toJSON` (called with the property key, as on `Date`) and omission of `undefined`,
 * functions and symbols; a BigInt throws the same `TypeError`. Exotic values (a function carrying
 * `toJSON`, a boxed primitive from another realm or with an overridden `valueOf`, a getter that
 * changes an array's length while it is read) are outside the guarantee.
 */
export function prettyJsonPrefix(
  value: unknown,
  limit: number,
): { text: string; truncated: boolean } {
  const parts: string[] = [];
  let length = 0;
  const push = (part: string): void => {
    parts.push(part);
    length += part.length;
    if (length > limit) throw STOP;
  };
  // `JSON.stringify(text)` without quoting the whole text: a chunk boundary moves past a high
  // surrogate only when the next character is its low half (a lone high surrogate stays where it
  // is and escapes as `\ud800` either way), so the escapes are the ones the whole string would
  // get; stops once the budget is spent.
  const quote = (text: string): void => {
    push('"');
    for (let start = 0; start < text.length; ) {
      let end = Math.min(start + QUOTE_CHUNK, text.length);
      if (
        end < text.length &&
        /[\ud800-\udbff]/.test(text[end - 1] ?? '') &&
        /[\udc00-\udfff]/.test(text[end] ?? '')
      )
        end += 1;
      push(JSON.stringify(text.slice(start, end)).slice(1, -1));
      start = end;
    }
    push('"');
  };
  // What `JSON.stringify` serialises for a value found under `key`: `toJSON` applied, boxed
  // primitives unwrapped; `undefined` means the property is omitted (or `null` in an array).
  const prepare = (item: unknown, key: string): unknown => {
    if (item !== null && typeof item === 'object') {
      const method = (item as { toJSON?: unknown }).toJSON;
      if (typeof method === 'function') item = (method as (k: string) => unknown).call(item, key);
    }
    if (item instanceof String || item instanceof Number || item instanceof Boolean)
      item = item.valueOf();
    if (typeof item === 'function' || typeof item === 'symbol') return undefined;
    return item;
  };
  const write = (prepared: unknown, indent: string): void => {
    if (prepared === undefined || prepared === null) return push('null');
    switch (typeof prepared) {
      case 'string':
        return quote(prepared);
      case 'number':
        return push(Number.isFinite(prepared) ? String(prepared) : 'null');
      case 'boolean':
        return push(prepared ? 'true' : 'false');
      case 'bigint':
        throw new TypeError('Do not know how to serialize a BigInt');
      default:
        break;
    }
    const inner = `${indent}  `;
    if (Array.isArray(prepared)) {
      if (prepared.length === 0) return push('[]');
      push('[');
      for (let index = 0; index < prepared.length; index += 1) {
        push(`${index === 0 ? '' : ','}\n${inner}`);
        // A hole reads as `undefined`, which an array serialises as `null`.
        write(prepare(prepared[index], String(index)), inner);
      }
      return push(`\n${indent}]`);
    }
    const record = prepared as Record<string, unknown>;
    // Own enumerable string keys in `Object.keys` order, read one at a time: a budget spent on an
    // early property never touches a later one; the opening brace becomes `{}` if none is kept.
    const open = parts.length;
    push('{');
    let first = true;
    for (const key in record) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
      const property = prepare(record[key], key);
      if (property === undefined) continue;
      push(first ? '\n' : ',\n');
      push(inner);
      quote(key);
      push(': ');
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
    const root = prepare(value, '');
    if (root === undefined) return { text: '', truncated: false };
    write(root, '');
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
