import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { databaseFilePath } from '@graphgoblin/infrastructure/sqlite';
import { canonicalPath } from './canonical-path.js';
import { loadConfig, type ApiConfig } from './config.js';
import {
  INSTANCE_PROTOCOL,
  instanceIdentity,
  isLauncherIdentityEntry,
  launchEnrollment,
  launcherHelperOutput,
  launchIdentity,
  launchPaths,
  launchProjection,
  launcherRuntimeSupported,
  launcherStoreState,
  type LaunchPaths,
} from './instance-identity.js';
import * as identities from './instance-identity.js';
import * as ownership from './data-dir-lock.js';
import { createTestApp, type TestApp } from './testing/test-app.js';

let testApp: TestApp | undefined;
afterEach(async () => {
  await testApp?.close();
  testApp = undefined;
  vi.restoreAllMocks();
});

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

it('recognizes the entry file by absolute or relative path and quietly refuses other entries', () => {
  const moduleUrl = new URL('./instance-identity.ts', import.meta.url).href;
  const entry = fileURLToPath(moduleUrl);
  expect(isLauncherIdentityEntry(entry, moduleUrl)).toBe(true);
  expect(isLauncherIdentityEntry(relative(process.cwd(), entry), moduleUrl)).toBe(true);
  expect(isLauncherIdentityEntry(fileURLToPath(import.meta.url), moduleUrl)).toBe(false);
  expect(isLauncherIdentityEntry(undefined, moduleUrl)).toBe(false);
  expect(isLauncherIdentityEntry(entry + '.missing', moduleUrl)).toBe(false);
  expect(isLauncherIdentityEntry(entry, 'not-a-file-url')).toBe(false);
});

it('checks both the data directory and external database with the shared read-only policy', async () => {
  const directory = vi.spyOn(ownership, 'dataDirLockState').mockResolvedValue({ state: 'free' });
  const database = vi.spyOn(ownership, 'databaseLockState').mockResolvedValue({
    state: 'held',
    path: 'external.db.graphgoblin.lock',
    detail: 'live owner',
  });
  const config = loadConfig({ GG_DATA_DIR: '/test/store', GG_DB_URL: 'file:/external.db' });
  expect(await launcherStoreState(config)).toMatchObject({ state: 'held' });
  expect(database).toHaveBeenCalledWith(resolve('/external.db'));
  database.mockResolvedValue({ state: 'free' });
  expect(await launcherStoreState(config)).toEqual({ state: 'free' });
  expect(await launcherStoreState({ ...config, dbUrl: ':memory:' })).toEqual({ state: 'free' });
  directory.mockResolvedValue({
    state: 'held',
    path: 'graphgoblin.lock.reclaim',
    detail: 'unknown owner',
  });
  database.mockClear();
  expect(await launcherStoreState(config)).toMatchObject({ state: 'held' });
  expect(database).not.toHaveBeenCalled();
});

it.each(['22.22.2', '22.23.4', '22.99.0'])('accepts launcher runtime %s', (version) => {
  expect(launcherRuntimeSupported(version)).toBe(true);
});
it.each(['22.22.1', '22.21.9', '23.0.0', '21.99.0', 'invalid', '22'])(
  'refuses launcher runtime %s',
  (version) => {
    expect(launcherRuntimeSupported(version)).toBe(false);
  },
);

it('identifies runtime configuration and the actual database, without fingerprinting secrets', () => {
  const config = loadConfig({ GG_DATA_DIR: '/test/store' });
  const identity = instanceIdentity(config);
  expect(identity).toMatch(/^[a-f0-9]{64}$/);
  expect(instanceIdentity({ ...config })).toBe(identity);
  expect(
    instanceIdentity({
      ...config,
      masterKey: 'private',
      jevApiKey: { value: 'private', source: 'GG_JEV_API_KEY' },
    }),
  ).toBe(identity);
  for (const changed of [
    { dataDir: '/other' },
    { dbUrl: 'file:/external.db' },
    { port: 4832 },
    { webDist: '/other/web' },
    { goblinDist: '/other/goblin' },
    { requireApiKey: true },
  ]) {
    expect(instanceIdentity({ ...config, ...changed })).not.toBe(identity);
  }
});

