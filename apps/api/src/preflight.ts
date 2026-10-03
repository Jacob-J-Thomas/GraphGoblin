import { randomUUID } from 'node:crypto';
import { open, readFile, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createCodexAdapters } from '@graphgoblin/adapter-codex';
import type { HarnessId } from '@graphgoblin/contracts';
import type { HarnessPort } from '@graphgoblin/engine';
import {
  DEFAULT_MODEL_CATALOG,
  SqliteModelCatalog,
  SqliteSecrets,
  databaseFilePath,
  openDatabase,
  type ModelCatalogEntry,
} from '@graphgoblin/infrastructure/sqlite';
import { z } from 'zod';
import { loadConfig, type ApiConfig } from './config.js';
import { JEV_SECRET, LOCAL_OWNER, type Container } from './container.js';

/**
 * First-run preflight (docs/11): is this machine ready to run GraphGoblin? Each check reports
 * `ok`, `warn` (works, but something is missing or will be set up on first start), or `fail`
 * (runs will not work until it is fixed). Served at `GET /system/preflight` and printed by
 * `graphgoblin-api --preflight`. Nothing here spawns a Codex session or changes any state.
 */

export const PreflightStatusSchema = z.enum(['ok', 'warn', 'fail']);
export type PreflightStatus = z.infer<typeof PreflightStatusSchema>;

export const PreflightCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: PreflightStatusSchema,
  message: z.string(),
});
export type PreflightCheck = z.infer<typeof PreflightCheckSchema>;

export const PreflightReportSchema = z.object({
  /** False when any check failed. Warnings do not make the report fail. */
  ok: z.boolean(),
  checks: z.array(PreflightCheckSchema),
});
export type PreflightReport = z.infer<typeof PreflightReportSchema>;

export const MIN_NODE_MAJOR = 22;

/** Where the checks read their facts from: the running container, or the configuration alone. */
export interface PreflightSources {
  config: ApiConfig;
  /** Default: `process.versions.node`. */
  nodeVersion?: string;
  harnesses: Partial<Record<HarnessId, HarnessPort>>;
  /** Migrations still to apply, or `'missing'` when the database file does not exist yet. Throws when unreachable. */
  pendingMigrations(): Promise<number | 'missing'>;
  /** The Jev API key, if set. Only called once the database is migrated. */
  jevKey(): Promise<string | undefined>;
  /** The model catalog. Only called once the database is migrated. */
  catalog(): Promise<ModelCatalogEntry[]>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function check(id: string, label: string, status: PreflightStatus, text: string): PreflightCheck {
  return { id, label, status, message: text };
}

export function checkNode(version: string): PreflightCheck {
  const major = Number(/^v?(\d+)/.exec(version)?.[1] ?? NaN);
  return major >= MIN_NODE_MAJOR
    ? check('node', 'Node.js', 'ok', `Node ${version}`)
    : check(
        'node',
        'Node.js',
        'fail',
        `Node ${version} is too old; GraphGoblin needs Node ${String(MIN_NODE_MAJOR)} or newer`,
      );
}

/** A fresh probe file name; random, so concurrent preflights never share one. */
export type ProbeName = () => string;
const defaultProbeName: ProbeName = () => `.preflight-${randomUUID()}`;

/**
 * Prove `dir` is writable by creating a new file in it exclusively (`wx`: never truncates an
 * existing file and never follows a symlink at that path) and removing only that file. A name
 * that already exists is skipped for the next one. Throws when the directory is not writable.
 */
export async function probeWritable(
  dir: string,
  name: ProbeName = defaultProbeName,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    const path = join(dir, name());
    let handle;
    try {
      handle = await open(path, 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST' && attempt < 4) continue;
      throw error;
    }
    await handle.close();
    await unlink(path);
    return;
  }
}

export async function checkDataDir(
  dir: string,
  probeName: ProbeName = defaultProbeName,
): Promise<PreflightCheck> {
  const fail = (text: string): PreflightCheck => check('data-dir', 'Data directory', 'fail', text);
  let isDirectory: boolean;
  try {
    isDirectory = (await stat(dir)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return check(
        'data-dir',
        'Data directory',
        'warn',
        `${dir} does not exist yet; it is created on first start`,
      );
    }
    return fail(`cannot read ${dir}: ${message(error)}`);
  }
  if (!isDirectory) return fail(`${dir} exists but is not a directory`);
  try {
    await probeWritable(dir, probeName);
  } catch (error) {
    return fail(`${dir} is not writable: ${message(error)}`);
  }
  return check('data-dir', 'Data directory', 'ok', `${dir} is writable`);
}

/** Read the master key the way `loadMasterKey` does, without generating one. */
export async function readMasterKey(
  config: Pick<ApiConfig, 'dataDir' | 'masterKey'>,
): Promise<{ check: PreflightCheck; key?: Buffer }> {
  const result = (status: PreflightStatus, text: string, key?: Buffer) => ({
    check: check('master-key', 'Master key', status, text),
    ...(key ? { key } : {}),
  });
  if (config.masterKey) {
    const key = Buffer.from(config.masterKey, 'base64');
    return key.length === 32
      ? result('ok', 'taken from GG_MASTER_KEY', key)
      : result('fail', 'GG_MASTER_KEY must be base64 for exactly 32 bytes');
  }
  const file = join(config.dataDir, 'master.key');
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return result(
        'warn',
        `${file} does not exist yet; a key is generated on first start (back it up, or set GG_MASTER_KEY)`,
      );
    }
    return result('fail', `cannot read ${file}: ${message(error)}`);
  }
  const key = Buffer.from(text.trim(), 'base64');
  return key.length === 32
    ? result('ok', `read from ${file}`, key)
    : result('fail', `${file} does not contain a base64 32-byte key`);
}

