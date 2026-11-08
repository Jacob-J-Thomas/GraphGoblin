import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeHarness } from '@graphgoblin/engine/testing';
import type { ModelCatalogEntry } from '@graphgoblin/contracts';
import type { HarnessPort } from '@graphgoblin/engine';
import {
  DEFAULT_MODEL_CATALOG,
  SqliteModelCatalog,
  SqliteOllamaRepository,
  openDatabase,
} from '@graphgoblin/infrastructure/sqlite';
import { readinessDetail } from '@graphgoblin/domain';
import { buildApp } from './app.js';
import { createContainer } from './container.js';
import { loadConfig } from './config.js';
import {
  configPreflightSources,
  runPreflight,
  type PreflightReport,
  type PreflightSources,
} from './preflight.js';

const KEY = Buffer.alloc(32, 7).toString('base64');
const MODEL = 'namespace/qwen:exact-tag';
const AT = '2026-11-08T00:00:00.000Z';
const ready = { state: 'ready' as const, ok: true, authenticated: true, problems: [] };
const at = (report: PreflightReport, id: string) => report.checks.find((check) => check.id === id);
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gg-ollama-preflight-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});
function stubCli(
  harnesses: Partial<Record<'codex' | 'claude' | 'ollama', HarnessPort>>,
  codexReady = true,
) {
  if (!harnesses.codex || !harnesses.claude)
    throw new Error('Expected the native container harness map');
  vi.spyOn(harnesses.codex, 'preflight').mockResolvedValue(
    codexReady
      ? ready
      : { state: 'cli-missing', ok: false, problems: ['Codex fixture unavailable'] },
  );
  vi.spyOn(harnesses.claude, 'preflight').mockResolvedValue({
    state: 'cli-missing',
    ok: false,
    problems: ['Claude fixture unavailable'],
  });
}
function metadata(online = true) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    if (!online) return Promise.reject(new Error('Fixture service offline'));
    const path = typeof url === 'string' ? url : 'url' in url ? url.url : url.href;
    return Promise.resolve(
      new Response(
        JSON.stringify(
          path.endsWith('/api/tags')
            ? { models: [{ model: MODEL, digest: 'sha256:fixture' }] }
            : { capabilities: ['completion'] },
        ),
      ),
    );
  });
}
function env(defaults?: { byHarness: { ollama: { model: string; effort: 'none' } } }) {
  return {
    GG_DATA_DIR: dir,
    GG_DB_URL: ':memory:',
    GG_MASTER_KEY: KEY,
    GG_LOG_LEVEL: 'silent',
    GG_OLLAMA_URL: 'http://ollama.fixture:11434',
    ...(defaults ? { GG_DEFAULTS: JSON.stringify(defaults) } : {}),
  };
}