it('keeps the protocol-2 full fingerprint bytes for existing full-identity consumers', () => {
  const config = loadConfig({ GG_DATA_DIR: '/test/store', GG_MASTER_KEY: 'private' });
  const { masterKey: _masterKey, jevApiKey: _jevApiKey, ...publicConfig } = config;
  const legacy = JSON.stringify({
    protocol: 2,
    runtime: canonicalPath(process.execPath),
    node: process.version,
    entry: canonicalPath(fileURLToPath(new URL('./main.js', import.meta.url))),
    config: {
      ...publicConfig,
      dataDir: canonicalPath(config.dataDir),
      dbUrl: canonicalPath(databaseFilePath(config.dbUrl) ?? ''),
      webDist: undefined,
      goblinDist: undefined,
    },
  });
  expect(INSTANCE_PROTOCOL).toBe(2);
  expect(instanceIdentity(config)).toBe(sha256(legacy));
  // The default snapshot is the same resolution, so unchanged inputs keep these digest bytes.
  expect(instanceIdentity(config, launchPaths(config))).toBe(sha256(legacy));
});

/** Keys deliberately outside loadConfig order: the protocol-2 text keeps this own order. */
const reorderedConfig: ApiConfig = {
  swaggerUi: false,
  dbUrl: 'libsql://remote.example/store',
  port: 4831,
  jevApiKey: { value: 'GOLDEN_SECRET_CANARY', source: 'GG_JEV_API_KEY' },
  host: '127.0.0.1',
  defaults: { byHarness: { codex: { model: 'gpt-6-luna', effort: 'low' } } },
  dataDir: '/gg/configured-store',
  ollamaUrl: 'http://127.0.0.1:11434',
  masterKey: 'GOLDEN_SECRET_CANARY',
  requireApiKey: false,
  logLevel: 'info',
  maxConcurrentRuns: 4,
  timerPollMs: 1000,
  shutdownGraceMs: 300000,
  hookRateLimitPerMinute: 60,
  ollamaEnabled: false,
};

/** The host-dependent protocol-2 prefix: runtime, Node version and entry participate as before. */
function legacyText(config: string): string {
  const runtime = JSON.stringify(canonicalPath(process.execPath));
  const entry = JSON.stringify(canonicalPath(fileURLToPath(new URL('./main.js', import.meta.url))));
  return `{"protocol":2,"runtime":${runtime},"node":${JSON.stringify(process.version)},"entry":${entry},"config":${config}}`;
}

it('serializes the protocol-2 full fingerprint exactly, from the supplied path snapshot', () => {
  // Independent golden text: written out, never rebuilt from the configuration or sorted.
  const nonFile: LaunchPaths = {
    checkout: '/snapshot/checkout',
    dataDir: '/snapshot/store',
    database: { kind: 'non-file', configuration: sha256('libsql://remote.example/store') },
    webDist: null,
    goblinDist: null,
  };
  const nonFileText =
    '{"swaggerUi":false,"dbUrl":"libsql://remote.example/store","port":4831,"host":"127.0.0.1",' +
    '"defaults":{"byHarness":{"codex":{"model":"gpt-6-luna","effort":"low"}}},' +
    '"dataDir":"/snapshot/store","ollamaUrl":"http://127.0.0.1:11434","requireApiKey":false,' +
    '"logLevel":"info","maxConcurrentRuns":4,"timerPollMs":1000,"shutdownGraceMs":300000,' +
    '"hookRateLimitPerMinute":60,"ollamaEnabled":false}';
  // The raw non-file value, reordered keys and absent serving roots keep their legacy meaning.
  expect(instanceIdentity(reorderedConfig, nonFile)).toBe(sha256(legacyText(nonFileText)));

  const fileConfig: ApiConfig = {
    ...reorderedConfig,
    dbUrl: 'file:/gg/configured-store/graphgoblin.db',
    webDist: '/gg/configured-web',
  };
  const file: LaunchPaths = {
    ...nonFile,
    database: {
      kind: 'file',
      lookup: '/snapshot/alias/graphgoblin.db',
      target: '/snapshot/target/graphgoblin.db',
    },
    webDist: '/snapshot/web',
  };
  const fileText =
    '{"swaggerUi":false,"dbUrl":"/snapshot/target/graphgoblin.db","port":4831,"host":"127.0.0.1",' +
    '"defaults":{"byHarness":{"codex":{"model":"gpt-6-luna","effort":"low"}}},' +
    '"dataDir":"/snapshot/store","ollamaUrl":"http://127.0.0.1:11434","requireApiKey":false,' +
    '"logLevel":"info","maxConcurrentRuns":4,"timerPollMs":1000,"shutdownGraceMs":300000,' +
    '"hookRateLimitPerMinute":60,"ollamaEnabled":false,"webDist":"/snapshot/web"}';
  expect(instanceIdentity(fileConfig, file)).toBe(sha256(legacyText(fileText)));
  // Rejection controls: a sorted or launch-style projection is a different text and digest.
  const sorted = JSON.stringify(
    Object.fromEntries(
      Object.entries(JSON.parse(nonFileText) as Record<string, unknown>).sort(([left], [right]) =>
        left < right ? -1 : 1,
      ),
    ),
  );
  expect(sorted).not.toBe(nonFileText);
  expect(instanceIdentity(reorderedConfig, nonFile)).not.toBe(sha256(legacyText(sorted)));
  expect(instanceIdentity(fileConfig, { ...file, webDist: null })).not.toBe(
    sha256(legacyText(fileText)),
  );
});

