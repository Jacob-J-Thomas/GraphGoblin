/** Marks a form value the user cleared. Never leaves the form: `stripUnset` removes it. */
export const UNSET = '\u0000graphgoblin:unset';

export function isUnset(value: unknown): boolean {
  return value === UNSET;
}

/** A deep copy without UNSET: object keys holding it are dropped, array slots become undefined. */
export function stripUnset(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map((item) => (isUnset(item) ? undefined : stripUnset(item)));
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (!isUnset(item) && item !== undefined) out[key] = stripUnset(item);
    }
    return out;
  }
  return isUnset(value) ? undefined : value;
}
