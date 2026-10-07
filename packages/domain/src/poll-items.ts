import { JsonValueSchema, type JsonValue, type PollItems } from '@graphgoblin/contracts';
import { DomainError } from './errors.js';
import { evaluateExpression } from './expression.js';

export interface PreparedPollItem {
  item: JsonValue;
  index: number;
  dedupeKey: string;
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
    const parsed = JsonValueSchema.safeParse(candidate);
    if (!parsed.success) throw new PollItemsError('ITEM_INVALID', 'items.select', index);
    let key: unknown;
    try {
      key = await evaluateExpression(config.dedupeKey, { ...view, item: parsed.data, index });
    } catch {
      throw new PollItemsError('KEY_FAILED', 'items.dedupeKey', index);
    }
    if (typeof key !== 'string' || key.trim() === '' || key.length > 512)
      throw new PollItemsError('KEY_INVALID', 'items.dedupeKey', index);
    if (seen.has(key)) throw new PollItemsError('KEY_DUPLICATE', 'items.dedupeKey', index);
    seen.add(key);
    result.push({ item: parsed.data, index, dedupeKey: key });
  }
  return result;
}