async function checkHarnesses(
  harnesses: Partial<Record<HarnessId, HarnessPort>>,
): Promise<PreflightCheck[]> {
  const checks: PreflightCheck[] = [];
  for (const [id, harness] of Object.entries(harnesses)) {
    const label = `Harness ${id}`;
    try {
      const result = await harness.preflight();
      const version = result.version ? ` ${result.version}` : '';
      checks.push(
        result.ok
          ? check(`harness.${id}`, label, 'ok', `${id}${version} is installed and logged in`)
          : check(
              `harness.${id}`,
              label,
              'fail',
              result.problems.join('; ') || `${id} is not ready`,
            ),
      );
    } catch (error) {
      checks.push(check(`harness.${id}`, label, 'fail', message(error)));
    }
  }
  if (checks.length === 0) {
    checks.push(check('harness', 'Harness', 'fail', 'no harness adapter is configured'));
  }
  return checks;
}

function checkDefaultModel(
  model: string,
  catalog: ModelCatalogEntry[],
  seeded: boolean,
): PreflightCheck {
  const entry = catalog.find((e) => e.model === model);
  const where = seeded ? 'the model catalog' : 'the default catalog seeded on first start';
  if (!entry) {
    return check(
      'default-model',
      'Default model',
      'fail',
      `GG_DEFAULT_MODEL "${model}" is not in ${where}; add it in settings or pick a listed model`,
    );
  }
  if (!entry.enabled) {
    return check('default-model', 'Default model', 'warn', `${model} is in ${where} but disabled`);
  }
  return check(
    'default-model',
    'Default model',
    'ok',
    `${model} (${entry.harness}) is in ${where}`,
  );
}