it('derives both enrollment digests from a supplied snapshot when a later resolution differs', () => {
  const config = loadConfig({ GG_DATA_DIR: '/test/store' });
  const later = launchPaths(config);
  const snapshot: LaunchPaths = {
    ...later,
    dataDir: canonicalPath('/test/snapshot-store'),
    database: {
      kind: 'file',
      lookup: resolve('/test/alias/graphgoblin.db'),
      target: canonicalPath('/test/snapshot-store/graphgoblin.db'),
    },
  };
  const enrollment = launchEnrollment(config, snapshot);
  expect(enrollment).toEqual({
    version: '1',
    launch: launchIdentity(config, snapshot),
    instance: instanceIdentity(config, snapshot),
    dataDir: snapshot.dataDir,
    database: 'file',
    lookup: resolve('/test/alias/graphgoblin.db'),
    target: canonicalPath('/test/snapshot-store/graphgoblin.db'),
  });
  // A later resolver lookup names the configured store, so it cannot describe this enrollment.
  expect(instanceIdentity(config)).not.toBe(enrollment.instance);
  expect(launchIdentity(config, later)).not.toBe(enrollment.launch);
  expect(launchEnrollment(config).instance).toBe(instanceIdentity(config, later));
});

/** A complete explicit configuration, independent of loadConfig defaults and this host. */
const goldenConfig: ApiConfig = {
  host: '127.0.0.1',
  port: 4747,
  dataDir: '/gg/store',
  dbUrl: 'file:/gg/store/graphgoblin.db',
  requireApiKey: false,
  masterKey: 'GOLDEN_SECRET_CANARY',
  logLevel: 'info',
  maxConcurrentRuns: 4,
  defaults: { byHarness: { codex: { model: 'gpt-6-luna', effort: 'low' } } },
  timerPollMs: 1000,
  shutdownGraceMs: 300000,
  hookRateLimitPerMinute: 60,
  swaggerUi: true,
  ollamaEnabled: false,
  ollamaUrl: 'http://127.0.0.1:11434',
  webDist: '/gg/checkout/apps/web/dist',
  goblinDist: '/gg/checkout/apps/web/dist-goblin',
  jevApiKey: { value: 'GOLDEN_SECRET_CANARY', source: 'GG_JEV_API_KEY' },
};
const goldenDatabase = {
  kind: 'file',
  lookup: '/gg/alias/graphgoblin.db',
  target: '/gg/store/graphgoblin.db',
} as const;
const goldenPaths: LaunchPaths = {
  checkout: '/gg/checkout',
  dataDir: '/gg/store',
  database: goldenDatabase,
  webDist: '/gg/checkout/apps/web/dist',
  goblinDist: '/gg/checkout/apps/web/dist-goblin',
};
const goldenProjection =
  '[["version",1],["protocol",2],["checkout","/gg/checkout"],["host","127.0.0.1"],' +
  '["port",4747],["dataDir","/gg/store"],' +
  '["dbUrl",{"kind":"file","target":"/gg/store/graphgoblin.db"}],["requireApiKey",false],' +
  '["logLevel","info"],["maxConcurrentRuns",4],' +
  '["defaults",{"byHarness":{"codex":{"effort":"low","model":"gpt-6-luna"}}}],' +
  '["timerPollMs",1000],["shutdownGraceMs",300000],["hookRateLimitPerMinute",60],' +
  '["swaggerUi",true],["publicUrl",null],["codexBinary",null],["claudeBinary",null],' +
  '["ollamaEnabled",false],["ollamaUrl","http://127.0.0.1:11434"],' +
  '["webDist","/gg/checkout/apps/web/dist"],["goblinDist","/gg/checkout/apps/web/dist-goblin"]]';