describe('system preflight with the native container harness map', () => {
  it.each(['offline', 'off', 'ready'] as const)(
    'keeps unused Ollama %s diagnostic from failing a Codex gateway',
    async (state) => {
      const fetcher = metadata(state === 'ready');
      const settings = env();
      if (state === 'off') {
        settings.GG_DB_URL = pathToFileURL(join(dir, 'gateway.db')).href;
        const saved = openDatabase({ url: settings.GG_DB_URL });
        await saved.migrate();
        await new SqliteOllamaRepository(saved.db).configure(
          { enabled: false, baseUrl: 'http://ollama.fixture:11434' },
          AT,
        );
        saved.close();
      }
      const container = await createContainer(loadConfig(settings), { startTimers: false });
      stubCli(container.ports.harnesses);
      await container.start();
      const app = await buildApp(container, { logger: false });
      try {
        expect(Object.keys(container.ports.harnesses).sort()).toEqual([
          'claude',
          'codex',
          'ollama',
        ]);
        const response = await app.inject('/system/preflight');
        expect(response.statusCode).toBe(200);
        const report = response.json<PreflightReport>();
        expect(report.ok).toBe(true);
        expect(at(report, 'harness.codex')?.status).toBe('ok');
        expect(at(report, 'harness.claude')?.status).toBe('warn');
        expect(at(report, 'harness.ollama')?.status).toBe(state === 'ready' ? 'ok' : 'warn');
        if (state === 'off') {
          expect(fetcher).not.toHaveBeenCalled();
          expect(at(report, 'harness.ollama')?.message).toBe('Ollama is off in Settings');
        }
        if (state === 'ready')
          expect(at(report, 'harness.ollama')?.message).toBe(readinessDetail('ollama', 'ready'));
        expect(at(report, 'harness.ollama')?.message).not.toMatch(/installed|logged in|CLI/);
        expect(fetcher.mock.calls.every((call) => !httpUrl(call[0]).includes('/api/chat'))).toBe(
          true,
        );
      } finally {
        await app.close();
        await container.stop();
      }
    },
  );
  it('accepts explicit Ollama-only readiness without a Codex login and diagnoses a selected offline service', async () => {
    const fetcher = metadata();
    const container = await createContainer(
      loadConfig(env({ byHarness: { ollama: { model: MODEL, effort: 'none' } } })),
      { startTimers: false },
    );
    stubCli(container.ports.harnesses, false);
    await container.start();
    await container.ollama.refresh();
    const app = await buildApp(container, { logger: false });
    try {
      let report = (await app.inject('/system/preflight')).json<PreflightReport>();
      expect(report.ok).toBe(true);
      expect(at(report, 'harness.codex')?.status).toBe('warn');
      expect(at(report, 'default-model')).toBeUndefined();
      expect(at(report, 'default-model.ollama')?.status).toBe('ok');
      fetcher.mockImplementation(() => Promise.reject(new Error('Fixture offline')));
      report = (await app.inject('/system/preflight')).json<PreflightReport>();
      expect(report.ok).toBe(false);
      expect(at(report, 'harness.ollama')?.status).toBe('fail');
      expect(container.manager).toBeDefined();
      await container.ollama.configure({ enabled: false, baseUrl: 'http://ollama.fixture:11434' });
      const beforeOff = fetcher.mock.calls.length;
      report = (await app.inject('/system/preflight')).json<PreflightReport>();
      expect(at(report, 'harness.ollama')).toMatchObject({
        status: 'fail',
        message: 'Ollama is off in Settings',
      });
      expect(at(report, 'default-model.ollama')).toMatchObject({
        status: 'fail',
        message: 'Ollama is off in Settings',
      });
      expect(fetcher).toHaveBeenCalledTimes(beforeOff);
    } finally {
      await app.close();
      await container.stop();
    }
  });
});

