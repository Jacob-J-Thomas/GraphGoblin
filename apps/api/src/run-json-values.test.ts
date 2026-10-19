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

async function fileApp() {
  const dir = await mkdtemp(join(tmpdir(), 'gg-api-json-values-'));
  directories.push(dir);
  const env = { GG_DB_URL: `file:${join(dir, 'store.db').replaceAll('\\', '/')}` };
  const t = await createTestApp({ env });
  apps.push(t);
  return {
    t,
    reopen: async () => {
      await t.close();
      apps.splice(apps.indexOf(t), 1);
      const next = await createTestApp({ env });
      apps.push(next);
      return next;
    },
  };
}

const cases: { name: string; returns: string; value: JsonValue | undefined }[] = [
  { name: 'absent', returns: 'none', value: undefined },
  { name: 'null', returns: 'null', value: null },
  { name: 'false', returns: 'false', value: false },
  { name: 'zero', returns: '0', value: 0 },
  { name: 'empty string', returns: "''", value: '' },
  { name: 'array', returns: '[]', value: [] },
  { name: 'object', returns: '{}', value: {} },
  { name: 'nested null', returns: '{"inner": null}', value: { inner: null } },
];

describe('run result snapshots over file SQLite', () => {
  it.each(cases)(
    'preserves $name through execution, rejected updates and reopen',
    async ({ name, returns, value }) => {
      const { t, reopen } = await fileApp();
      const definition = minimalLoop();
      definition.name = `JSON result ${name}`;
      definition.nodes[1] = { id: 'done', kind: 'exit', label: 'Done', config: { returns } };
      const loopId = await t.publishLoop(definition);
      const response = await t.app.inject({
        method: 'POST',
        url: `/loops/${loopId}/runs`,
        payload: {},
      });
      expect(response.statusCode).toBe(202);
      const { run } = response.json<{ run: RunRecord }>();
      await t.idle();
      const verify = async (app: TestApp) => {
        const snapshot = await app.app.inject({ method: 'GET', url: `/runs/${run.id}` });
        expect(snapshot.statusCode).toBe(200);
        const stored = snapshot.json<RunRecord>();
        expect(stored.status).toBe('succeeded');
        expect(stored.result).toEqual(value);
        expect(Object.hasOwn(stored, 'result')).toBe(value !== undefined);
      };
      await verify(t);
      await expect(
        t.container.repos.runs.update(run.id, { iteration: 0, result: 'rejected' }),
      ).rejects.toThrow();
      await verify(t);
      await verify(await reopen());
    },
  );

  it('preserves settings null and falsy JSON values across reopen', async () => {
    const { t, reopen } = await fileApp();
    const settings = { nil: null, no: false, zero: 0, empty: '', array: [], object: {} };
    const saved = await t.app.inject({ method: 'PUT', url: '/settings', payload: settings });
    expect(saved.statusCode).toBe(200);
    expect((await t.app.inject('/settings')).json()).toMatchObject(settings);
    expect((await (await reopen()).app.inject('/settings')).json()).toMatchObject(settings);
  });
});
