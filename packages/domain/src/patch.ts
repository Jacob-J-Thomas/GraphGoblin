import type { JsonPatch, PatchOperation } from '@graphgoblin/contracts';
import { PatchError } from './errors.js';
import { getAtPointer, pointerStartsWith, updateAtPointer } from './pointer.js';

/** Deep structural equality for JSON values. */
export function jsonEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => jsonEquals(item, b[i]));
  }
  if (Array.isArray(b)) return false;
  if (typeof a === 'object' && typeof b === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && jsonEquals(ao[k], bo[k]));
  }
  return false;
}

/** Deep clone of a JSON value. */
export function cloneJson<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return (value as unknown[]).map((v) => cloneJson(v)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = cloneJson(v);
  return out as T;
}

function applyOne(doc: unknown, op: PatchOperation): unknown {
  switch (op.op) {
    case 'add':
      return updateAtPointer(doc, op.path, 'add', cloneJson(op.value));
    case 'replace':
      return updateAtPointer(doc, op.path, 'replace', cloneJson(op.value));
    case 'remove':
      return updateAtPointer(doc, op.path, 'remove');
    case 'move': {
      if (pointerStartsWith(op.path, op.from) && op.path !== op.from) {
        throw new PatchError(`cannot move "${op.from}" into its own child "${op.path}"`);
      }
      const source = getAtPointer(doc, op.from);
      if (!source.found) throw new PatchError(`move source "${op.from}" does not exist`);
      const removed = updateAtPointer(doc, op.from, 'remove');
      return updateAtPointer(removed, op.path, 'add', source.value);
    }
    case 'copy': {
      const source = getAtPointer(doc, op.from);
      if (!source.found) throw new PatchError(`copy source "${op.from}" does not exist`);
      return updateAtPointer(doc, op.path, 'add', cloneJson(source.value));
    }
    case 'test': {
      const current = getAtPointer(doc, op.path);
      if (!current.found || !jsonEquals(current.value, op.value)) {
        throw new PatchError(`test failed at "${op.path}"`, { expected: op.value });
      }
      return doc;
    }
  }
}

/**
 * Apply an RFC 6902 patch immutably. Either every operation applies or a PatchError is thrown
 * and the input document is untouched.
 */
export function applyPatch<T>(doc: T, patch: JsonPatch): T {
  let current: unknown = doc;
  for (const [index, op] of patch.entries()) {
    try {
      current = applyOne(current, op);
    } catch (error) {
      if (error instanceof PatchError) {
        throw new PatchError(
          `operation ${index} (${op.op} ${op.path}): ${error.message}`,
          error.details,
        );
      }
      throw error;
    }
  }
  return current as T;
}
