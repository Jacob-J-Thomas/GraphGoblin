import type { RunEvent, RunStatus } from '@graphgoblin/contracts';
import { describe, expect, it } from 'vitest';
import { event } from '../__fixtures__/fake-api.js';
import {
  emptyEvidence,
  headerStatus,
  lifecycleMarker,
  observeEvents,
  observeLifecycle,
} from './run-header-status.js';

const R = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const OTHER = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const actor = { kind: 'user' as const, id: 'local' };
const succeeded = (seq: number, runId = R) =>
  event(runId, seq, 'run.finished', { status: 'succeeded', outcome: 'success' });
const failed = (seq: number) =>
  event(R, seq, 'run.failed', {
    failure: { code: 'INTERNAL_ERROR', message: 'boom', resumable: true },
  });
const delivered = (seq: number) => event(R, seq, 'return.delivered', { channel: { kind: 'log' } });
const resumed = (seq: number) => event(R, seq, 'run.resumed', { actor });
const started = (seq: number) => event(R, seq, 'run.started', { attempt: 2 });
const seen = (...events: RunEvent[]) => observeEvents(emptyEvidence(R), events);
const row = (status: RunStatus, lastEventSeq: number) => ({ status, lastEventSeq });

describe('lifecycle markers', () => {
  it('records the actual terminal status and no phase for a start, resume or unsupported finish', () => {
    expect(lifecycleMarker(succeeded(3))).toEqual({ seq: 3, terminal: 'succeeded' });
    expect(
      lifecycleMarker(event(R, 3, 'run.finished', { status: 'exhausted', outcome: 'exhausted' })),
    ).toEqual({ seq: 3, terminal: 'exhausted' });
    expect(lifecycleMarker(failed(4))).toEqual({ seq: 4, terminal: 'failed' });
    expect(lifecycleMarker(event(R, 5, 'run.cancelled', {}))).toEqual({
      seq: 5,
      terminal: 'cancelled',
    });
    expect(
      lifecycleMarker(event(R, 6, 'run.finished', { status: 'running', outcome: 'success' })),
    ).toEqual({ seq: 6 });
    expect(lifecycleMarker(resumed(7))).toEqual({ seq: 7 });
    expect(lifecycleMarker(started(8))).toEqual({ seq: 8 });
    expect(lifecycleMarker(event(R, 9, 'run.paused', { actor }))).toBeUndefined();
    expect(lifecycleMarker(delivered(10))).toBeUndefined();
  });
});

