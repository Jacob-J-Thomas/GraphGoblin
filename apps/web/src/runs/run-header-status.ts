import type { RunEvent, RunStatus } from '@graphgoblin/contracts';
import { isTerminal } from '@graphgoblin/domain';

/**
 * Header-only status evidence for one run (#386). The run record is projected after its event is
 * appended and published, so a record read at, or even beyond, a terminal event's sequence can still
 * name the earlier phase. The header compares the record with the latest lifecycle marker this view
 * has observed: streamed batches as they are accepted, whatever history window is shown, and the
 * whole-run observation's `lifecycle` as each read succeeds. Sequence numbers order the evidence,
 * never the time it arrived. Nothing here changes the record, its recovery, failure, result,
 * delivery or controls; they stay the server's.
 */
export interface LifecycleMarker {
  seq: number;
  /**
   * The terminal status the marker records. Absent for a start or a resume, and for a finish
   * whose recorded status is not terminal: those supersede an earlier outcome but establish no
   * phase the header could show.
   */
  terminal?: RunStatus;
  /**
   * A resume, or the start of a later attempt: it follows an earlier outcome, so an active record
   * from before it is the earlier attempt's. The ordinary first start is not one.
   */
  resumes?: true;
}

export interface HeaderEvidence {
  readonly runId: string;
  /** The latest lifecycle marker observed for `runId`. */
  readonly marker?: LifecycleMarker;
  /**
   * The latest terminal marker's sequence, in whatever order it arrived: kept while a later start
   * or resume supersedes it, and raised by an earlier outcome delivered after its supersession.
   */
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
      return event.attempt > 1 ? { seq: event.seq, resumes: true } : { seq: event.seq };
    case 'run.resumed':
      return { seq: event.seq, resumes: true };
    default:
      return undefined;
  }
}

/**
 * Adds one marker. A newer one becomes the marker and coverage restarts at it. One at or before
 * what is covered can only reveal an earlier outcome: it raises `terminalSeq` and nothing else,
 * so a late failure never replaces its resume, moves coverage back or reinstates itself.
 */
function withMarker(evidence: HeaderEvidence, marker: LifecycleMarker): HeaderEvidence {
  const current = evidence.marker;
  if (current && marker.seq <= evidence.through) {
    const earlierOutcome =
      marker.terminal !== undefined &&
      marker.seq < current.seq &&
      marker.seq > (evidence.terminalSeq ?? 0);
    return earlierOutcome ? { ...evidence, terminalSeq: marker.seq } : evidence;
  }
  const terminalSeq = marker.terminal ? marker.seq : evidence.terminalSeq;
  return {
    runId: evidence.runId,
    marker,
    through: marker.seq,
    ...(terminalSeq === undefined ? {} : { terminalSeq }),
  };
}

/**
 * Folds an accepted batch, in sequence order. Only the run's own events count. A replayed or
 * older marker never undoes a newer one, though an older outcome is remembered as the outcome a
 * newer start or resume superseded. Coverage grows only without gaps: an unseen event could be a
 * resume.
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
    const marker = lifecycleMarker(event);
    if (marker) next = withMarker(next, marker);
    else if (next.marker && event.seq === next.through + 1) next = { ...next, through: event.seq };
  }
  return next;
}

/**
 * Folds the latest lifecycle marker of a whole-run observation that was just read. One for another
 * run changes nothing; a delayed older one only reveals an earlier outcome. The observation shows
 * no event after its marker, so coverage starts at the marker itself.
 */
export function observeLifecycle(
  evidence: HeaderEvidence,
  lifecycle: RunEvent | undefined,
): HeaderEvidence {
  if (!lifecycle || lifecycle.runId !== evidence.runId) return evidence;
  const marker = lifecycleMarker(lifecycle);
  return marker ? withMarker(evidence, marker) : evidence;
}

/** Whether two records are at the same status and sequence. */
export function samePosition(a: RecordedPosition, b: RecordedPosition): boolean {
  return a.status === b.status && a.lastEventSeq === b.lastEventSeq;
}

/**
 * The header's status for `row`. A record from before a terminal marker cannot confirm or deny it,
 * even with the same label, so the marker's own status and sequence are shown. At or after the
 * marker, an agreeing record is shown as itself; a disagreeing one is shown as the marker while
 * the record has not moved past what this view has seen (a record at exactly the marker's sequence
 * that still names the earlier phase, or one whose later events, such as delivery audits, are all
 * known). Beyond that coverage a terminal record is newer evidence, but an active status could be a
 * stale projection or an unseen resume, so the header says it is updating.
 *
 * A resume, a later attempt's start, or any start after a known outcome supersedes that outcome at
 * once without naming a phase (a resume can park in a wait again): a record from before it, or a
 * terminal one not beyond what was seen, is replaced by the updating state until a record that has
 * caught up arrives. The ordinary first start leaves an active record as it is.
 *
 * `verified` says whether this credential scope's own run read returned `row`'s position. A record
 * it has not read itself names no status; an event's outcome stands on this view's own evidence.
 *
 * `cursorHint` is the event cursor the device already held when this evidence began. Those events
 * were not observed here and may hold a later resume, so an outcome before the hint is shown only
 * once accepted coverage reaches it (a marker at or beyond it starts coverage there); until then the
 * header says it is updating. It never names a status, and never withholds a fresh agreeing record.
 */
export function headerStatus(
  evidence: HeaderEvidence,
  row: RecordedPosition,
  verified = true,
  cursorHint = 0,
): HeaderStatus {
  const status = fromEvidence(evidence, row);
  if (status.kind === 'record') return verified ? status : { kind: 'updating' };
  if (status.kind === 'event' && status.seq < cursorHint && evidence.through < cursorHint)
    return { kind: 'updating' };
  return status;
}

function fromEvidence(evidence: HeaderEvidence, row: RecordedPosition): HeaderStatus {
  const record: HeaderStatus = { kind: 'record', status: row.status };
  const { marker } = evidence;
  if (!marker) return record;
  const rowTerminal = isTerminal(row.status);
  if (marker.terminal) {
    const outcome: HeaderStatus = { kind: 'event', status: marker.terminal, seq: marker.seq };
    if (row.lastEventSeq < marker.seq) return outcome;
    if (row.status === marker.terminal) return record;
    if (row.lastEventSeq <= evidence.through) return outcome;
    return rowTerminal ? record : { kind: 'updating' };
  }
  if (row.lastEventSeq < marker.seq) {
    if (rowTerminal) return { kind: 'updating' };
    return marker.resumes || evidence.terminalSeq !== undefined ? { kind: 'updating' } : record;
  }
  if (!rowTerminal) return record;
  return row.lastEventSeq <= evidence.through ? { kind: 'updating' } : record;
}
