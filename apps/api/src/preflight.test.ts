import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeHarness } from '@graphgoblin/engine/testing';
import { DEFAULT_MODEL_CATALOG } from '@graphgoblin/infrastructure/sqlite';
import { loadConfig, type ApiConfig } from './config.js';
import { JEV_SECRET, LOCAL_OWNER, createContainer } from './container.js';
import {
  checkDataDir,
  checkNode,
  databaseFile,
  formatPreflight,
  readMasterKey,
  runPreflight,
  runPreflightCli,
  type PreflightReport,
  type PreflightSources,
} from './preflight.js';
import { createTestApp } from './testing/test-app.js';

const KEY = Buffer.alloc(32, 7).toString('base64');

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gg-preflight-'));
});

afterEach(async () => {
  // Windows can hold the database file briefly after close.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
});

function byId(report: PreflightReport, id: string) {
  return report.checks.find((c) => c.id === id);
}

function config(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    ...loadConfig({ GG_DATA_DIR: dir, GG_DB_URL: ':memory:', GG_MASTER_KEY: KEY }),
    ...overrides,
  };
}

function sources(overrides: Partial<PreflightSources> = {}): PreflightSources {
  return {
    config: config(),
    nodeVersion: '22.14.0',
    harnesses: { codex: new FakeHarness() },
    pendingMigrations: () => Promise.resolve(0),
    jevKey: () => Promise.resolve('jev-key'),
    catalog: () => Promise.resolve(DEFAULT_MODEL_CATALOG),
    ...overrides,
  };
}

describe('individual checks', () => {
  it('requires Node 22 or newer', () => {
    expect(checkNode('23.10.0').status).toBe('ok');
    expect(checkNode('v22.0.0').status).toBe('ok');
    expect(checkNode('20.11.1')).toMatchObject({ status: 'fail', message: /too old/ });
    expect(checkNode('garbage').status).toBe('fail');
  });

  it('checks the data directory without creating it', async () => {
    expect((await checkDataDir(dir)).status).toBe('ok');
    const missing = join(dir, 'missing');
    expect(await checkDataDir(missing)).toMatchObject({ status: 'warn', message: /first start/ });
    const file = join(dir, 'file');
    await writeFile(file, 'x');
    expect(await checkDataDir(file)).toMatchObject({ status: 'fail', message: /not a directory/ });
    expect((await checkDataDir(`${dir}\0bad`)).status).toBe('fail');
  });

  it('reads the master key from the environment or the data directory without generating one', async () => {
    expect((await readMasterKey({ dataDir: dir, masterKey: KEY })).check.status).toBe('ok');
    expect((await readMasterKey({ dataDir: dir, masterKey: 'c2hvcnQ=' })).check.status).toBe(
      'fail',
    );
    const missing = await readMasterKey({ dataDir: dir });
    expect(missing.check).toMatchObject({ status: 'warn', message: /generated on first start/ });
    expect(missing.key).toBeUndefined();
    await writeFile(join(dir, 'master.key'), `${KEY}\n`);
    const read = await readMasterKey({ dataDir: dir });
    expect(read.check.status).toBe('ok');
    expect(read.key?.length).toBe(32);
    await writeFile(join(dir, 'master.key'), 'c2hvcnQ=');
    expect((await readMasterKey({ dataDir: dir })).check.status).toBe('fail');
    const nested = join(dir, 'nested');
    await mkdir(join(nested, 'master.key'), { recursive: true });
    expect((await readMasterKey({ dataDir: nested })).check).toMatchObject({
      status: 'fail',
      message: /cannot read/,
    });
  });

  it('finds the file behind a libsql URL', () => {
    expect(databaseFile('file:C:/data/graphgoblin.db')).toBe('C:/data/graphgoblin.db');
    expect(databaseFile('file:/srv/gg.db?mode=rwc')).toBe('/srv/gg.db');
    expect(databaseFile(':memory:')).toBeUndefined();
    expect(databaseFile('file::memory:')).toBeUndefined();
    expect(databaseFile('file:x?mode=memory')).toBeUndefined();
    expect(databaseFile('file:')).toBeUndefined();
    expect(databaseFile('libsql://example.turso.io')).toBeUndefined();
  });
});