const model: ModelCatalogEntry = {
  harness: 'ollama',
  source: 'harness',
  model: MODEL,
  displayName: MODEL,
  enabled: true,
  efforts: ['none'],
  defaultEffort: 'none',
  availability: { state: 'available', checkedAt: AT },
};
function selectedSources(change: Partial<PreflightSources> = {}): PreflightSources {
  return {
    config: loadConfig({
      ...env(),
      GG_DEFAULTS: JSON.stringify({
        byHarness: {
          codex: { model: 'gpt-6-luna', effort: 'low' },
          ollama: { model: MODEL, effort: 'none' },
        },
      }),
    }),
    nodeVersion: '22.22.2',
    harnesses: { codex: new FakeHarness(), ollama: new FakeHarness([], 'ollama') },
    pendingMigrations: () => Promise.resolve(0),
    jevKey: () => Promise.resolve(undefined),
    jevEnabled: () => Promise.resolve(true),
    catalog: () => Promise.resolve([...DEFAULT_MODEL_CATALOG, model]),
    ...change,
  };
}
describe('selected Ollama model diagnostics', () => {
  it.each([
    { state: 'missing', reason: 'Not yet listed at the new address' },
    { state: 'unsupported', reason: 'Unsupported thinking control' },
  ] as const)('fails a known $state model', async (availability) => {
    const report = await runPreflight(
      selectedSources({
        catalog: () =>
          Promise.resolve([
            ...DEFAULT_MODEL_CATALOG,
            { ...model, availability: { ...availability, checkedAt: AT } },
          ]),
      }),
    );
    expect(at(report, 'default-model.ollama')).toMatchObject({
      status: 'fail',
      message: availability.reason,
    });
  });
  it('checks owner enablement and exact effort without inventing a default', async () => {
    expect(
      at(
        await runPreflight(
          selectedSources({
            catalog: () =>
              Promise.resolve([...DEFAULT_MODEL_CATALOG, { ...model, enabled: false }]),
          }),
        ),
        'default-model.ollama',
      ),
    ).toMatchObject({ status: 'fail', message: 'The configured Ollama model is disabled' });
    for (const effort of [undefined, 'high']) {
      const source = selectedSources();
      source.config.defaults.byHarness.ollama = {
        model: MODEL,
        ...(effort ? { effort: 'high' } : {}),
      };
      expect(at(await runPreflight(source), 'default-model.ollama')).toMatchObject({
        status: 'fail',
        message: 'Configure an explicit supported Ollama thinking control',
      });
    }
    expect(
      at(
        await runPreflight(
          selectedSources({
            catalog: () =>
              Promise.resolve([{ ...model, availability: { state: 'missing', checkedAt: AT } }]),
          }),
        ),
        'default-model.ollama',
      )?.status,
    ).toBe('fail');
  });
  it('warns until discovery or migration, and diagnoses a missing selected harness', async () => {
    for (const pending of [0, 1]) {
      const report = await runPreflight(
        selectedSources({
          pendingMigrations: () => Promise.resolve(pending),
          catalog: () => Promise.resolve(DEFAULT_MODEL_CATALOG),
        }),
      );
      expect(at(report, 'default-model.ollama')).toMatchObject({
        status: 'warn',
        message: 'The configured Ollama model is not checked until discovery',
      });
    }
    const report = await runPreflight(selectedSources({ harnesses: { codex: new FakeHarness() } }));
    expect(at(report, 'harness.ollama')).toMatchObject({ status: 'fail' });
  });
  it('does not treat an empty Ollama defaults entry as a selected model', async () => {
    const ollama = new FakeHarness([], 'ollama');
    ollama.preflightResult = { state: 'unknown', ok: false, problems: [] };
    const source = selectedSources({ harnesses: { codex: new FakeHarness(), ollama } });
    source.config.defaults.byHarness.ollama = {};
    const report = await runPreflight(source);
    expect(at(report, 'harness.ollama')?.status).toBe('warn');
    expect(at(report, 'default-model.ollama')).toBeUndefined();
    expect(report.ok).toBe(true);
  });
  it('keeps explicit Codex defaults required and treats absent Codex as optional only for Ollama-only defaults', async () => {
    const codex = new FakeHarness();
    codex.preflightResult = { state: 'unknown', ok: false, problems: [] };
    expect(
      at(
        await runPreflight(
          selectedSources({ harnesses: { codex, ollama: new FakeHarness([], 'ollama') } }),
        ),
        'harness.codex',
      )?.status,
    ).toBe('fail');
    const source = selectedSources({ harnesses: { ollama: new FakeHarness([], 'ollama') } });
    delete source.config.defaults.byHarness.codex;
    expect(at(await runPreflight(source), 'harness.codex')?.status).toBe('warn');
    const throwing = new FakeHarness([], 'ollama');
    throwing.preflight = () => Promise.reject(new Error('fixture'));
    expect(
      at(
        await runPreflight(
          selectedSources({ harnesses: { codex: new FakeHarness(), ollama: throwing } }),
        ),
        'harness.ollama',
      )?.status,
    ).toBe('fail');
  });
});

