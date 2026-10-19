import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_TS, fakeUlid } from '@graphgoblin/contracts/testing';
import { createTestApp, type TestApp } from '../testing/test-app.js';
import { encodeEventCursor } from '../event-cursor.js';

interface Page {
  items: { id: string; ownerId: string; type: string }[];
  nextCursor: string | null;
}
describe('inbound event paging over real SQLite', () => {
  let t: TestApp;
  let headers: Record<string, string>;
  beforeEach(async () => {
    t = await createTestApp({ requireApiKey: true });
    const key = await t.container.repos.apiKeys.create('local', 'history reader', ['events:read']);
    headers = { authorization: `Bearer ${key.token}` };
  });
  afterEach(async () => t.close());
  async function seed(i: number, overrides = {}) {
    return t.container.repos.inbound.insert({
      id: fakeUlid(`event-page:${i}`),
      ownerId: 'local',
      type: 'chosen',
      source: 'api',
      payload: { index: i },
      receivedAt: FIXTURE_TS,
      runIds: [],
      ...overrides,
    });
  }
  async function page(query = '') {
    const response = await t.app.inject({ url: '/events' + query, headers });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<Page>();
  }
  it('preserves type and before filters across limit-one tied pages, owner scope and exact exhaustion', async () => {
    expect(await page()).toEqual({ items: [], nextCursor: null });
    const records = [];
    for (let i = 0; i < 4; i++) records.push(await seed(i));
    await seed(10, { ownerId: 'other' });
    await seed(11, { type: 'other' });
    await seed(12, { receivedAt: '2026-10-04T00:00:00.000Z' });
    const query = '?type=chosen&before=2026-10-03T00:00:00.000Z&limit=1';
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const next: Page = await page(query + (cursor ? '&cursor=' + cursor : ''));
      seen.push(...next.items.map((event) => event.id));
      cursor = next.nextCursor;
      if (seen.length === 1) await seed(99, { receivedAt: '2026-10-05T00:00:00.000Z' });
    } while (cursor);
    expect(seen).toEqual(
      records
        .map((event) => event.id)
        .sort()
        .reverse(),
    );
    const last = records.find((event) => event.id === seen.at(-1))!;
    expect(await page(query + '&cursor=' + encodeEventCursor(last))).toEqual({
      items: [],
      nextCursor: null,
    });
    const exact = await page('?type=chosen&before=2026-10-03T00:00:00.000Z&limit=4');
    expect(exact.items).toHaveLength(4);
    expect(exact.nextCursor).toBeNull();
    expect((await t.app.inject('/events')).statusCode).toBe(401);
  });
  it('rejects invalid cursors and filter values with typed readable 4xx problems', async () => {
    const valid = { receivedAt: FIXTURE_TS, id: fakeUlid('cursor') };
    const json = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    for (const cursor of [
      '',
      '!',
      'a'.repeat(257),
      'abc',
      json({}),
      json({ ...valid, id: 'bad' }),
      json({ ...valid, receivedAt: 'bad' }),
      json({ ...valid, extra: true }),
      json({ id: valid.id, receivedAt: valid.receivedAt }),
      encodeEventCursor(valid) + '=',
    ]) {
      const response = await t.app.inject({
        url: '/events?cursor=' + encodeURIComponent(cursor),
        headers,
      });
      expect(response.statusCode, cursor).toBe(400);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.json()).toMatchObject({
        code: 'INVALID_CURSOR',
        detail: expect.stringContaining('inbound event listing'),
      });
    }
    for (const query of [
      'limit=0',
      'limit=501',
      'limit=1.5',
      'before=bad',
      'unknown=1',
      'type=' + 'a'.repeat(129),
    ]) {
      const response = await t.app.inject({ url: '/events?' + query, headers });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  });
});