it('pins the ordered launch projection and its versioned digest with a golden vector', () => {
  // The exact hashed text is the golden vector; the digest is an independent SHA-256 of it.
  expect(launchProjection(goldenConfig, goldenPaths)).toBe(goldenProjection);
  expect(launchIdentity(goldenConfig, goldenPaths)).toBe(`v1:${sha256(goldenProjection)}`);
  // The database lookup spelling, secrets and the runtime are not projected.
  expect(goldenProjection).not.toContain('alias');
  expect(goldenProjection).not.toContain('GOLDEN_SECRET_CANARY');
  expect(goldenProjection).not.toContain(process.execPath.replaceAll('\\', '\\\\'));
  expect(goldenProjection).not.toContain(process.version);
});

it('changes the launch digest for store, database, API-key, serving roots and protocol', () => {
  const digest = launchIdentity(goldenConfig, goldenPaths);
  const nonFile = (dbUrl: string): [ApiConfig, LaunchPaths] => [
    { ...goldenConfig, dbUrl },
    { ...goldenPaths, database: { kind: 'non-file', configuration: sha256(dbUrl) } },
  ];
  const changed: [ApiConfig, LaunchPaths][] = [
    [goldenConfig, { ...goldenPaths, dataDir: '/gg/other-store' }],
    [
      goldenConfig,
      { ...goldenPaths, database: { ...goldenDatabase, target: '/gg/other/graphgoblin.db' } },
    ],
    nonFile(':memory:'),
    nonFile('libsql://remote.example'),
    [{ ...goldenConfig, requireApiKey: true }, goldenPaths],
    [goldenConfig, { ...goldenPaths, webDist: '/gg/other/web' }],
    [goldenConfig, { ...goldenPaths, webDist: null }],
    [goldenConfig, { ...goldenPaths, goblinDist: '/gg/other/goblin' }],
    [goldenConfig, { ...goldenPaths, goblinDist: null }],
    [goldenConfig, { ...goldenPaths, checkout: '/gg/other-checkout' }],
    [{ ...goldenConfig, port: 4831 }, goldenPaths],
    [{ ...goldenConfig, ollamaEnabled: true }, goldenPaths],
    [{ ...goldenConfig, defaults: { byHarness: { codex: { model: 'other' } } } }, goldenPaths],
  ];
  const seen = new Set([digest]);
  for (const [config, paths] of changed) {
    const other = launchIdentity(config, paths);
    expect(other).toMatch(/^v1:[a-f0-9]{64}$/);
    expect(seen.has(other)).toBe(false);
    seen.add(other);
  }
  expect(launchIdentity(goldenConfig, goldenPaths, INSTANCE_PROTOCOL + 1)).not.toBe(digest);
});

it('keeps the launch digest across secrets, lookup spelling, runtime and nested key order', () => {
  const digest = launchIdentity(goldenConfig, goldenPaths);
  const { masterKey: _masterKey, jevApiKey: _jevApiKey, ...withoutSecrets } = goldenConfig;
  expect(launchIdentity(withoutSecrets, goldenPaths)).toBe(digest);
  expect(
    launchIdentity(goldenConfig, {
      ...goldenPaths,
      database: { ...goldenDatabase, lookup: '/gg/store/graphgoblin.db' },
    }),
  ).toBe(digest);
  const reordered: ApiConfig = {
    ...goldenConfig,
    defaults: {
      byHarness: {
        ollama: { model: 'local', effort: 'none' },
        codex: { effort: 'low', model: 'gpt-6-luna' },
      },
    },
  };
  const ordered: ApiConfig = {
    ...goldenConfig,
    defaults: {
      byHarness: {
        codex: { model: 'gpt-6-luna', effort: 'low' },
        ollama: { effort: 'none', model: 'local' },
      },
    },
  };
  expect(launchIdentity(reordered, goldenPaths)).toBe(launchIdentity(ordered, goldenPaths));

  // A Node or build replacement changes the full fingerprint, never the launch digest.
  const config = loadConfig({ GG_DATA_DIR: '/test/store' });
  const paths = launchPaths(config);
  const launch = launchIdentity(config, paths);
  const instance = instanceIdentity(config);
  const execPath = process.execPath;
  try {
    process.execPath = resolve('/replaced/runtime/node.exe');
    expect(instanceIdentity(config)).not.toBe(instance);
    expect(launchIdentity(config, launchPaths(config))).toBe(launch);
  } finally {
    process.execPath = execPath;
  }
});