/** Run every check. Never throws: a check that cannot run reports `fail` with the reason. */
export async function runPreflight(sources: PreflightSources): Promise<PreflightReport> {
  const { config } = sources;
  const checks: PreflightCheck[] = [checkNode(sources.nodeVersion ?? process.versions.node)];
  checks.push(await checkDataDir(config.dataDir));
  checks.push((await readMasterKey(config)).check);

  let migrated = false;
  try {
    const pending = await sources.pendingMigrations();
    if (pending === 'missing') {
      checks.push(
        check(
          'database',
          'Database',
          'warn',
          'the database does not exist yet; it is created and migrated on first start',
        ),
      );
    } else if (pending > 0) {
      checks.push(
        check(
          'database',
          'Database',
          'warn',
          `${String(pending)} migration(s) pending; they are applied on the next start`,
        ),
      );
    } else {
      migrated = true;
      checks.push(check('database', 'Database', 'ok', 'reachable and migrated'));
    }
  } catch (error) {
    checks.push(check('database', 'Database', 'fail', `not reachable: ${message(error)}`));
  }

  checks.push(...(await checkHarnesses(sources.harnesses)));

  if (!migrated) {
    checks.push(
      check('jev', 'Jev', 'warn', 'not checked until the database is migrated; Jev is optional'),
    );
  } else {
    try {
      const key = (await sources.jevKey())?.trim();
      checks.push(
        key
          ? check('jev', 'Jev', 'ok', `API key set (secret "${JEV_SECRET}")`)
          : check(
              'jev',
              'Jev',
              'warn',
              `no API key in secret "${JEV_SECRET}"; Jev is optional and decisions fall back to Codex`,
            ),
      );
    } catch (error) {
      checks.push(check('jev', 'Jev', 'warn', `cannot read the Jev key: ${message(error)}`));
    }
  }

  try {
    const catalog = migrated ? await sources.catalog() : DEFAULT_MODEL_CATALOG;
    checks.push(checkDefaultModel(config.defaultModel, catalog, migrated));
  } catch (error) {
    checks.push(
      check('default-model', 'Default model', 'fail', `cannot read the catalog: ${message(error)}`),
    );
  }

  return { ok: checks.every((c) => c.status !== 'fail'), checks };
}

