import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { JsonValue, RunRecord } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { createTestApp, type TestApp } from './testing/test-app.js';

const apps: TestApp[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  global.gc?.();
  for (const dir of directories.splice(0))
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('run result snapshots over file SQLite', () => {
  it('keeps absent and every JSON result distinct after execution, rejected updates and reopen', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gg-api-json-values-'));
    directories.push(dir);
    const env = { GG_DB_URL: `file:${join(dir, 'store.db').replaceAll('\\', '/')}` };
    const t = await createTestApp({ env });
    apps.push(t);
    const cases: { returns: string; value: JsonValue | undefined }[] = [
      { returns: 'none', value: undefined },
      { returns: 'null', value: null },
      { returns: 'false', value: false },
      { returns: '0', value: 0 },
      { returns: "''", value: '' },
      { returns: '[]', value: [] },
      { returns: '{}', value: {} },
      { returns: '{"inner": null}', value: { inner: null } },
    ];
    const runs: { id: string; value: JsonValue | undefined }[] = [];
    for (const [index, entry] of cases.entries()) {
      const definition = minimalLoop();
      definition.name = `JSON result ${index}`;
      definition.nodes[1] = {
        id: 'done',
        kind: 'exit',
        label: 'Done',
        config: { returns: entry.returns },
      };
      const loopId = await t.publishLoop(definition);
      const response = await t.app.inject({
        method: 'POST',
        url: `/loops/${loopId}/runs`,
        payload: {},
      });
      expect(response.statusCode).toBe(202);
      const { run } = response.json<{ run: RunRecord }>();
      runs.push({ id: run.id, value: entry.value });
    }
    await t.idle();
    const verify = async (app: TestApp) => {
      for (const { id, value } of runs) {
        const snapshot = await app.app.inject({ method: 'GET', url: `/runs/${id}` });
        expect(snapshot.statusCode).toBe(200);
        const run = snapshot.json<RunRecord>();
        expect(run.status).toBe('succeeded');
        expect(run.result).toEqual(value);
        expect(Object.hasOwn(run, 'result')).toBe(value !== undefined);
      }
    };
    const settings = { nil: null, no: false, zero: 0, empty: '', array: [], object: {} };
    const saved = await t.app.inject({ method: 'PUT', url: '/settings', payload: settings });
    expect(saved.statusCode).toBe(200);
    expect((await t.app.inject('/settings')).json()).toMatchObject(settings);
    await verify(t);
    const id = runs[1]!.id;
    await expect(
      t.container.repos.runs.update(id, { iteration: 0, result: 'rejected' }),
    ).rejects.toThrow();
    await verify(t);
    await t.close();
    apps.splice(apps.indexOf(t), 1);
    const reopened = await createTestApp({ env });
    apps.push(reopened);
    await verify(reopened);
    expect((await reopened.app.inject('/settings')).json()).toMatchObject(settings);
  });
});
