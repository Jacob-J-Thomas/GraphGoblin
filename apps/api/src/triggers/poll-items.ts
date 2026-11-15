import type { JsonValue, PollItems, RunRecord } from '@graphgoblin/contracts';
import {
  preparePollItems,
  type PreparedPollItem,
  type PollItemRejection,
} from '@graphgoblin/domain';

export interface PollItemAdmissionDeps {
  /** One indexed lookup of the complete set of usable candidate keys. */
  findSeen(keys: readonly string[]): Promise<ReadonlySet<string>>;
  start(item: PreparedPollItem): Promise<RunRecord | undefined>;
}
export interface PollItemAdmissionResult {
  runs: RunRecord[];
  rejections: PollItemRejection[];
  /** The first failed candidate and every later candidate remain for a later poll. */
  failedItemIndex?: number;
}

/** Validate the whole batch before lookup or sequential admission. */
export async function admitPollItems(
  config: PollItems,
  view: { now: string; probe: JsonValue },
  deps: PollItemAdmissionDeps,
): Promise<PollItemAdmissionResult> {
  const items = await preparePollItems(config, view);
  const keys = items.flatMap(({ dedupeKey }) => (dedupeKey === undefined ? [] : [dedupeKey]));
  let seen: ReadonlySet<string> | undefined;
  if (keys.length > 0) {
    try {
      seen = await deps.findSeen(keys);
    } catch {
      throw new Error('POLL_DEDUPE_LOOKUP_FAILED');
    }
  }
  const unseen = items.filter(({ dedupeKey }) => dedupeKey === undefined || !seen?.has(dedupeKey));
  const rejections = unseen.flatMap((item) => (item.rejection ? [item.rejection] : []));
  const runs: RunRecord[] = [];
  for (const item of unseen) {
    if (item.dedupeKey === undefined || item.rejection) continue;
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