describe('runPreflight', () => {
  it('passes when everything is in place', async () => {
    const report = await runPreflight(sources());
    expect(report.ok).toBe(true);
    expect(report.checks.map((c) => [c.id, c.status])).toEqual([
      ['node', 'ok'],
      ['data-dir', 'ok'],
      ['master-key', 'ok'],
      ['database', 'ok'],
      ['harness.codex', 'ok'],
      ['jev', 'ok'],
      ['default-model', 'ok'],
    ]);
    expect(byId(report, 'harness.codex')?.message).toBe('codex fake is installed and logged in');
  });

  it('warns about a database that is missing or behind, and skips checks that need it', async () => {
    const missing = await runPreflight(
      sources({ pendingMigrations: () => Promise.resolve('missing') }),
    );
    expect(missing.ok).toBe(true);
    expect(byId(missing, 'database')?.status).toBe('warn');
    expect(byId(missing, 'jev')).toMatchObject({ status: 'warn', message: /not checked/ });
    expect(byId(missing, 'default-model')).toMatchObject({
      status: 'ok',
      message: /default catalog/,
    });
    const behind = await runPreflight(sources({ pendingMigrations: () => Promise.resolve(2) }));
    expect(byId(behind, 'database')).toMatchObject({ status: 'warn', message: /2 migration/ });
    const broken = await runPreflight(
      sources({ pendingMigrations: () => Promise.reject(new Error('SQLITE_CANTOPEN')) }),
    );
    expect(broken.ok).toBe(false);
    expect(byId(broken, 'database')).toMatchObject({
      status: 'fail',
      message: 'not reachable: SQLITE_CANTOPEN',
    });
  });

  it('fails when a harness is not ready or none is configured', async () => {
    const harness = new FakeHarness();
    harness.preflightResult = {
      ok: false,
      authenticated: false,
      problems: ['Codex CLI is not logged in; run `codex login`'],
    };
    const notReady = await runPreflight(sources({ harnesses: { codex: harness } }));
    expect(notReady.ok).toBe(false);
    expect(byId(notReady, 'harness.codex')?.message).toMatch(/codex login/);
    harness.preflightResult = { ok: false, authenticated: false, problems: [] };
    expect(
      byId(await runPreflight(sources({ harnesses: { codex: harness } })), 'harness.codex')
        ?.message,
    ).toBe('codex is not ready');
    const throwing = new FakeHarness();
    throwing.preflight = () => Promise.reject(new Error('spawn ENOENT'));
    expect(
      byId(await runPreflight(sources({ harnesses: { codex: throwing } })), 'harness.codex'),
    ).toMatchObject({ status: 'fail', message: 'spawn ENOENT' });
    const unversioned = new FakeHarness();
    unversioned.preflightResult = { ok: true, authenticated: true, problems: [] };
    expect(
      byId(await runPreflight(sources({ harnesses: { codex: unversioned } })), 'harness.codex')
        ?.message,
    ).toBe('codex is installed and logged in');
    const none = await runPreflight(sources({ harnesses: {} }));
    expect(byId(none, 'harness')).toMatchObject({ status: 'fail' });
  });

  it('only warns about Jev, and checks the default model against the catalog', async () => {
    const noJev = await runPreflight(sources({ jevKey: () => Promise.resolve('  ') }));
    expect(noJev.ok).toBe(true);
    expect(byId(noJev, 'jev')).toMatchObject({ status: 'warn', message: /optional/ });
    // A non-Error rejection still yields a readable message.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const jevError = await runPreflight(sources({ jevKey: () => Promise.reject('bad key') }));
    expect(byId(jevError, 'jev')).toMatchObject({ status: 'warn', message: /bad key/ });

    const unknown = await runPreflight(sources({ config: config({ defaultModel: 'gpt-nope' }) }));
    expect(unknown.ok).toBe(false);
    expect(byId(unknown, 'default-model')?.message).toMatch(/gpt-nope/);
    const disabled = await runPreflight(
      sources({
        catalog: () =>
          Promise.resolve(DEFAULT_MODEL_CATALOG.map((e) => ({ ...e, enabled: false }))),
      }),
    );
    expect(byId(disabled, 'default-model')).toMatchObject({ status: 'warn', message: /disabled/ });
    const broken = await runPreflight(sources({ catalog: () => Promise.reject(new Error('io')) }));
    expect(byId(broken, 'default-model')).toMatchObject({ status: 'fail', message: /io/ });
  });

  it('formats a readable table', async () => {
    const report = await runPreflight(sources({ jevKey: () => Promise.resolve(undefined) }));
    const text = formatPreflight(report);
    expect(text).toContain('STATUS  CHECK');
    expect(text).toMatch(/WARN\s+Jev\s+no API key/);
    expect(text).toContain('0 failed, 1 warning(s): ready to start');
    const failed = formatPreflight({ ok: false, checks: [] });
    expect(failed).toContain('fix the failed checks');
  });
});

