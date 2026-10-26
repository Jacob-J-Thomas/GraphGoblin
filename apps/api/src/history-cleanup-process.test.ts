import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import type { DeletionPreview, RunRecord } from '@graphgoblin/contracts';
import { singleNodeLoop } from '@graphgoblin/engine/testing';
import { createTestApp, type TestApp } from './testing/test-app.js';

it.each(['prepared', 'quarantined'] as const)(
  'recovers durable resource jobs after a real process dies at %s',
  async (boundary) => {
    const directory = await mkdtemp(join(tmpdir(), 'gg-wp-e3-'));
    const dbUrl = `file:${join(directory, 'history.db').replaceAll('\\', '/')}`;
    let api: TestApp | undefined;
    try {
      api = await createTestApp({
        tempPrefix: 'gg-wp-e3-',
        env: { GG_DATA_DIR: directory, GG_DB_URL: dbUrl },
      });
      const loop = await api.publishLoop(
        singleNodeLoop('Crash cleanup', {
          id: 'infer',
          kind: 'inference',
          label: 'Infer',
          config: { prompt: { template: 'Hello' }, output: { captureTranscript: 'artifact' } },
        }),
      );
      const response = await api.app.inject({
        method: 'POST',
        url: `/loops/${loop}/runs`,
        payload: {},
      });
      const run = response.json<{ run: RunRecord }>().run;
      await api.idle();
      const workspace = api.harness.started[0]!.workingDirectory;
      await writeFile(join(workspace, 'result'), 'crash boundary');
      const preview = await api.app.inject({
        method: 'POST',
        url: '/runs/deletion-eligibility/preview',
        payload: { runIds: [run.id] },
      });
      expect(
        (
          await api.app.inject({
            method: 'POST',
            url: '/runs/deletion-eligibility',
            payload: {
              runIds: [run.id],
              action: 'mark',
              confirmed: true,
              token: preview.json<DeletionPreview>().token,
            },
          })
        ).statusCode,
      ).toBe(200);
      await api.close();
      api = undefined;
      globalThis.gc?.();
      // API subprocess gates build workspace runtime exports first, as for the other process tests.
      const sqlite = pathToFileURL(
        join(process.cwd(), '../../packages/infrastructure/dist/sqlite/index.js'),
      ).href;
      const fs = pathToFileURL(
        join(process.cwd(), '../../packages/infrastructure/dist/fs/index.js'),
      ).href;
      const helper = join(directory, 'interrupted.mjs');
      await writeFile(
        helper,
        `const { openDatabase, SqliteRunResources, SqliteHistoryCleanup } = await import(process.argv[2]);
const { OwnedRunResources } = await import(process.argv[3]);
const handle = openDatabase({url: process.argv[4]});
const files = new OwnedRunResources(process.argv[5], new SqliteRunResources(handle.db));
const deleted = await new SqliteHistoryCleanup(handle.db, files).prepareBatch('local');
${boundary === 'prepared' ? '' : `await new SqliteHistoryCleanup(handle.db, { exclusive: f => files.exclusive(f), inspect: r => files.inspect(r), stage: (r,p) => files.stage(r,p), remove: async () => { process.stdout.write('PREPARED ' + deleted + '\\n', () => process.kill(process.pid, 'SIGKILL')); await new Promise(() => {}); } }).reapBatch();`}
process.stdout.write('PREPARED ' + deleted + '\\n', () => process.kill(process.pid, 'SIGKILL'));
`,
        'utf8',
      );
      const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
        (resolve, reject) => {
          const child = spawn(process.execPath, [helper, sqlite, fs, dbUrl, directory], {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          let stdout = '',
            stderr = '';
          child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
            stdout += chunk;
          });
          child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
            stderr += chunk;
          });
          child.once('error', reject);
          child.once('close', (code) => resolve({ code, stdout, stderr }));
        },
      );
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('PREPARED 1');
      expect(result.code).not.toBe(0);
      expect((await lstat(workspace)).isDirectory()).toBe(true);
      api = await createTestApp({
        tempPrefix: 'gg-wp-e3-',
        env: { GG_DATA_DIR: directory, GG_DB_URL: dbUrl },
        storageCapacity: {
          read: () => Promise.resolve({ totalBytes: 100 * 1024 ** 3, availableBytes: 0 }),
        },
      });
      expect((await api.app.inject(`/runs/${run.id}`)).statusCode).toBe(404);
      await expect(lstat(workspace)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(api.container.historyCleanup.status()).toMatchObject({
        state: 'pressure',
        pendingResources: 0,
      });
      expect((await api.container.repos.runs.page({ ownerId: 'local' })).items).toEqual([]);
    } finally {
      await api?.close();
      globalThis.gc?.();
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  },
  60_000,
);
