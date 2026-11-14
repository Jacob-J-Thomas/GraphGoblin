/**
 * A repair of a form's value made outside the form (#273): a node rename rewrites reference
 * strings in place and changes nothing else. `stringRepairs` says whether one value is such a
 * repair of another, and `withStringRepairs` applies it to a copy of the form's own values.
 */

/** One string a repair replaced: where it is (object keys and array indices) and its new text. */
export interface StringRepair {
  readonly path: readonly (string | number)[];
  readonly from: string;
  readonly to: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The strings `next` replaced in `previous`, when that is all that differs: the same object keys
 * and array lengths, and every other value equal (unchanged parts may be shared or copied).
 * Undefined when anything else differs, so a caller never mistakes another edit for a repair.
 */
export function stringRepairs(previous: unknown, next: unknown): StringRepair[] | undefined {
  const repairs: StringRepair[] = [];
  const walk = (a: unknown, b: unknown, path: (string | number)[]): boolean => {
    if (Object.is(a, b)) return true;
    if (typeof a === 'string' && typeof b === 'string') {
      repairs.push({ path, from: a, to: b });
      return true;
    }
    if (Array.isArray(a) && Array.isArray(b))
      return (
        a.length === b.length && a.every((item, index) => walk(item, b[index], [...path, index]))
      );
    if (isRecord(a) && isRecord(b)) {
      const keys = Object.keys(a);
      return (
        keys.length === Object.keys(b).length &&
        keys.every((key) => Object.hasOwn(b, key) && walk(a[key], b[key], [...path, key]))
      );
    }
    return false;
  };
  return walk(previous, next, []) ? repairs : undefined;
}

/**
 * `value` with each repair's string replaced, from `depth` segments into its path, copying only
 * the objects and arrays on the way; everything else (a form's cleared-field markers included) is
 * kept as it is.
 */
export function withStringRepairs(
  value: unknown,
  repairs: readonly StringRepair[],
  depth = 0,
): unknown {
  const set = (current: unknown, path: readonly (string | number)[], text: string): unknown => {
    const [key, ...rest] = path;
    if (key === undefined) return text;
    if (Array.isArray(current)) {
      const items: readonly unknown[] = current;
      const copy = [...items];
      copy[Number(key)] = set(items[Number(key)], rest, text);
      return copy;
    }
    const object = isRecord(current) ? current : {};
    return { ...object, [key]: set(object[key], rest, text) };
  };
  return repairs.reduce(
    (result, repair) => set(result, repair.path.slice(depth), repair.to),
    value,
  );
}