/** Facts from a running container, for `GET /system/preflight`. */
export function containerPreflightSources(container: Container): PreflightSources {
  return {
    config: container.config,
    harnesses: container.ports.harnesses,
    pendingMigrations: () => container.handle.pendingMigrations(),
    jevKey: () => container.repos.secretsFor(LOCAL_OWNER).resolve(JEV_SECRET),
    catalog: () => container.repos.catalog.list(),
  };
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/**
 * Whether the server's start can create `file`: it creates the missing directories above it, so
 * the nearest existing ancestor must be a writable directory. Throws with the reason otherwise.
 */
export async function assertCreatable(file: string, probeName?: ProbeName): Promise<void> {
  let dir = dirname(file);
  for (;;) {
    let isDirectory: boolean;
    try {
      isDirectory = (await stat(dir)).isDirectory();
    } catch (error) {
      if (!isMissing(error) || dirname(dir) === dir) throw error;
      dir = dirname(dir);
      continue;
    }
    if (!isDirectory) throw new Error(`${file} cannot be created: ${dir} is not a directory`);
    try {
      await probeWritable(dir, probeName);
    } catch (error) {
      throw new Error(`${file} cannot be created: ${dir} is not writable (${message(error)})`, {
        cause: error,
      });
    }
    return;
  }
}

/** What the CLI can learn about the database before the server has started. */
type DatabaseState =
  | { kind: 'missing' }
  | { kind: 'broken'; error: unknown }
  | { kind: 'open'; handle: ReturnType<typeof openDatabase> };

async function inspectDatabase(url: string): Promise<DatabaseState> {
  const file = databaseFilePath(url);
  if (file !== undefined) {
    try {
      await stat(file);
    } catch (error) {
      if (!isMissing(error)) return { kind: 'broken', error };
      try {
        await assertCreatable(file);
        return { kind: 'missing' };
      } catch (reason) {
        return { kind: 'broken', error: reason };
      }
    }
  }
  try {
    return { kind: 'open', handle: openDatabase({ url }) };
  } catch (error) {
    return { kind: 'broken', error };
  }
}

export interface ConfigPreflightOptions {
  /** Replace the real Codex harness (tests). */
  harnesses?: Partial<Record<HarnessId, HarnessPort>>;
  nodeVersion?: string;
}

/**
 * Facts from the configuration alone, for the CLI before the server has started. Opens the
 * database only when its file exists, so a first run creates nothing; a missing file is a
 * warning only when the server's start could create it.
 */
export async function configPreflightSources(
  config: ApiConfig,
  options: ConfigPreflightOptions = {},
): Promise<PreflightSources & { close(): void }> {
  const database = await inspectDatabase(config.dbUrl);
  const { key } = await readMasterKey(config);
  const harnesses = options.harnesses ?? {
    codex: createCodexAdapters({
      model: config.defaultModel,
      effort: config.defaultEffort,
      ...(config.codexBinary ? { codexBinary: config.codexBinary } : {}),
    }).harness,
  };
  const base = {
    config,
    harnesses,
    ...(options.nodeVersion ? { nodeVersion: options.nodeVersion } : {}),
  };
  if (database.kind !== 'open') {
    const { kind } = database;
    const failure = kind === 'broken' ? database.error : undefined;
    return {
      ...base,
      pendingMigrations: () =>
        kind === 'missing'
          ? Promise.resolve('missing' as const)
          : Promise.reject(failure instanceof Error ? failure : new Error(String(failure))),
      jevKey: () => Promise.resolve(undefined),
      catalog: () => Promise.resolve(DEFAULT_MODEL_CATALOG),
      close: () => undefined,
    };
  }
  const { handle } = database;
  return {
    ...base,
    pendingMigrations: () => handle.pendingMigrations(),
    jevKey: () =>
      key
        ? new SqliteSecrets(handle.db, { now: () => new Date() }, key, LOCAL_OWNER).resolve(
            JEV_SECRET,
          )
        : Promise.resolve(undefined),
    catalog: () => new SqliteModelCatalog(handle.db).list(),
    close: () => handle.close(),
  };
}

const MARK: Record<PreflightStatus, string> = { ok: 'ok', warn: 'WARN', fail: 'FAIL' };

/** A plain-text table for the terminal. */
export function formatPreflight(report: PreflightReport): string {
  const rows = report.checks.map((c) => [MARK[c.status], c.label, c.message] as const);
  const width = (i: 0 | 1, title: string) =>
    Math.max(title.length, ...rows.map((r) => r[i].length));
  const w0 = width(0, 'STATUS');
  const w1 = width(1, 'CHECK');
  const line = (a: string, b: string, c: string) => `  ${a.padEnd(w0)}  ${b.padEnd(w1)}  ${c}`;
  const failed = report.checks.filter((c) => c.status === 'fail').length;
  const warned = report.checks.filter((c) => c.status === 'warn').length;
  return [
    'GraphGoblin preflight',
    '',
    line('STATUS', 'CHECK', 'DETAIL'),
    ...rows.map((r) => line(r[0], r[1], r[2])),
    '',
    `${String(failed)} failed, ${String(warned)} warning(s): ${
      report.ok ? 'ready to start' : 'fix the failed checks before starting'
    }`,
    '',
  ].join('\n');
}

export interface PreflightCliOptions extends ConfigPreflightOptions {
  env?: NodeJS.ProcessEnv;
  write?: (text: string) => void;
}

/** `graphgoblin-api --preflight`: print the checks and return the exit code (0 unless a check failed). */
export async function runPreflightCli(options: PreflightCliOptions = {}): Promise<number> {
  const write = options.write ?? ((text: string) => process.stdout.write(text));
  let config: ApiConfig;
  try {
    config = loadConfig(options.env ?? process.env);
  } catch (error) {
    write(`GraphGoblin preflight\n\n  FAIL  configuration  ${message(error)}\n`);
    return 1;
  }
  const sources = await configPreflightSources(config, options);
  try {
    const report = await runPreflight(sources);
    write(formatPreflight(report));
    return report.ok ? 0 : 1;
  } finally {
    sources.close();
  }
}