describe('header status', () => {
  it('shows the record until a lifecycle marker is observed', () => {
    expect(headerStatus(emptyEvidence(R), row('running', 9))).toEqual({
      kind: 'record',
      status: 'running',
    });
    expect(headerStatus(seen(delivered(1)), row('queued', 1))).toEqual({
      kind: 'record',
      status: 'queued',
    });
  });

  it('shows an observed outcome over a record at or before it, and the agreeing record as itself', () => {
    const evidence = seen(started(2), succeeded(3));
    const event3 = { kind: 'event', status: 'succeeded', seq: 3 };
    expect(headerStatus(evidence, row('running', 2))).toEqual(event3);
    // The record is written with the terminal sequence before its status is projected.
    expect(headerStatus(evidence, row('running', 3))).toEqual(event3);
    expect(headerStatus(evidence, row('succeeded', 3))).toEqual({
      kind: 'record',
      status: 'succeeded',
    });
    // An earlier attempt's failure is older than the outcome.
    expect(headerStatus(evidence, row('failed', 1))).toEqual(event3);
  });

  it('keeps the outcome through later events it has seen, but not beyond them', () => {
    const evidence = seen(succeeded(3), delivered(4), delivered(5));
    expect(evidence.through).toBe(5);
    expect(headerStatus(evidence, row('running', 5))).toMatchObject({ kind: 'event' });
    // An unseen tail could be a delivery audit or a resume.
    expect(headerStatus(evidence, row('running', 6))).toEqual({ kind: 'updating' });
    // A newer terminal record is shown as recorded rather than latched to the older outcome.
    expect(headerStatus(evidence, row('failed', 9))).toEqual({ kind: 'record', status: 'failed' });
  });

  it('does not extend coverage across a gap', () => {
    const gapped = observeEvents(seen(succeeded(3)), [delivered(5), delivered(6)]);
    expect(gapped.through).toBe(3);
    expect(headerStatus(gapped, row('running', 6))).toEqual({ kind: 'updating' });
    const filled = observeEvents(gapped, [delivered(4), delivered(5), delivered(6)]);
    expect(filled.through).toBe(6);
    expect(headerStatus(filled, row('running', 6))).toMatchObject({ kind: 'event' });
  });

  it('supersedes an outcome at once with a start or resume, without inventing a phase', () => {
    for (const supersede of [resumed(4), started(4)]) {
      const evidence = seen(failed(3), supersede);
      expect(evidence.terminalSeq).toBe(3);
      expect(headerStatus(evidence, row('failed', 3))).toEqual({ kind: 'updating' });
      expect(headerStatus(evidence, row('failed', 4))).toEqual({ kind: 'updating' });
      expect(headerStatus(evidence, row('running', 2))).toEqual({ kind: 'updating' });
      expect(headerStatus(evidence, row('running', 3))).toEqual({ kind: 'updating' });
      // A record that has caught up says where the run is, a parked wait included.
      expect(headerStatus(evidence, row('waiting', 4))).toEqual({
        kind: 'record',
        status: 'waiting',
      });
      expect(headerStatus(evidence, row('running', 4))).toEqual({
        kind: 'record',
        status: 'running',
      });
      // A terminal record beyond what was seen is newer evidence.
      expect(headerStatus(evidence, row('succeeded', 8))).toEqual({
        kind: 'record',
        status: 'succeeded',
      });
    }
    const parked = observeEvents(seen(failed(3), resumed(4)), [
      event(R, 5, 'run.waiting', {
        nodeId: 'w',
        wait: { waitId: 'fixture-wait', startedSeq: 5, nodeId: 'w', kind: 'input' },
      }),
    ]);
    expect(parked.through).toBe(5);
    expect(headerStatus(parked, row('failed', 5))).toEqual({ kind: 'updating' });
  });

  it('leaves an ordinary start, and a finish without a terminal status, to the record', () => {
    expect(headerStatus(seen(started(2)), row('queued', 1))).toEqual({
      kind: 'record',
      status: 'queued',
    });
    const unsupported = seen(
      event(R, 3, 'run.finished', { status: 'running', outcome: 'success' }),
    );
    expect(headerStatus(unsupported, row('running', 3))).toEqual({
      kind: 'record',
      status: 'running',
    });
    expect(headerStatus(unsupported, row('failed', 2))).toEqual({ kind: 'updating' });
  });
});

describe('evidence ordering and identity', () => {
  it('folds batches in sequence order and never lets an older marker undo a newer one', () => {
    const evidence = seen(resumed(4), failed(3));
    expect(evidence.marker).toEqual({ seq: 4 });
    expect(observeEvents(evidence, [failed(3), succeeded(2)])).toBe(evidence);
  });

  it('ignores events of another run', () => {
    expect(observeEvents(emptyEvidence(R), [succeeded(3, OTHER)])).toEqual(emptyEvidence(R));
  });

  it('takes a newer observation lifecycle, ignoring an older, foreign or non-lifecycle one', () => {
    const evidence = seen(succeeded(3), delivered(4));
    expect(observeLifecycle(evidence, undefined)).toBe(evidence);
    expect(observeLifecycle(evidence, started(2))).toBe(evidence);
    expect(observeLifecycle(evidence, succeeded(3))).toBe(evidence);
    expect(observeLifecycle(evidence, succeeded(9, OTHER))).toBe(evidence);
    expect(observeLifecycle(emptyEvidence(R), delivered(4))).toEqual(emptyEvidence(R));
    const newer = observeLifecycle(evidence, resumed(6));
    expect(newer).toEqual({ runId: R, marker: { seq: 6 }, terminalSeq: 3, through: 6 });
    // Streamed events after the observed marker extend its coverage.
    expect(observeEvents(newer, [resumed(6), started(7)]).marker).toEqual({ seq: 7 });
    const observed = observeLifecycle(emptyEvidence(R), succeeded(3));
    expect(headerStatus(observed, row('running', 3))).toMatchObject({ kind: 'event' });
    expect(headerStatus(observed, row('running', 4))).toEqual({ kind: 'updating' });
    expect(observeEvents(observed, [delivered(4)]).through).toBe(4);
  });
});
