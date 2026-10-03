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

/** Parse the arguments after `--create-api-key`. Returns an error message when they are unusable. */
export function parseCreateApiKeyArgs(argv: readonly string[]): CreateApiKeyArgs | string {
  const at = argv.indexOf('--create-api-key');
  const label = at >= 0 ? argv[at + 1] : undefined;
  if (label === undefined || label.startsWith('--') || label.trim() === '') {
    return 'a key name is required';
  }
  if (label.length > 120) return 'the key name is longer than 120 characters';
  let scopes = ['*'];
  const flag = argv.findIndex((arg) => arg === '--scopes' || arg.startsWith('--scopes='));
  if (flag >= 0) {
    const raw = argv[flag]?.includes('=') ? argv[flag].slice('--scopes='.length) : argv[flag + 1];
    scopes = (raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
    if (scopes.length === 0)
      return '--scopes needs a comma-separated list, for example loops:write,runs:write';
  }
  return { label: label.trim(), scopes };
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
