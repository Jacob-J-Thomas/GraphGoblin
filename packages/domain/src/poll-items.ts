import type { JsonValue, PollItems } from '@graphgoblin/contracts';
import { DomainError } from './errors.js';
import { evaluateExpression } from './expression.js';
import { isJsonValue } from './json-value.js';

// SQLite JSON1 accepts 1,000 container levels. The runs dedupe expression index parses
// initial_thread: root (1) -> invocation (2) -> trigger (3) -> payload/candidate (4).
// Count the candidate's root container as depth 0, so another 996 nested containers fit.
// An object {v: <996 arrays>} is storable; a 997th array would exceed SQLite's limit.
export const POLL_ITEM_MAX_NESTING_DEPTH = 1000 - 4;

export interface PollItemRejection {
  code: 'POLL_ITEM_REJECTED';
  itemIndex: number;
  reason: 'NESTING_DEPTH_EXCEEDED';
}

function exceedsStoredDepth(item: JsonValue): boolean {
  const stack = [{ value: item, depth: 0 }];
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (value === null || typeof value !== 'object') continue;
    if (depth > POLL_ITEM_MAX_NESTING_DEPTH) return true;
    for (const child of Array.isArray(value) ? value : Object.values(value))
      stack.push({ value: child, depth: depth + 1 });
  }
  return false;
}

export interface PreparedPollItem {
  item: JsonValue;
  index: number;
  dedupeKey: string;
  rejection?: PollItemRejection;
}

type ItemFailure =
  | 'SELECTOR_FAILED'
  | 'NOT_ARRAY'
  | 'TOO_MANY_ITEMS'
  | 'ITEM_INVALID'
  | 'KEY_FAILED'
  | 'KEY_INVALID'
  | 'KEY_DUPLICATE';

/** Safe author diagnostics: neither selected payloads nor evaluator exception text are included. */
export class PollItemsError extends DomainError {
  constructor(
    readonly reason: ItemFailure,
    readonly path: 'items.select' | 'items.dedupeKey',
    readonly itemIndex?: number,
  ) {
    super('POLL_ITEMS_INVALID', 'Poll items are invalid: ' + reason, {
      reason,
      path,
      ...(itemIndex !== undefined ? { itemIndex } : {}),
    });
  }
}

/** Validate the complete curated set before admission or dedupe I/O starts. */
export async function preparePollItems(
  config: PollItems,
  view: { now: string; probe: JsonValue },
): Promise<PreparedPollItem[]> {
  let selected: unknown;
  try {
    selected = await evaluateExpression(config.select, view);
  } catch {
    throw new PollItemsError('SELECTOR_FAILED', 'items.select');
  }
  if (!Array.isArray(selected)) throw new PollItemsError('NOT_ARRAY', 'items.select');
  if (selected.length > 200) throw new PollItemsError('TOO_MANY_ITEMS', 'items.select');
  const result: PreparedPollItem[] = [];
  const seen = new Set<string>();
  for (const [index, candidate] of selected.entries()) {
    if (!isJsonValue(candidate)) throw new PollItemsError('ITEM_INVALID', 'items.select', index);
    const tooDeep = exceedsStoredDepth(candidate);
    let key: unknown;
    try {
      key = await evaluateExpression(config.dedupeKey, { ...view, item: candidate, index });
    } catch {
      throw new PollItemsError('KEY_FAILED', 'items.dedupeKey', index);
    }
    if (typeof key !== 'string' || key.trim() === '' || key.length > 512)
      throw new PollItemsError('KEY_INVALID', 'items.dedupeKey', index);
    if (seen.has(key)) throw new PollItemsError('KEY_DUPLICATE', 'items.dedupeKey', index);
    seen.add(key);
    result.push({
      item: candidate,
      index,
      dedupeKey: key,
      ...(tooDeep
        ? {
            rejection: {
              code: 'POLL_ITEM_REJECTED' as const,
              itemIndex: index,
              reason: 'NESTING_DEPTH_EXCEEDED' as const,
            },
          }
        : {}),
    });
  }
  return result;
}
