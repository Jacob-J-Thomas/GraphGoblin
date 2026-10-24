import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunEvent, RunRecord } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { createTestApp, type TestApp } from '../testing/test-app.js';

describe('run-event page boundaries over file-backed SQLite', () => {
  let t: TestApp;
  let dataDir: string;
  let runId: string;
  let original: string;
  let headers: Record<string, string>;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'gg-wp-g2-lookahead-'));
    t = await createTestApp({
      requireApiKey: true,
      env: {
        GG_DATA_DIR: dataDir,
        GG_DB_URL: `file:${join(dataDir, 'history.db').replaceAll('\\', '/')}`,
      },
    });
    const key = await t.container.repos.apiKeys.create('local', 'history', ['*']);
    headers = { authorization: `Bearer ${key.token}` };
    const loopId = await t.publishLoop(minimalLoop(), headers);
    const started = await t.app.inject({
      method: 'POST',
      url: `/loops/${loopId}/runs`,
      payload: {},
      headers,
    });
    expect(started.statusCode).toBe(202);
    runId = started.json<{ run: RunRecord }>().run.id;
    await t.idle();
    expect((await t.app.inject({ url: `/runs/${runId}`, headers })).json()).toMatchObject({
      status: 'succeeded',
    });
    const stored = await t.container.handle.client.execute({
      sql: 'SELECT type, payload FROM run_events WHERE run_id = ? AND seq = 2',
      args: [runId],
    });
    expect(stored.rows[0]?.['type']).toBe('run.started');
    const payload = stored.rows[0]?.['payload'];
    if (typeof payload !== 'string') throw new Error('Expected the stored event JSON text');
    original = payload;
  });

  afterEach(async () => {
    await t.close();
    global.gc?.();
    await rm(dataDir, { recursive: true, force: true });
  });

  function page(after: number, limit: number) {
    return t.app.inject({ url: `/runs/${runId}/events?after=${after}&limit=${limit}`, headers });
  }

  async function damage(payload: string) {
    await t.container.handle.client.execute({
      sql: 'UPDATE run_events SET payload = ? WHERE run_id = ? AND seq = 2',
      args: [payload, runId],
    });
  }

  it.each(['{}', '{invalid-json'])(
    'returns the unchanged requested page when only its lookahead payload is %s',
    async (payload) => {
      const healthy = await page(0, 1);
      expect(healthy.statusCode).toBe(200);
      expect(healthy.json()).toMatchObject({ items: [{ seq: 1 }], nextAfter: 1, hasMore: true });
      await damage(payload);
      const response = await page(0, 1);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual(healthy.json());
      await damage(original);
      expect((await page(0, 1)).json()).toEqual(healthy.json());
    },
  );

  it.each([
    [1, 1],
    [0, 3],
  ])('reports corruption inside the requested page after=%i limit=%i', async (after, limit) => {
    await damage('{}');
    const response = await page(after, limit);
    expect(response.statusCode).toBe(500);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({
      code: 'STORED_EVENT_INVALID',
      detail: `Stored run event does not conform: run ${runId}, seq 2, type run.started`,
    });
    expect(response.json()).not.toHaveProperty('items');
  });

  it('uses sequence existence through exhaustion and retains owner scoping', async () => {
    const all = (await page(0, 1000)).json<{ items: RunEvent[]; hasMore: boolean }>();
    expect(all.items.length).toBeGreaterThan(2);
    expect(all.hasMore).toBe(false);
    const last = all.items.at(-1)!.seq;
    expect((await page(last - 1, 1)).json()).toMatchObject({
      items: [{ seq: last }],
      nextAfter: last,
      hasMore: false,
    });
    expect((await page(last, 1)).json()).toEqual({ items: [], nextAfter: last, hasMore: false });
    const other = await t.container.repos.apiKeys.create('other', 'other reader', ['runs:read']);
    const forbidden = await t.app.inject({
      url: `/runs/${runId}/events?limit=1`,
      headers: { authorization: `Bearer ${other.token}` },
    });
    expect(forbidden.statusCode).toBe(404);
  });
});
