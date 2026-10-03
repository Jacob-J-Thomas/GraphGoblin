import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { SqliteApiKeys, databaseFilePath, openDatabase } from '@graphgoblin/infrastructure/sqlite';
import { loadConfig, type ApiConfig } from './config.js';
import { LOCAL_OWNER } from './container.js';
import { UlidIds } from './ids.js';

/**
 * `graphgoblin-api --create-api-key <name> [--scopes a,b]` (docs/11): mint an API key for the
 * local owner and print it once, without starting the HTTP server. This is how the first key is
 * made when `GG_REQUIRE_API_KEY=true`, since `POST /api-keys` itself needs a key. The token goes
 * to `write` (stdout) only: nothing is logged, and only its hash is stored.
 */

export interface CreateApiKeyArgs {
  label: string;
  scopes: string[];
}

export const CREATE_API_KEY_USAGE =
  'usage: graphgoblin-api --create-api-key <name> [--scopes scope1,scope2]  (default scopes: *)';

const SCOPE = /^[A-Za-z0-9*][A-Za-z0-9:*_.-]*$/;
const SCOPES_HINT = '--scopes needs a comma-separated list, for example loops:write,runs:write';

/**
 * Parse the command line strictly: exactly `--create-api-key <name>` and at most one `--scopes`
 * (`--scopes a,b` or `--scopes=a,b`). Anything else (an unknown or repeated option, a stray
 * argument, a missing value) is an error, so a typo can never fall back to a wildcard key.
 * Returns an error message when the arguments are unusable.
 */
export function parseCreateApiKeyArgs(argv: readonly string[]): CreateApiKeyArgs | string {
  let label: string | undefined;
  let rawScopes: string | undefined;
  const isValue = (value: string | undefined): value is string =>
    value !== undefined && !value.startsWith('-');
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === '--create-api-key') {
      if (label !== undefined) return '--create-api-key is given more than once';
      const value = argv[i + 1];
      if (!isValue(value) || value.trim() === '') return 'a key name is required';
      label = value.trim();
      i += 1;
    } else if (arg === '--scopes' || arg.startsWith('--scopes=')) {
      if (rawScopes !== undefined) return '--scopes is given more than once';
      const value = arg === '--scopes' ? argv[i + 1] : arg.slice('--scopes='.length);
      if (!isValue(value)) return SCOPES_HINT;
      rawScopes = value;
      if (arg === '--scopes') i += 1;
    } else if (arg.startsWith('-')) {
      return `unknown option ${arg}`;
    } else {
      return `unexpected argument "${arg}"`;
    }
  }
  if (label === undefined) return 'a key name is required';
  if (label.length > 120) return 'the key name is longer than 120 characters';
  if (rawScopes === undefined) return { label, scopes: ['*'] };
  const scopes = rawScopes.split(',').map((scope) => scope.trim());
  // An empty entry (a leading, trailing, or doubled comma) is a typo, never silently dropped.
  if (scopes.some((scope) => scope === '')) return SCOPES_HINT;
  const bad = scopes.find((scope) => !SCOPE.test(scope));
  if (bad !== undefined) return `"${bad}" is not a scope name`;
  return { label, scopes };
}

export interface CreateApiKeyCliOptions {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  /** Standard output. The token is written here and nowhere else. */
  write?: (text: string) => void;
  /** Standard error, for usage and failures (never the token). */
  writeError?: (text: string) => void;
}

/** Create the key in the configured database (migrating it first, as a server start would). */
export async function createApiKey(
  config: ApiConfig,
  args: CreateApiKeyArgs,
): Promise<{ id: string; token: string; scopes: string[] }> {
  if (!config.dbUrl.startsWith(':memory:') && !config.dbUrl.includes('mode=memory')) {
    await mkdir(config.dataDir, { recursive: true });
  }
  const dbFile = databaseFilePath(config.dbUrl);
  if (dbFile) await mkdir(dirname(dbFile), { recursive: true });
  const handle = openDatabase({ url: config.dbUrl });
  try {
    await handle.migrate();
    const clock = { now: () => new Date() };
    const keys = new SqliteApiKeys(handle.db, clock, new UlidIds(clock));
    const { record, token } = await keys.create(LOCAL_OWNER, args.label, args.scopes);
    return { id: record.id, token, scopes: record.scopes };
  } finally {
    handle.close();
  }
}

/** Run the command; returns the process exit code. */
export async function runCreateApiKeyCli(options: CreateApiKeyCliOptions = {}): Promise<number> {
  const write = options.write ?? ((text: string) => process.stdout.write(text));
  const writeError = options.writeError ?? ((text: string) => process.stderr.write(text));
  const args = parseCreateApiKeyArgs(options.argv ?? process.argv.slice(2));
  if (typeof args === 'string') {
    writeError(`${args}\n${CREATE_API_KEY_USAGE}\n`);
    return 2;
  }
  let config: ApiConfig;
  try {
    config = loadConfig(options.env ?? process.env);
  } catch (error) {
    writeError(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  try {
    const key = await createApiKey(config, args);
    write(
      [
        `Created API key "${args.label}" (id ${key.id}, scopes ${key.scopes.join(',')}).`,
        'Copy the token now; it is shown only this once and only its hash is stored:',
        '',
        `  ${key.token}`,
        '',
        'Send it as "Authorization: Bearer <token>", or paste it into the web app when it asks for a key.',
        '',
      ].join('\n'),
    );
    return 0;
  } catch (error) {
    writeError(
      `could not create the API key: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}