describe('graphgoblin-api --preflight', () => {
  function cli(env: Record<string, string>, harness = new FakeHarness()) {
    let out = '';
    return runPreflightCli({
      env,
      harnesses: { codex: harness },
      nodeVersion: '22.14.0',
      write: (text) => {
        out += text;
      },
    }).then((code) => ({ code, out }));
  }

  it('reports a first run without creating anything', async () => {
    const dataDir = join(dir, 'fresh');
    const { code, out } = await cli({ GG_DATA_DIR: dataDir });
    expect(code).toBe(0);
    expect(out).toMatch(/WARN\s+Data directory/);
    expect(out).toMatch(/WARN\s+Master key/);
    expect(out).toMatch(/WARN\s+Database\s+the database does not exist yet/);
    await expect(rm(dataDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('checks an installation that has started once', async () => {
    const env = { GG_DATA_DIR: dir, GG_SWAGGER_UI: 'false' };
    const container = await createContainer(loadConfig(env), {
      harnesses: { codex: new FakeHarness() },
      deciders: [],
      startTimers: false,
    });
    await container.start();
    await container.repos.secretsFor(LOCAL_OWNER).set(JEV_SECRET, 'k');
    await container.stop();

    const ready = await cli(env);
    expect(ready.code).toBe(0);
    expect(ready.out).toContain('0 failed, 0 warning(s)');

    const harness = new FakeHarness();
    harness.preflightResult = { ok: false, authenticated: false, problems: ['not logged in'] };
    const notLoggedIn = await cli(env, harness);
    expect(notLoggedIn.code).toBe(1);
    expect(notLoggedIn.out).toMatch(/FAIL\s+Harness codex\s+not logged in/);

    // Without the master key the Jev secret cannot be read.
    await rm(join(dir, 'master.key'));
    const keyless = await cli(env);
    expect(keyless.out).toMatch(/WARN\s+Jev\s+no API key/);
  });

  it('reports an in-memory database as unmigrated and bad configuration as a failure', async () => {
    const memory = await cli({ GG_DATA_DIR: dir, GG_DB_URL: ':memory:', GG_MASTER_KEY: KEY });
    expect(memory.out).toMatch(/WARN\s+Database\s+\d+ migration/);
    const bad = await cli({ GG_PORT: 'nope' });
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/FAIL\s+configuration\s+invalid configuration/);
  });
});

describe('GET /system/preflight', () => {
  it('reports on the running installation and requires credentials when keys are required', async () => {
    const t = await createTestApp();
    try {
      const response = await t.app.inject('/system/preflight');
      expect(response.statusCode).toBe(200);
      const report = response.json<PreflightReport>();
      expect(byId(report, 'database')?.status).toBe('ok');
      expect(byId(report, 'harness.codex')?.status).toBe('ok');
      expect(byId(report, 'master-key')?.status).toBe('ok');
      expect(byId(report, 'jev')?.status).toBe('warn');
      expect(byId(report, 'default-model')?.status).toBe('ok');
    } finally {
      await t.close();
    }
    const strict = await createTestApp({ requireApiKey: true });
    try {
      expect((await strict.app.inject('/system/preflight')).statusCode).toBe(401);
    } finally {
      await strict.close();
    }
  });
});
