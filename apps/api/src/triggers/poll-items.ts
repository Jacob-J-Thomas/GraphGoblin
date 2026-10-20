import type { JsonValue, PollItems, RunRecord } from '@graphgoblin/contracts';
import {
  preparePollItems,
  type PreparedPollItem,
  type PollItemRejection,
} from '@graphgoblin/domain';

export interface PollItemAdmissionDeps {
  /** One indexed lookup of the complete validated, storable candidate key set. */
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
  const rejections = items.flatMap((item) => (item.rejection ? [item.rejection] : []));
  const storable = items.filter((item) => !item.rejection);
  if (storable.length === 0) return { runs: [], rejections };
  let seen: ReadonlySet<string>;
  try {
    seen = await deps.findSeen(storable.map((item) => item.dedupeKey));
  } catch {
    throw new Error('POLL_DEDUPE_LOOKUP_FAILED');
  }
  const runs: RunRecord[] = [];
  for (const item of storable) {
    if (seen.has(item.dedupeKey)) continue;
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
