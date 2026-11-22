import type { RunEvent, RunStatus } from '@graphgoblin/contracts';
import { isTerminal } from '@graphgoblin/domain';

/**
 * Header-only status evidence for one run (#386). The run record is projected after its event is
 * appended and published, so a record read at, or even beyond, a terminal event's sequence can still
 * name the earlier phase. The header compares the record with the latest lifecycle marker this view
 * has observed: streamed batches as they are accepted, whatever history window is shown, and the
 * whole-run observation's `lifecycle`. Nothing here changes the record, its recovery, failure,
 * result, delivery or controls; they stay the server's.
 */
export interface LifecycleMarker {
  seq: number;
  /**
   * The terminal status the marker records. Absent for a start or a resume, and for a finish
   * whose recorded status is not terminal: those supersede an earlier outcome but establish no
   * phase the header could show.
   */
  terminal?: RunStatus;
}

export interface HeaderEvidence {
  readonly runId: string;
  /** The latest lifecycle marker observed for `runId`. */
  readonly marker?: LifecycleMarker;
  /** The latest terminal marker's sequence, kept while a later start or resume supersedes it. */
  readonly terminalSeq?: number;
  /** Every event after `marker` through this sequence has been seen; none was a later marker. */
  readonly through: number;
}

/**
 * What the header shows: the record's own status, a terminal event the record has not caught up
 * with, or that the status is being updated because the record and newer evidence disagree.
 */
export type HeaderStatus =
  | { kind: 'record'; status: RunStatus }
  | { kind: 'event'; status: RunStatus; seq: number }
  | { kind: 'updating' };

export interface RecordedPosition {
  status: RunStatus;
  lastEventSeq: number;
}

export function emptyEvidence(runId: string): HeaderEvidence {
  return { runId, through: 0 };
}

/** The lifecycle markers the run observation reports; any other event is not one. */
export function lifecycleMarker(event: RunEvent): LifecycleMarker | undefined {
  switch (event.type) {
    case 'run.finished':
      return isTerminal(event.status)
        ? { seq: event.seq, terminal: event.status }
        : { seq: event.seq };
    case 'run.failed':
      return { seq: event.seq, terminal: 'failed' };
    case 'run.cancelled':
      return { seq: event.seq, terminal: 'cancelled' };
    case 'run.started':
    case 'run.resumed':
      return { seq: event.seq };
    default:
      return undefined;
  }
}

function withMarker(evidence: HeaderEvidence, marker: LifecycleMarker): HeaderEvidence {
  const terminalSeq = marker.terminal ? marker.seq : evidence.terminalSeq;
  return {
    runId: evidence.runId,
    marker,
    through: marker.seq,
    ...(terminalSeq === undefined ? {} : { terminalSeq }),
  };
}

/**
 * Folds an accepted batch, in sequence order. Only the run's own events count; an event at or
 * before the known coverage changes nothing, so a replayed or older marker never undoes a newer
 * one. Coverage grows only without gaps: an unseen event could be a resume.
 */
export function observeEvents(
  evidence: HeaderEvidence,
  events: readonly RunEvent[],
): HeaderEvidence {
  let next = evidence;
  const ordered = events
    .filter((event) => event.runId === evidence.runId)
    .sort((a, b) => a.seq - b.seq);
  for (const event of ordered) {
    if (next.marker && event.seq <= next.through) continue;
    const marker = lifecycleMarker(event);
    if (marker) next = withMarker(next, marker);
    else if (next.marker && event.seq === next.through + 1) next = { ...next, through: event.seq };
  }
  return next;
}

/**
 * Folds the whole-run observation's latest lifecycle marker. A delayed or cached observation older
 * than what this view has seen, or one for another run, changes nothing. The observation shows no
 * event after its marker, so coverage starts at the marker itself.
 */
export function observeLifecycle(
  evidence: HeaderEvidence,
  lifecycle: RunEvent | undefined,
): HeaderEvidence {
  if (!lifecycle || lifecycle.runId !== evidence.runId) return evidence;
  if (evidence.marker && lifecycle.seq <= evidence.marker.seq) return evidence;
  const marker = lifecycleMarker(lifecycle);
  return marker ? withMarker(evidence, marker) : evidence;
}

/**
 * The header's status for `row`. A terminal marker shows its own status while the record has not
 * moved past what this view has seen, which includes a record at exactly the marker's sequence
 * that still names the earlier phase, and one whose later events (delivery audits) are all known.
 * A record beyond that coverage is newer evidence: its terminal status is shown, but an active
 * status there could be a stale projection or an unseen resume, so the header says it is updating.
 * A start or resume supersedes an earlier outcome at once without naming a phase (a resume can park
 * in a wait again), so a terminal record, or an active one older than a known outcome, is replaced
 * by the updating state until a record that has caught up arrives.
 */
export function headerStatus(evidence: HeaderEvidence, row: RecordedPosition): HeaderStatus {
  const record: HeaderStatus = { kind: 'record', status: row.status };
  const { marker } = evidence;
  if (!marker) return record;
  const rowTerminal = isTerminal(row.status);
  if (marker.terminal) {
    if (row.status === marker.terminal) return record;
    if (row.lastEventSeq <= evidence.through)
      return { kind: 'event', status: marker.terminal, seq: marker.seq };
    return rowTerminal ? record : { kind: 'updating' };
  }
  if (row.lastEventSeq < marker.seq) {
    if (rowTerminal) return { kind: 'updating' };
    const outcome = evidence.terminalSeq;
    // An active record from no later than a known outcome predates that outcome's projection.
    return outcome !== undefined && row.lastEventSeq <= outcome ? { kind: 'updating' } : record;
  }
  if (!rowTerminal) return record;
  return row.lastEventSeq <= evidence.through ? { kind: 'updating' } : record;
}
