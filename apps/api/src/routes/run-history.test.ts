import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { ContextThread, RunEvent, RunRecord } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { reconcileThread } from '@graphgoblin/domain';
import { historyCursor } from '../run-history.js';
import { createTestApp } from '../testing/test-app.js';

it('browses opaque run-scoped history in both directions and resolves threads beyond the browser window', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gg-wp-e1-186r2-history-'));
  const t = await createTestApp({
    requireApiKey: true,
    env: {
      GG_DATA_DIR: dataDir,
      GG_DB_URL: `file:${join(dataDir, 'history.db').replaceAll('\\', '/')}`,
    },
  });
  try {
    const key = await t.container.repos.apiKeys.create('local', 'reader', ['*']);
    const headers = { authorization: `Bearer ${key.token}` };
    const loopId = await t.publishLoop(minimalLoop(), headers);
    const started = await t.app.inject({
      method: 'POST',
      url: `/loops/${loopId}/runs`,
      payload: {},
      headers,
    });
    const { run } = started.json<{ run: RunRecord }>();
    await t.idle();
    const original = await t.container.repos.events.read(run.id);
    const seed = await t.container.repos.runs.getInitialThread(run.id);
    if (!seed) throw new Error('Missing seed');
    for (let i = 0; i < 350; i++)
      await t.container.repos.events.append(run.id, [
        { type: 'node.started', nodeId: 'work', kind: 'mutate', attempt: 1, configHash: 'h' },
        {
          type: 'node.finished',
          nodeId: 'work',
          patch: [{ op: 'add', path: '/vars/count', value: i + 1 }],
          durationMs: 1,
        },
      ]);
    const all = await t.container.repos.events.read(run.id);
    const total = all.at(-1)!.seq;
    const get = (query: string) =>
      t.app.inject({ url: `/runs/${run.id}/events?${query}`, headers });
    type Page = { items: RunEvent[]; olderCursor: string | null; newerCursor: string | null };
    let page = (await get(`around=${total}&limit=128`)).json<Page>();
    const collected = [...page.items];
    while (page.olderCursor) {
      const response = await get(`cursor=${page.olderCursor}&limit=128`);
      expect(response.statusCode, response.body).toBe(200);
      page = response.json<Page>();
      collected.unshift(...page.items);
    }
    expect(collected).toEqual(all);
    expect(new Set(collected.map((e) => e.seq)).size).toBe(all.length);
    const next = (await get(`cursor=${page.newerCursor}&limit=128`)).json<Page>();
    expect(next.items[0]?.seq).toBe(page.items.at(-1)!.seq + 1);
    // An empty page before the first event continues at event 1, and an empty page past the
    // tail continues back to the tail itself.
    const beforeFirst = (await get('around=0&limit=1')).json<
      Page & { nextAfter: number; hasMore: boolean }
    >();
    expect(beforeFirst).toMatchObject({
      items: [],
      nextAfter: 0,
      hasMore: true,
      olderCursor: null,
    });
    expect((await get(`cursor=${beforeFirst.newerCursor}&limit=1`)).json<Page>().items).toEqual(
      all.slice(0, 1),
    );
    const pastTail = historyCursor({ runId: run.id, seq: total, direction: 'newer' });
    const afterLast = (await get(`cursor=${pastTail}&limit=1`)).json<Page>();
    expect(afterLast).toMatchObject({ items: [], newerCursor: null });
    expect((await get(`cursor=${afterLast.olderCursor}&limit=1`)).json<Page>().items).toEqual(
      all.slice(-1),
    );
    for (const at of [0, 1, original.length, 129, total - 1, total]) {
      const response = await t.app.inject({ url: `/runs/${run.id}/thread?at=${at}`, headers });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<ContextThread>()).toEqual(reconcileThread(seed, all, undefined, at));
    }
    const observation = (await t.app.inject({ url: `/runs/${run.id}/observation`, headers })).json<{
      exit: RunEvent;
      finished: RunEvent;
    }>();
    expect(observation.exit).toEqual(original.findLast((e) => e.type === 'exit.evaluated'));
    expect(observation.finished).toEqual(original.findLast((e) => e.type === 'run.finished'));
    for (const cursor of [
      '',
      '!',
      'x'.repeat(257),
      Buffer.from('{}').toString('base64url'),
      Buffer.from(JSON.stringify({ runId: 'other', seq: 2, direction: 'older' })).toString(
        'base64url',
      ),
    ]) {
      expect((await get(`cursor=${cursor}`)).statusCode).toBe(400);
    }
    const other = await t.container.repos.apiKeys.create('other', 'other', ['runs:read']);
    for (const path of ['events?around=3', 'observation', 'thread?at=3'])
      expect(
        (
          await t.app.inject({
            url: `/runs/${run.id}/${path}`,
            headers: { authorization: `Bearer ${other.token}` },
          })
        ).statusCode,
      ).toBe(404);
    expect(await t.container.repos.events.read(run.id)).toEqual(all);
    // A cursor at the largest safe position still yields a continuation the API accepts.
    const largest = historyCursor({
      runId: run.id,
      seq: Number.MAX_SAFE_INTEGER,
      direction: 'newer',
    });
    const beyond = (await get(`cursor=${largest}&limit=1`)).json<Page>();
    expect(beyond).toMatchObject({ items: [], newerCursor: null });
    const back = await get(`cursor=${beyond.olderCursor}&limit=1`);
    expect(back.statusCode, back.body).toBe(200);
    expect(back.json<Page>().items).toEqual(all.slice(-1));
  } finally {
    await t.close();
  }
});

