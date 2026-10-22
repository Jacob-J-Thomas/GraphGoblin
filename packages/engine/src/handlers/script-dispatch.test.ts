import { describe, expect, it } from 'vitest';
import { RunEventSchema } from '@graphgoblin/contracts';
import { fakeUlid } from '@graphgoblin/contracts/testing';
import type { EventDraft } from '../ports.js';
import { RunFailureError } from '../errors.js';
import { scriptVisit } from './script-dispatch.js';

const runId = fakeUlid('run');
const dispatchId = fakeUlid('dispatch');
const started: EventDraft = {
  type: 'node.started',
  nodeId: 'script',
  kind: 'script',
  attempt: 1,
  configHash: 'x',
};
const dispatched: EventDraft = {
  type: 'script.dispatched',
  nodeId: 'script',
  visitId: `${runId}:1`,
  dispatchId,
};
const failed: EventDraft = {
  type: 'run.failed',
  failure: { code: 'SCRIPT_OUTCOME_UNCERTAIN', message: 'uncertain', resumable: true },
};
const log = (...drafts: EventDraft[]) =>
  drafts.map((draft, index) =>
    RunEventSchema.parse({ ...draft, runId, seq: index + 1, ts: '2026-10-22T00:00:00.000Z' }),
  );

describe('script visit and attempt boundaries', () => {
  it('retains the first start through attempts and failures, then starts a fresh visit after completion', () => {
    expect(scriptVisit(log(started, dispatched, failed, started), runId, 'script')).toBe(
      `${runId}:1`,
    );
    expect(
      scriptVisit(
        log(
          started,
          dispatched,
          { type: 'node.finished', nodeId: 'script', patch: [], durationMs: 0 },
          started,
        ),
        runId,
        'script',
      ),
    ).toBe(`${runId}:4`);
  });
  it('a prior disposed dispatch does not hide an interrupted resumed dispatch or unrelated progress', () => {
    const nextDispatch = { ...dispatched, dispatchId: fakeUlid('next') };
    try {
      scriptVisit(
        log(started, dispatched, failed, started, nextDispatch, {
          type: 'node.progress',
          nodeId: 'script',
          progress: { stdoutBytes: 4, exitCode: 0, stderr: '' },
        }),
        runId,
        'script',
      );
      throw new Error('Expected an uncertainty failure');
    } catch (error) {
      if (!(error instanceof RunFailureError)) throw error;
      expect(error.toFailure()).toMatchObject({
        code: 'SCRIPT_OUTCOME_UNCERTAIN',
        script: {
          dispatchId: nextDispatch.dispatchId,
          visitId: `${runId}:1`,
          state: 'outcome-uncertain',
        },
      });
    }
  });
  it('does not confuse another node with this visit and refuses an absent start', () => {
    expect(
      scriptVisit(
        log(started, { ...started, nodeId: 'other' }, { ...dispatched, nodeId: 'other' }),
        runId,
        'script',
      ),
    ).toBe(`${runId}:1`);
    expect(() => scriptVisit([], runId, 'script')).toThrow('no node.started');
  });
});
