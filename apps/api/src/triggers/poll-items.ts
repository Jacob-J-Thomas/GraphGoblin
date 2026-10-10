import type { JsonValue, PollItems, RunRecord } from '@graphgoblin/contracts';
import { preparePollItems, type PreparedPollItem } from '@graphgoblin/domain';

export interface PollItemAdmissionDeps {
  /** One indexed lookup of the complete validated candidate key set. */
  findSeen(keys: readonly string[]): Promise<ReadonlySet<string>>;
  start(item: PreparedPollItem): Promise<RunRecord | undefined>;
}
export interface PollItemAdmissionResult {
  runs: RunRecord[];
  /** The first failed candidate and every later candidate remain for a later poll. */
  failedItemIndex?: number;
}

/** No lookup or run admission occurs until every candidate and key has passed validation. */
export async function admitPollItems(
  config: PollItems,
  view: { now: string; probe: JsonValue },
  deps: PollItemAdmissionDeps,
): Promise<PollItemAdmissionResult> {
  const items = await preparePollItems(config, view);
  if (items.length === 0) return { runs: [] };
  let seen: ReadonlySet<string>;
  try {
    seen = await deps.findSeen(items.map((item) => item.dedupeKey));
  } catch {
    throw new Error('POLL_DEDUPE_LOOKUP_FAILED');
  }
  const runs: RunRecord[] = [];
  for (const item of items) {
    if (seen.has(item.dedupeKey)) continue;
    if (runs.length === config.maxRunsPerPoll) break;
    try {
      const run = await deps.start(item);
      if (run) runs.push(run);
    } catch {
      return { runs, failedItemIndex: item.index };
    }
  }
  return { runs };
}
