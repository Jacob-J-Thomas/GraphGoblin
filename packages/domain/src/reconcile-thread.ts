import type { ContextThread } from '@graphgoblin/contracts';
import { replayStateAt, replayThread, type ThreadReplayEvent, type ReplayState } from './replay.js';

export interface ThreadCheckpoint {
  thread: ContextThread;
  seq: number;
  /** A bounded reader may supply state proven from this checkpoint event and write order. */
  replayState?: ReplayState;
}

/**
 * The read-only thread at a durable event boundary. A checkpoint is only a cache: it must name
 * an event in this history at or before the requested boundary. An unfinished start contributes
 * its visit counter, never a patch; only durable completions carry patches (replayThread).
 */
export function reconcileThread(
  initial: ContextThread,
  events: readonly ThreadReplayEvent[],
  checkpoint?: ThreadCheckpoint,
  uptoSeq?: number,
): ContextThread {
  if (
    checkpoint &&
    (uptoSeq === undefined || checkpoint.seq <= uptoSeq) &&
    events.some((event) => event.seq === checkpoint.seq)
  ) {
    return replayThread(
      checkpoint.thread,
      events.filter((event) => event.seq > checkpoint.seq),
      uptoSeq,
      checkpoint.replayState ?? replayStateAt(events, checkpoint.seq),
    );
  }
  return replayThread(initial, events, uptoSeq);
}
