import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunRecord } from '@graphgoblin/contracts';
import { FIXTURE_TS, fakeUlid, sampleThread } from '@graphgoblin/contracts/testing';
import { createTestApp, type TestApp } from '../testing/test-app.js';
import { decodeRunCursor, encodeRunCursor } from '../run-cursor.js';

interface Page {
  items: RunRecord[];
  nextCursor: string | null;
}

describe('ordinary run paging', () => {
  let t: TestApp;
  let headers: Record<string, string>;
  beforeEach(async () => {
    t = await createTestApp({ requireApiKey: true });
    const key = await t.container.repos.apiKeys.create('local', 'reader', ['runs:read']);
    headers = { authorization: 'Bearer ' + key.token };
  });
  afterEach(async () => t.close());

  async function seed(index: number, overrides: Partial<RunRecord> = {}) {
    const run: RunRecord = {
      id: fakeUlid('page-run:' + index),
      ownerId: 'local',
      loopId: fakeUlid('page-loop'),
      versionId: fakeUlid('page-version'),
      invocationId: fakeUlid('page-invocation:' + index),
      status: 'succeeded',
      iteration: 1,
      lastEventSeq: 0,
      createdAt: FIXTURE_TS,
      ...overrides,
    };
    await t.container.repos.runs.create(run, sampleThread());
    return run;
  }

  async function page(query = '', auth = headers): Promise<Page> {
    const response = await t.app.inject({ method: 'GET', url: '/runs' + query, headers: auth });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<Page>();
  }

  it('returns an empty final page', async () => {
    expect(await page()).toEqual({ items: [], nextCursor: null });
  });

  it('pages tied timestamps exactly once despite a newer insertion between requests', async () => {
    const records = [];
    for (let i = 0; i < 7; i++) records.push(await seed(i));
    records.sort((a, b) => b.id.localeCompare(a.id));
    const expected = (await t.container.repos.runs.list({ ownerId: 'local', limit: 500 })).map(
      (r) => r.id,
    );
    const first = await page('?limit=2');
    expect(first.items.map((r) => r.id)).toEqual(expected.slice(0, 2));
    expect(decodeRunCursor(first.nextCursor!)).toEqual({
      createdAt: FIXTURE_TS,
      id: records[1]!.id,
    });
    await seed(99, { createdAt: '2026-10-03T12:00:00.000Z' });
    await seed(100, { id: 'Z'.repeat(26) });
    const seen = first.items.map((r) => r.id);
    let cursor = first.nextCursor;
    while (cursor) {
      const next = await page('?limit=2&cursor=' + cursor);
      seen.push(...next.items.map((r) => r.id));
      cursor = next.nextCursor;
    }
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(records.length);
  });

  it('returns 500 items plus a cursor for the lookahead row and then a final null cursor', async () => {
    for (let i = 0; i < 501; i++) await seed(i);
    const first = await page('?limit=500');
    expect(first.items).toHaveLength(500);
    expect(first.nextCursor).toBeTypeOf('string');
    const last = await page('?limit=500&cursor=' + first.nextCursor);
    expect(last.items).toHaveLength(1);
    expect(last.nextCursor).toBeNull();
    expect(new Set([...first.items, ...last.items].map((r) => r.id)).size).toBe(501);
    expect(await page('?limit=500&cursor=' + encodeRunCursor(last.items[0]!))).toEqual({
      items: [],
      nextCursor: null,
    });
    const defaults = await page();
    expect(defaults.items).toHaveLength(100);
    expect(defaults.nextCursor).toBeTypeOf('string');
  });

  it('returns a null cursor for an exactly full final page', async () => {
    await seed(0);
    await seed(1);
    expect(await page('?limit=2')).toMatchObject({ items: [{}, {}], nextCursor: null });
  });

  it('applies each ordinary filter and their intersection', async () => {
    const parent = await seed(0, { createdAt: '2026-10-01T12:00:00.000Z' });
    const child = await seed(1, { status: 'failed', parentRunId: parent.id });
    const other = await seed(2, { loopId: fakeUlid('other-loop'), status: 'cancelled' });
    const cases: [string, string[]][] = [
      ['loopId=' + parent.loopId, [parent.id, child.id]],
      ['status=failed,%20cancelled', [child.id, other.id]],
      ['parent=' + parent.id, [child.id]],
      ['parent=none', [parent.id, other.id]],
      ['before=' + FIXTURE_TS, [parent.id]],
      [
        'loopId=' +
          parent.loopId +
          '&status=failed&parent=' +
          parent.id +
          '&before=2026-10-03T00:00:00.000Z',
        [child.id],
      ],
    ];
    for (const [query, ids] of cases)
      expect(new Set((await page('?' + query)).items.map((r) => r.id)), query).toEqual(
        new Set(ids),
      );
  });

  it.each([
    '2026-10-02T14:00:00.000+02:00',
    '2026-10-02T07:00:00.000-05:00',
    '2026-10-02T12:00:00Z',
  ])('normalizes before=%s to the canonical timestamp page', async (before) => {
    await seed(0, { createdAt: '2026-10-02T11:59:59.998Z' });
    const lastBefore = await seed(1, { createdAt: '2026-10-02T11:59:59.999Z' });
    await seed(2);
    await seed(3, { createdAt: '2026-10-02T12:00:00.001Z' });
    const canonical = await page('?before=' + FIXTURE_TS + '&limit=1');
    expect(canonical.items.map((r) => r.id)).toEqual([lastBefore.id]);
    expect(canonical.nextCursor).toBeTypeOf('string');
    expect(await page('?before=' + encodeURIComponent(before) + '&limit=1')).toEqual(canonical);
  });

  it('publishes the cursor description and bound in OpenAPI', async () => {
    const response = await t.app.inject({ method: 'GET', url: '/openapi.json' });
    expect(response.statusCode).toBe(200);
    const document = response.json<{
      paths: {
        '/runs': {
          get: {
            parameters: {
              name: string;
              description?: string;
              schema: { type: string; maxLength?: number };
            }[];
          };
        };
      };
    }>();
    expect(document.paths['/runs'].get.parameters.find((p) => p.name === 'cursor')).toMatchObject({
      description: 'Opaque run cursor, at most 256 base64url characters.',
      required: false,
      schema: { type: 'string', maxLength: 256 },
    });
  });

  it('scopes every page and snapshot to the authenticated owner', async () => {
    const mine = await seed(0);
    const foreign = await seed(1, { ownerId: 'other' });
    expect((await page('?limit=1')).items.map((r) => r.id)).toEqual([mine.id]);
    expect((await page('?limit=1')).nextCursor).toBeNull();
    expect(
      (await t.app.inject({ method: 'GET', url: '/runs/' + foreign.id, headers })).statusCode,
    ).toBe(404);
    const other = await t.container.repos.apiKeys.create('other', 'other reader', ['runs:read']);
    expect(
      (await page('', { authorization: 'Bearer ' + other.token })).items.map((r) => r.id),
    ).toEqual([foreign.id]);
    expect(
      (await page('?cursor=' + encodeRunCursor(mine))).items.every((r) => r.ownerId === 'local'),
    ).toBe(true);
    expect((await t.app.inject({ method: 'GET', url: '/runs' })).statusCode).toBe(401);
  });

  it('lists and reads canonical records with no template table or subject column', async () => {
    const run = await seed(0);
    expect((await page()).items).toEqual([run]);
    const snapshot = await t.app.inject({ method: 'GET', url: '/runs/' + run.id, headers });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json()).toEqual(run);
    expect(
      (
        await t.container.handle.client.execute(
          "SELECT name FROM sqlite_master WHERE name LIKE 'template_%'",
        )
      ).rows,
    ).toEqual([]);
    expect(
      (await t.container.handle.client.execute('PRAGMA table_info(runs)')).rows.map(
        (row) => row.name,
      ),
    ).not.toContain('template_subject');
  });

  it('rejects malformed, oversized, noncanonical and non-strict cursors with INVALID_CURSOR', async () => {
    const valid = { createdAt: FIXTURE_TS, id: fakeUlid('cursor') };
    const json = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const cursor = encodeRunCursor(valid);
    for (const invalid of [
      '',
      '!',
      'a'.repeat(257),
      'abc',
      json({}),
      json({ ...valid, id: 'bad' }),
      json({ ...valid, createdAt: 'bad' }),
      json({ ...valid, extra: true }),
      json({ id: valid.id, createdAt: valid.createdAt }),
      cursor + '=',
      cursor.slice(0, -1) + String.fromCharCode(cursor.charCodeAt(cursor.length - 1) + 1),
      Buffer.from(' ' + JSON.stringify(valid)).toString('base64url'),
      Buffer.from('{"createdAt":"bad",' + JSON.stringify(valid).slice(1)).toString('base64url'),
    ]) {
      const response = await t.app.inject({
        method: 'GET',
        url: '/runs?cursor=' + encodeURIComponent(invalid),
        headers,
      });
      expect(response.statusCode, invalid).toBe(400);
      expect(response.json()).toMatchObject({ code: 'INVALID_CURSOR' });
    }
  });

  it.each([
    ['repository', 'example/project'],
    ['issue', '7'],
    ['pullRequest', '12'],
    ['head', 'a'.repeat(40)],
    ['mergeSha', 'b'.repeat(40)],
    ['templateInstanceId', fakeUlid('retired-instance')],
  ])('rejects the removed %s filter instead of widening results', async (key, value) => {
    await seed(0);
    const response = await t.app.inject({
      method: 'GET',
      url: '/runs?' + key + '=' + encodeURIComponent(value),
      headers,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [{ path: '/' + key }],
    });
  });

  it('rejects before with cursor and invalid ordinary filters or limits', async () => {
    const cursor = encodeRunCursor({ createdAt: FIXTURE_TS, id: fakeUlid('cursor') });
    for (const query of [
      'cursor=' + cursor + '&before=' + FIXTURE_TS,
      'limit=0',
      'limit=501',
      'limit=1.5',
      'status=unknown',
      'status=failed,unknown',
      'status=',
      'parent=bad',
      'loopId=bad',
      'before=bad',
    ]) {
      const response = await t.app.inject({ method: 'GET', url: '/runs?' + query, headers });
      expect(response.statusCode, query).toBe(400);
      expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  });
});
