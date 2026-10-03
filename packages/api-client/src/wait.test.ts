import { describe, expect, it } from 'vitest';
import { FIXTURE_IDS, FIXTURE_TS } from '@graphgoblin/contracts/testing';
import { createGraphGoblinClient, waitForRun, type FetchLike } from './index.js';

function snapshot(status: string) {
  return {
    id: FIXTURE_IDS.run,
    ownerId: 'local',
    loopId: FIXTURE_IDS.loop,
    versionId: FIXTURE_IDS.version,
    invocationId: FIXTURE_IDS.invocation,
    status,
    iteration: 1,
    createdAt: FIXTURE_TS,
    lastEventSeq: 1,
  };
}

/** Answers `GET /runs/{id}` with each status in turn, repeating the last one. */
function statuses(...sequence: string[]): { fetch: FetchLike; calls: () => number } {
  let calls = 0;
  const fetch: FetchLike = () => {
    const status = sequence[Math.min(calls, sequence.length - 1)]!;
    calls += 1;
    return Promise.resolve(Response.json(snapshot(status)));
  };
  return { fetch, calls: () => calls };
}

describe('waitForRun', () => {
  it('polls until a terminal status', async () => {
    const { fetch, calls } = statuses('queued', 'running', 'failed');
    const delays: number[] = [];
    const result = await waitForRun(
      createGraphGoblinClient({ baseUrl: 'http://api', fetch }),
      FIXTURE_IDS.run,
      {
        timeoutMs: 10_000,
        sleep: (ms) => {
          delays.push(ms);
          return Promise.resolve();
        },
      },
    );
    expect(result.finished).toBe(true);
    expect(result.run.status).toBe('failed');
    expect(calls()).toBe(3);
    expect(delays).toEqual([1000, 1000]);
  });

  it('returns the latest snapshot when the timeout elapses, never sleeping past it', async () => {
    const { fetch } = statuses('waiting');
    let clock = 0;
    const delays: number[] = [];
    const result = await waitForRun(
      createGraphGoblinClient({ baseUrl: 'http://api', fetch }),
      FIXTURE_IDS.run,
      {
        timeoutMs: 250,
        pollMs: 100,
        now: () => clock,
        sleep: (ms) => {
          delays.push(ms);
          clock += ms;
          return Promise.resolve();
        },
      },
    );
    expect(result).toMatchObject({ finished: false, run: { status: 'waiting' } });
    expect(delays).toEqual([100, 100, 50]);
  });

  it('uses the real clock and timer by default', async () => {
    const { fetch } = statuses('running');
    const result = await waitForRun(
      createGraphGoblinClient({ baseUrl: 'http://api', fetch }),
      FIXTURE_IDS.run,
      { timeoutMs: 20, pollMs: 5 },
    );
    expect(result.finished).toBe(false);
  });

  it('rejects with the abort reason when the signal fires', async () => {
    const { fetch } = statuses('running');
    const controller = new AbortController();
    const pending = waitForRun(
      createGraphGoblinClient({ baseUrl: 'http://api', fetch }),
      FIXTURE_IDS.run,
      { timeoutMs: 60_000, pollMs: 60_000, signal: controller.signal },
    );
    setTimeout(() => controller.abort(new Error('stop waiting')), 5);
    await expect(pending).rejects.toThrow('stop waiting');
  });
});