async function historicalMigrations(count: number): Promise<string> {
  const source = fileURLToPath(
    new URL('../../../packages/infrastructure/drizzle/', import.meta.url),
  );
  const folder = join(dir, 'migrations');
  await mkdir(join(folder, 'meta'), { recursive: true });
  const journal = JSON.parse(await readFile(join(source, 'meta/_journal.json'), 'utf8')) as {
    entries: { idx: number; tag: string }[];
  };
  journal.entries = journal.entries.filter((entry) => entry.idx < count);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
  await Promise.all(
    journal.entries.map((entry) =>
      copyFile(join(source, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`)),
    ),
  );
  return folder;
}
async function digestStore(includeWal = false) {
  const names = (await readdir(dir)).filter(
    (name) => name.endsWith('.db') || (includeWal && name.endsWith('.db-wal')),
  );
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name): Promise<[string, string]> => [
        name,
        createHash('sha256')
          .update(await readFile(join(dir, name)))
          .digest('hex'),
      ]),
    ),
  );
}
describe('CLI Ollama source resolution is read-only', () => {
  it.each([false, true])(
    'uses the current saved connection (enabled=%s) instead of environment fallback without writes',
    async (enabled) => {
      const url = pathToFileURL(join(dir, 'gateway.db')).href;
      const handle = openDatabase({ url });
      await handle.migrate();
      await new SqliteModelCatalog(handle.db).seed();
      await new SqliteOllamaRepository(handle.db).configure(
        { enabled, baseUrl: 'https://saved.fixture' },
        AT,
      );
      handle.close();
      const before = await digestStore();
      const fetcher = metadata();
      const source = await configPreflightSources(loadConfig({ ...env(), GG_DB_URL: url }));
      stubCli(source.harnesses);
      try {
        const report = await runPreflight(source);
        expect(at(report, 'harness.ollama')?.status).toBe(enabled ? 'ok' : 'warn');
        if (enabled)
          expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
            'https://saved.fixture/api/tags',
          ]);
        else {
          expect(fetcher).not.toHaveBeenCalled();
          expect(at(report, 'harness.ollama')?.message).toBe('Ollama is off in Settings');
        }
      } finally {
        source.close();
      }
      expect(await digestStore()).toEqual(before);
    },
  );
  it('leaves a current saved Off connection and its active write-ahead log byte-for-byte unchanged', async () => {
    const url = pathToFileURL(join(dir, 'gateway.db')).href;
    const handle = openDatabase({ url });
    await handle.migrate();
    await handle.client.execute('PRAGMA journal_mode = WAL');
    await new SqliteModelCatalog(handle.db).seed();
    await new SqliteOllamaRepository(handle.db).configure(
      { enabled: false, baseUrl: 'https://saved.fixture' },
      AT,
    );
    const fetcher = metadata();
    const before = await digestStore(true);
    expect(Object.keys(before)).toContain('gateway.db-wal');
    const source = await configPreflightSources(loadConfig({ ...env(), GG_DB_URL: url }));
    stubCli(source.harnesses);
    try {
      expect(at(await runPreflight(source), 'harness.ollama')?.message).toBe(
        'Ollama is off in Settings',
      );
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      source.close();
    }
    try {
      expect(await digestStore(true)).toEqual(before);
    } finally {
      handle.close();
    }
  });
  it('uses fallback for a missing database without creating it or running discovery', async () => {
    const fetcher = metadata();
    const missingDir = join(dir, 'missing');
    const source = await configPreflightSources(
      loadConfig({
        ...env(),
        GG_DATA_DIR: missingDir,
        GG_DB_URL: pathToFileURL(join(missingDir, 'gateway.db')).href,
      }),
    );
    stubCli(source.harnesses);
    try {
      expect(at(await runPreflight(source), 'harness.ollama')?.status).toBe('ok');
      expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
        'http://ollama.fixture:11434/api/tags',
      ]);
    } finally {
      source.close();
    }
    await expect(readdir(missingDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('uses fallback for an absent singleton in a current store without inserting a row', async () => {
    const url = pathToFileURL(join(dir, 'gateway.db')).href;
    const handle = openDatabase({ url });
    await handle.migrate();
    await new SqliteModelCatalog(handle.db).seed();
    handle.close();
    const fetcher = metadata();
    const before = await digestStore();
    const source = await configPreflightSources(loadConfig({ ...env(), GG_DB_URL: url }));
    stubCli(source.harnesses);
    try {
      expect(at(await runPreflight(source), 'harness.ollama')?.status).toBe('ok');
      expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
        'http://ollama.fixture:11434/api/tags',
      ]);
    } finally {
      source.close();
    }
    expect(await digestStore()).toEqual(before);
  });
  it.each(['pending', 'unsupported', 'unreadable'] as const)(
    'defers an existing %s store with zero Ollama HTTP and zero writes',
    async (state) => {
      let url = pathToFileURL(join(dir, 'gateway.db')).href;
      if (state === 'unreadable') {
        await writeFile(join(dir, 'blocker'), 'x');
        url = pathToFileURL(join(dir, 'blocker', 'gateway.db')).href;
      } else {
        const handle = openDatabase({
          url,
          ...(state === 'pending' ? { migrationsFolder: await historicalMigrations(27) } : {}),
        });
        await handle.migrate();
        if (state === 'unsupported')
          await handle.client.execute('UPDATE gg_upgrade_state SET format_version = 3');
        handle.close();
      }
      const before = await digestStore();
      const fetcher = metadata();
      const source = await configPreflightSources(loadConfig({ ...env(), GG_DB_URL: url }));
      stubCli(source.harnesses);
      try {
        expect(at(await runPreflight(source), 'harness.ollama')).toMatchObject({
          status: 'warn',
          state: 'unknown',
          message: expect.stringContaining('not checked until the database'),
        });
        expect(fetcher).not.toHaveBeenCalled();
      } finally {
        source.close();
      }
      expect(await digestStore()).toEqual(before);
    },
  );
});

function httpUrl(value: Parameters<typeof fetch>[0]): string {
  return typeof value === 'string' ? value : 'url' in value ? value.url : value.href;
}