it('enrolls from one path snapshot with the SQLite lookup as-is and no raw database URL', () => {
  const relativeUrl = 'file:relative%20store/graphgoblin.db';
  const config = loadConfig({ GG_DATA_DIR: '/test/store', GG_DB_URL: relativeUrl });
  const paths = launchPaths(config, '/test/checkout');
  expect(paths.database).toEqual({
    kind: 'file',
    lookup: databaseFilePath(relativeUrl),
    target: canonicalPath(databaseFilePath(relativeUrl) ?? ''),
  });
  expect(paths.checkout).toBe(canonicalPath('/test/checkout'));
  expect(launchEnrollment(config, paths)).toEqual({
    version: '1',
    launch: launchIdentity(config, paths),
    instance: instanceIdentity(config),
    dataDir: canonicalPath('/test/store'),
    database: 'file',
    lookup: resolve('relative store/graphgoblin.db'),
    target: canonicalPath(resolve('relative store/graphgoblin.db')),
  });

  const remote = 'libsql://remote.example/?authToken=GG_RAW_URL_CANARY';
  const nonFile = loadConfig({ GG_DATA_DIR: '/test/store', GG_DB_URL: remote });
  const enrollment = launchEnrollment(nonFile);
  expect(enrollment).toEqual({
    version: '1',
    launch: expect.stringMatching(/^v1:[a-f0-9]{64}$/),
    instance: expect.stringMatching(/^[a-f0-9]{64}$/),
    dataDir: canonicalPath('/test/store'),
    database: 'non-file',
  });
  expect(JSON.stringify(enrollment)).not.toContain('GG_RAW_URL_CANARY');
  expect(launchProjection(nonFile, launchPaths(nonFile))).not.toContain('GG_RAW_URL_CANARY');
  for (const value of Object.values(enrollment)) expect(typeof value).toBe('string');
});

it('answers each helper mode with one line, keeping the legacy identity as the default', async () => {
  vi.spyOn(ownership, 'dataDirLockState').mockResolvedValue({ state: 'free' });
  vi.spyOn(ownership, 'databaseLockState').mockResolvedValue({ state: 'free' });
  const config = loadConfig({ GG_DATA_DIR: '/test/store' });
  expect(await launcherHelperOutput(config, undefined)).toBe(instanceIdentity(config) + '\n');
  expect(await launcherHelperOutput(config, '--other')).toBe(instanceIdentity(config) + '\n');
  expect(await launcherHelperOutput(config, '--store-state')).toBe('{"state":"free"}\n');
  expect(await launcherHelperOutput(config, '--launch-enrollment')).toBe(
    JSON.stringify(launchEnrollment(config)) + '\n',
  );
});

it('publishes opaque identities and current shutdown phase on the public health probe', async () => {
  testApp = await createTestApp({ env: { GG_REQUIRE_API_KEY: 'true' } });
  const health = await testApp.app.inject({ method: 'GET', url: '/healthz' });
  expect(health.statusCode).toBe(200);
  expect(health.json()).toEqual({ status: 'ok' });
  const config = testApp.container.config;
  expect(health.headers['x-graphgoblin-instance']).toBe(instanceIdentity(config));
  expect(health.headers['x-graphgoblin-launch-identity']).toBe(
    launchIdentity(config, launchPaths(config)),
  );
  expect(health.headers['x-graphgoblin-launch-identity']).toMatch(/^v1:[a-f0-9]{64}$/);
  expect(health.headers['x-graphgoblin-pid']).toBe(String(process.pid));
  expect(health.headers['x-graphgoblin-phase']).toBe('running');
});

it('captures both health digests from one observation of the store and serving paths', async () => {
  const resolvePaths = identities.launchPaths;
  const observed: LaunchPaths[] = [];
  vi.spyOn(identities, 'launchPaths').mockImplementation((config, checkout) => {
    // This observation deliberately disagrees with any later resolution of the same config.
    const snapshot = {
      ...resolvePaths(config, checkout),
      dataDir: canonicalPath(join(config.dataDir, 'observed-once')),
    };
    observed.push(snapshot);
    return snapshot;
  });
  testApp = await createTestApp();
  const health = await testApp.app.inject({ method: 'GET', url: '/healthz' });
  const config = testApp.container.config;
  expect(observed).toHaveLength(1);
  const [snapshot] = observed as [LaunchPaths];
  expect(health.headers['x-graphgoblin-instance']).toBe(instanceIdentity(config, snapshot));
  expect(health.headers['x-graphgoblin-launch-identity']).toBe(launchIdentity(config, snapshot));
  expect(health.headers['x-graphgoblin-instance']).not.toBe(instanceIdentity(config));
  expect(health.headers['x-graphgoblin-launch-identity']).not.toBe(
    launchIdentity(config, resolvePaths(config)),
  );
});
