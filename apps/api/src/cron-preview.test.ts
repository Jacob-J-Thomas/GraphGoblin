import { afterEach, describe, expect, it } from 'vitest';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { CronScheduler } from '@graphgoblin/infrastructure/scheduler';
import { createTestApp, type TestApp } from './testing/test-app.js';

let t: TestApp;
afterEach(async () => {
  await t.close();
});
const url = '/triggers/cron/preview';
const base = { expression: '0 9 * * *', timezone: 'Europe/London' };

describe('cron preview endpoint', () => {
  it('equals the scheduler across the March DST boundary without arming anything', async () => {
    t = await createTestApp();
    const from = '2026-03-27T10:00:00.000Z';
    const result = await t.app.inject({ method: 'POST', url, payload: { ...base, from } });
    expect(result.statusCode).toBe(200);
    const expected: string[] = [];
    let after = new Date(from);
    for (let i = 0; i < 5; i++) {
      after = CronScheduler.nextFire(base.expression, base.timezone, after)!;
      expected.push(after.toISOString());
    }
    expect(result.json()).toEqual({ next: expected });
    expect(expected.slice(0, 2)).toEqual(['2026-03-28T09:00:00.000Z', '2026-03-29T08:00:00.000Z']);
    expect(await t.container.repos.loops.listLoops('local')).toEqual([]);
  });
  it('uses the server clock by default, supports seconds, and bounds the count', async () => {
    t = await createTestApp();
    const expression = '*/5 * * * * *';
    const response = await t.app.inject({
      method: 'POST',
      url,
      payload: { expression, timezone: 'UTC', count: 1 },
    });
    expect(response.json()).toEqual({
      next: [CronScheduler.nextFire(expression, 'UTC', t.clock.now())!.toISOString()],
    });
    const ten = await t.app.inject({ method: 'POST', url, payload: { ...base, count: 10 } });
    expect(ten.json<{ next: string[] }>().next).toHaveLength(10);
    const none = await t.app.inject({
      method: 'POST',
      url,
      payload: { expression: '0 0 0 1 1 * 2000', timezone: 'UTC' },
    });
    expect(none.json()).toEqual({ next: [] });
  });
  it.each([
    { expression: 'not cron' },
    { expression: '' },
    { timezone: 'Mars/Olympus' },
    { timezone: '' },
  ])('returns CRON_INVALID for %j', async (override) => {
    t = await createTestApp();
    const response = await t.app.inject({ method: 'POST', url, payload: { ...base, ...override } });
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ code: 'CRON_INVALID', status: 400 });
  });
  it.each([
    { count: 0 },
    { count: 11 },
    { count: 1.5 },
    { from: 'tomorrow' },
    { unexpected: true },
  ])('rejects malformed requests: %j', async (override) => {
    t = await createTestApp();
    const response = await t.app.inject({ method: 'POST', url, payload: { ...base, ...override } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it('keeps the CRON_INVALID issue on validate and publish', async () => {
    t = await createTestApp();
    const definition = minimalLoop();
    definition.nodes[0] = {
      id: 'start',
      kind: 'trigger',
      label: 'Start',
      config: { subtype: 'cron', expression: 'bad', timezone: 'UTC' },
    };
    const created = await t.app.inject({ method: 'POST', url: '/loops', payload: { definition } });
    const id = created.json<{ loop: { id: string } }>().loop.id;
    const validate = await t.app.inject({
      method: 'POST',
      url: `/loops/${id}/validate`,
      payload: { definition },
    });
    expect(validate.json<{ issues: { code: string }[] }>().issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'CRON_INVALID' })]),
    );
    const publish = await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` });
    expect(publish.statusCode).toBe(422);
    expect(publish.body).toContain('CRON_INVALID');
  });
});