it('reads the latest cancellation and the request that led to it, whatever history the browser holds', async () => {
  const t = await createTestApp();
  try {
    const loopId = await t.publishLoop(minimalLoop());
    const started = await t.app.inject({
      method: 'POST',
      url: `/loops/${loopId}/runs`,
      payload: {},
    });
    const { run } = started.json<{ run: RunRecord }>();
    await t.idle();
    const observe = async () =>
      (await t.app.inject({ url: `/runs/${run.id}/observation` })).json<{
        cancelled?: RunEvent;
        cancelRequested?: RunEvent;
      }>();
    expect(await observe()).not.toHaveProperty('cancelled');
    // A request that a resume answered does not explain a later cancellation.
    await t.container.repos.events.append(run.id, [
      { type: 'run.cancel_requested', actor: { kind: 'user', id: 'first' } },
      { type: 'run.resumed', actor: { kind: 'user', id: 'first' } },
      { type: 'run.cancelled' },
    ]);
    const unexplained = await observe();
    expect(unexplained.cancelled?.type).toBe('run.cancelled');
    expect(unexplained).not.toHaveProperty('cancelRequested');
    await t.container.repos.events.append(run.id, [
      { type: 'run.resumed', actor: { kind: 'user', id: 'first' } },
      { type: 'run.cancel_requested', actor: { kind: 'api-key', id: 'second' } },
      ...Array.from({ length: 600 }, () => ({
        type: 'node.started' as const,
        nodeId: 'work',
        kind: 'mutate' as const,
        attempt: 1,
        configHash: 'h',
      })),
      { type: 'run.cancelled' },
    ]);
    const explained = await observe();
    expect(explained.cancelRequested).toMatchObject({
      type: 'run.cancel_requested',
      actor: { kind: 'api-key', id: 'second' },
    });
    expect(explained.cancelled!.seq).toBe(explained.cancelRequested!.seq + 601);
    // Fresh-session choices (#265) are whole-run evidence too: the latest 20, oldest first.
    const choice = (failureSeq: number) => ({
      type: 'run.resumed' as const,
      actor: { kind: 'user' as const, id: 'local' },
      freshSession: {
        visitId: `${run.id}:work:1`,
        harness: 'codex' as const,
        origin: 'resume-previous' as const,
        model: 'gpt-6-luna',
        effort: 'low' as const,
        nodeId: 'work',
        failureSeq,
        priorContextCarried: false as const,
      },
    });
    await t.container.repos.events.append(
      run.id,
      Array.from({ length: 22 }, (_, i) => choice(i + 1)),
    );
    const choices = (await t.app.inject({ url: `/runs/${run.id}/observation` })).json<{
      freshSessionChoices: Extract<RunEvent, { type: 'run.resumed' }>[];
    }>().freshSessionChoices;
    expect(choices.map((event) => event.freshSession?.failureSeq)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 3),
    );
  } finally {
    await t.close();
  }
});
