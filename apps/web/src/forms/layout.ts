/**
 * Where a schema-driven form places its fields, from the contracts' field metadata (`fieldMeta`):
 * the basic fields first, in schema order, then the advanced ones under a collapsed Advanced
 * disclosure, grouped by their `group` under headed sections, each group where its first field is.
 *
 * An object that is always present (it has a default) splits when any of its own fields says
 * whether it is advanced: its basic fields join the basic ones at the object's place, and its
 * advanced fields go under Advanced, in the field's group, else the object's, else the object's
 * label. Any other field is placed whole, as before.
 */
import { fieldMeta } from '@graphgoblin/contracts';
import { joinPath } from './fields/shared.js';
import { humanize, matchOption, shapeOf, unwrap, type Schema } from './introspect.js';
import { stripUnset } from './unset.js';

/** A field as the form places it: its path in the form's value, its schema, and its label. */
export interface Placement {
  name: string;
  schema: Schema;
  label: string;
}

/**
 * Fields of a split object, kept together under the object's path (`data-field`), so an issue
 * about the object itself (an unknown key, say) finds them, the basic block first; `showsError`
 * marks the block that shows the object's own message: its basic one, always in sight, else its
 * first one under Advanced.
 */
export interface OwnedFields {
  owner: string;
  fields: Placement[];
  showsError: boolean;
}

export type LayoutItem = Placement | OwnedFields;

/** A section under Advanced: its heading (`undefined` for fields without a group) and fields. */
export interface AdvancedSection {
  heading: string | undefined;
  items: LayoutItem[];
}

export interface FormLayout {
  basic: LayoutItem[];
  advanced: AdvancedSection[];
}

export function isOwned(item: LayoutItem): item is OwnedFields {
  return 'owner' in item;
}

/** The fields of a list of items, owned blocks unpacked. */
export function placementsOf(items: readonly LayoutItem[]): Placement[] {
  return items.flatMap((item) => (isOwned(item) ? item.fields : [item]));
}

/** The form's label for a field: its metadata's title, else its humanized key. */
export function labelOf(key: string, schema: Schema): string {
  return fieldMeta(schema).title ?? humanize(key);
}

/** The fields of an always-present object some of whose fields say whether they are advanced. */
function splitFields(schema: Schema): Record<string, Schema> | undefined {
  const { optional, hasDefault } = unwrap(schema);
  if (optional && !hasDefault) return undefined;
  const shape = shapeOf(schema);
  if (shape.kind !== 'object') return undefined;
  const fields = Object.values(shape.shape);
  return fields.some((field) => fieldMeta(field).advanced !== undefined || fieldMeta(field).context)
    ? shape.shape
    : undefined;
}

/** Lay out the fields of an object `shape` whose value sits at `base`, leaving out `skip`. */
export function formLayout(
  shape: Record<string, Schema>,
  base = '',
  skip?: string,
  omitContext = false,
): FormLayout {
  const basic: LayoutItem[] = [];
  const advanced: AdvancedSection[] = [];
  const section = (heading: string | undefined) => {
    let found = advanced.find((s) => s.heading === heading);
    if (!found) {
      found = { heading, items: [] };
      advanced.push(found);
    }
    return found.items;
  };
  for (const [key, schema] of Object.entries(shape)) {
    if (key === skip) continue;
    const name = joinPath(base, key);
    const meta = fieldMeta(schema);
    if (omitContext && meta.context) continue;
    const label = meta.title ?? humanize(key);
    const fields = splitFields(schema);
    if (!fields) {
      (meta.advanced && unwrap(schema).optional ? section(meta.group) : basic).push({
        name,
        schema,
        label,
      });
      continue;
    }
    const kept: Placement[] = [];
    const moved = new Map<string, Placement[]>();
    for (const [childKey, child] of Object.entries(fields)) {
      const childMeta = fieldMeta(child);
      if (omitContext && childMeta.context) continue;
      const placement = {
        name: joinPath(name, childKey),
        schema: child,
        label: childMeta.title ?? humanize(childKey),
      };
      if ((childMeta.advanced ?? meta.advanced ?? false) && unwrap(child).optional) {
        const heading = childMeta.group ?? meta.group ?? label;
        moved.set(heading, [...(moved.get(heading) ?? []), placement]);
      } else kept.push(placement);
    }
    if (kept.length > 0) {
      basic.push({ owner: name, fields: kept, showsError: true });
    }
    [...moved].forEach(([heading, placements], index) => {
      const showsError = kept.length === 0 && index === 0;
      section(heading).push({ owner: name, fields: placements, showsError });
    });
  }
  return { basic, advanced };
}

/** Collect whole context fields through present objects and the selected evaluator variant.
 * Collections and absent optional objects remain whole so their lifecycle still belongs to their
 * existing renderer. No field paths, schemas or values are rewritten.
 */
export function contextLayout(schema: Schema, value: unknown, base = ''): FormLayout {
  const meta = fieldMeta(schema);
  if (meta.context) {
    const key = base.split('.').at(-1)!;
    return formLayout({ [key]: schema }, base.slice(0, Math.max(0, base.length - key.length - 1)));
  }
  const { optional, hasDefault, defaultValue } = unwrap(schema);
  const current = value === undefined && hasDefault ? defaultValue : value;
  const result: FormLayout = { basic: [], advanced: [] };
  if (current === undefined && optional && !hasDefault) return result;
  const shape = shapeOf(schema);
  if (shape.kind === 'union') {
    return contextLayout(
      shape.options[matchOption(shape.options, current, shape.discriminator)]!,
      current,
      base,
    );
  }
  if (shape.kind !== 'object') return result;
  const record =
    typeof current === 'object' && current !== null ? (current as Record<string, unknown>) : {};
  for (const [key, child] of Object.entries(shape.shape)) {
    const nested = contextLayout(child, record[key], joinPath(base, key));
    result.basic.push(...nested.basic);
    for (const section of nested.advanced) {
      const found = result.advanced.find((item) => item.heading === section.heading);
      if (found) found.items.push(...section.items);
      else result.advanced.push(section);
    }
  }
  return result;
}

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) =>
    sameJson((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/**
 * Whether a field holds a value of its own: set, and not its default. An object holds one when
 * any of its fields does (so `{}` or a copy of each default does not count); an empty list or map
 * without a default holds nothing. An opaque JSON value (a JSON Schema, `unknown`) counts as soon
 * as it is supplied, `{}` included: an empty JSON Schema is a choice, not the absence of one.
 */
export function isCustomized(schema: Schema, value: unknown): boolean {
  const current = stripUnset(value);
  if (current === undefined) return false;
  const { hasDefault, defaultValue, base } = unwrap(schema);
  if (hasDefault && sameJson(current, defaultValue)) return false;
  if (typeof current !== 'object' || current === null) return true;
  const shape = shapeOf(base);
  if (shape.kind === 'json') return true;
  if (shape.kind === 'object' && !Array.isArray(current)) {
    return Object.entries(current).some(([key, item]) => {
      const field = shape.shape[key];
      return field ? isCustomized(field, item) : item !== undefined;
    });
  }
  return Object.keys(current).length > 0 || hasDefault;
}
