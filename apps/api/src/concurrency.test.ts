import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { FakeHarness } from '@graphgoblin/engine/testing';
import { singleNodeLoop } from '@graphgoblin/engine/testing';
import type { RunRecord } from '@graphgoblin/contracts';
import { createTestApp } from './testing/test-app.js';

function barrier() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('admits three identities to real SQLite, runs at cap two, then starts the queued identity after completion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gg-wp-a5b-cap-'));
  const started = Array.from({ length: 3 }, () => barrier());
  const releases: (() => void)[] = [];
  let active = 0;
  let maximum = 0;
  class BarrierHarness extends FakeHarness {
    override start(...args: Parameters<FakeHarness['start']>): ReturnType<FakeHarness['start']> {
      const session = super.start(...args);
      const index = releases.length;
      active++;
      maximum = Math.max(maximum, active);
      const gate = barrier();
      let released = false;
      releases.push(() => {
        if (!released) {
          released = true;
          active--;
          gate.resolve();
        }
      });
      started[index]!.resolve();
      return { ...session, result: gate.promise.then(() => session.result) };
    }
  }
  const fixture = await createTestApp({
    env: {
      GG_DB_URL: `file:${join(directory, 'cap.db').replaceAll('\\', '/')}`,
      GG_MAX_CONCURRENT_RUNS: '2',
    },
    harnesses: { codex: new BarrierHarness() },
  });
  try {
    const loopId = await fixture.publishLoop(
      singleNodeLoop('sqlite-cap', {
        id: 'infer',
        kind: 'inference',
        label: 'Work',
        config: { prompt: { template: 'go' } },
      }),
    );
    const run = async () => {
      const response = await fixture.app.inject({
        method: 'POST',
        url: `/loops/${loopId}/runs`,
        payload: {},
      });
      expect(response.statusCode).toBe(202);
      return response.json<{ run: RunRecord }>().run;
    };
    const a = await run();
    const b = await run();
    await Promise.all([started[0]!.promise, started[1]!.promise]);
    const c = await run();
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    expect((await fixture.container.repos.runs.get(c.id))?.status).toBe('queued');
    expect(active).toBe(2);
    expect(releases).toHaveLength(2);
    fixture.clock.advance(1000);
    releases[0]!();
    await started[2]!.promise;
    expect(
      await Promise.all(
        [a, b].map(async ({ id }) => (await fixture.container.repos.runs.get(id))?.status),
      ),
    ).toEqual(expect.arrayContaining(['succeeded', 'running']));
    expect(active).toBe(2);
    expect(maximum).toBe(2);
    releases[1]!();
    releases[2]!();
    await fixture.idle();
    for (const id of [a.id, b.id, c.id])
      expect((await fixture.container.repos.runs.get(id))?.status).toBe('succeeded');
    expect(active).toBe(0);
    expect(await fixture.container.repos.runs.list({ loopId })).toHaveLength(3);
  } finally {
    for (const release of releases) release();
    await fixture.idle();
    await fixture.close();
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
});
