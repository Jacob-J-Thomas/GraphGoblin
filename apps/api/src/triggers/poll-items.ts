import type { JsonValue, PollItems, RunRecord } from '@graphgoblin/contracts';
import {
  preparePollItems,
  type PreparedPollItem,
  type PollItemRejection,
} from '@graphgoblin/domain';

export interface PollItemAdmissionDeps {
  /** One indexed lookup of the complete validated candidate key set. */
  findSeen(keys: readonly string[]): Promise<ReadonlySet<string>>;
  start(item: PreparedPollItem): Promise<RunRecord | undefined>;
}
export interface PollItemAdmissionResult {
  runs: RunRecord[];
  rejections: PollItemRejection[];
  /** The first failed candidate and every later candidate remain for a later poll. */
  failedItemIndex?: number;
}

/** Validate the whole batch first; only a classified structural refusal skips one candidate. */
export async function admitPollItems(
  config: PollItems,
  view: { now: string; probe: JsonValue },
  deps: PollItemAdmissionDeps,
): Promise<PollItemAdmissionResult> {
  const items = await preparePollItems(config, view);
  if (items.length === 0) return { runs: [], rejections: [] };
  let seen: ReadonlySet<string>;
  try {
    seen = await deps.findSeen(items.map((item) => item.dedupeKey));
  } catch {
    throw new Error('POLL_DEDUPE_LOOKUP_FAILED');
  }
  const unseen = items.filter((item) => !seen.has(item.dedupeKey));
  const rejections = unseen.flatMap((item) => (item.rejection ? [item.rejection] : []));
  const runs: RunRecord[] = [];
  for (const item of unseen) {
    if (item.rejection) continue;
    if (runs.length === config.maxRunsPerPoll) break;
    try {
      const run = await deps.start(item);
      if (run) runs.push(run);
    } catch {
      return { runs, rejections, failedItemIndex: item.index };
    }
  }
  return { runs, rejections };
}
