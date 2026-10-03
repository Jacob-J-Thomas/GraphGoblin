import { PatchError } from './errors.js';

/** RFC 6901 JSON Pointer helpers. Pure, no mutation of inputs. */

export function parsePointer(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) {
    throw new PatchError(`invalid JSON pointer "${pointer}": must start with "/"`);
  }
  return pointer
    .slice(1)
    .split('/')
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function formatPointer(tokens: readonly string[]): string {
  if (tokens.length === 0) return '';
  return `/${tokens.map((t) => t.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`;
}

export function pointerStartsWith(pointer: string, prefix: string): boolean {
  if (prefix === '') return true;
  return pointer === prefix || pointer.startsWith(`${prefix}/`);
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arrayIndex(token: string, length: number, allowEnd: boolean): number {
  if (token === '-') {
    if (!allowEnd) throw new PatchError('"-" is only valid as the final token of an add path');
    return length;
  }
  if (!/^(0|[1-9]\d*)$/.test(token)) {
    throw new PatchError(`invalid array index "${token}"`);
  }
  const index = Number(token);
  if (index > length || (!allowEnd && index === length)) {
    throw new PatchError(`array index ${index} out of bounds (length ${length})`);
  }
  return index;
}

/** Read a value at a pointer. Returns `{ found: false }` when any segment is missing. */
export function getAtPointer(
  doc: unknown,
  pointer: string,
): { found: true; value: unknown } | { found: false } {
  let current: unknown = doc;
  for (const token of parsePointer(pointer)) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(token)) return { found: false };
      const index = Number(token);
      if (index >= current.length) return { found: false };
      current = current[index];
    } else if (isObjectLike(current)) {
      if (!Object.prototype.hasOwnProperty.call(current, token)) return { found: false };
      current = current[token];
    } else {
      return { found: false };
    }
  }
  return { found: true, value: current };
}

type Mode = 'add' | 'replace' | 'remove';

/**
 * Structurally shared immutable update. Returns a new document; the input is never mutated.
 * `add` on arrays inserts (and accepts "-"); `replace` requires the target to exist; `remove` deletes.
 */
export function updateAtPointer(
  doc: unknown,
  pointer: string,
  mode: Mode,
  value?: unknown,
): unknown {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) {
    if (mode === 'remove') throw new PatchError('cannot remove the document root');
    return value;
  }
  return updateTokens(doc, tokens, mode, value, pointer);
}

function updateTokens(
  current: unknown,
  tokens: string[],
  mode: Mode,
  value: unknown,
  pointer: string,
): unknown {
  const [token, ...rest] = tokens as [string, ...string[]];
  const isLeaf = rest.length === 0;

  if (Array.isArray(current)) {
    const copy = current.slice();
    if (isLeaf) {
      if (mode === 'add') {
        const index = arrayIndex(token, copy.length, true);
        copy.splice(index, 0, value);
      } else {
        const index = arrayIndex(token, copy.length, false);
        if (mode === 'replace') copy[index] = value;
        else copy.splice(index, 1);
      }
      return copy;
    }
    const index = arrayIndex(token, copy.length, false);
    copy[index] = updateTokens(copy[index], rest, mode, value, pointer);
    return copy;
  }

  if (isObjectLike(current)) {
    const copy: Record<string, unknown> = { ...current };
    const exists = Object.prototype.hasOwnProperty.call(copy, token);
    if (isLeaf) {
      if (mode === 'add') {
        copy[token] = value;
      } else if (!exists) {
        throw new PatchError(`path "${pointer}" does not exist`);
      } else if (mode === 'replace') {
        copy[token] = value;
      } else {
        delete copy[token];
      }
      return copy;
    }
    if (!exists) throw new PatchError(`path "${pointer}" does not exist`);
    copy[token] = updateTokens(copy[token], rest, mode, value, pointer);
    return copy;
  }

  throw new PatchError(`path "${pointer}" traverses a non-container value`);
}
