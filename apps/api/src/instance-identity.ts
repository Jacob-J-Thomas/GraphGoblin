import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundledGoblinDist, bundledWebDist, loadConfig, type ApiConfig } from './config.js';
import { canonicalPath } from './canonical-path.js';
import { dataDirLockState, databaseLockState } from './data-dir-lock.js';
import { databaseFilePath } from '@graphgoblin/infrastructure/sqlite';

/** The launcher shares the repository's supported installation runtime floor. */
export function launcherRuntimeSupported(version: string): boolean {
  const match = /^22\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const minor = Number(match[1]);
  return minor > 22 || (minor === 22 && Number(match[2]) >= 2);
}

/** Opaque configuration identity for local launchers; never an authentication credential. */
export function instanceIdentity(config: ApiConfig): string {
  // Property order is explicit. Secrets never enter this public fingerprint.
  const { masterKey: _masterKey, jevApiKey: _jevApiKey, ...publicConfig } = config;
  const databaseFile = databaseFilePath(config.dbUrl);
  return createHash('sha256')
    .update(
      JSON.stringify({
        protocol: 1,
        runtime: canonicalPath(process.execPath),
        node: process.version,
        entry: canonicalPath(fileURLToPath(new URL('./main.js', import.meta.url))),
        config: {
          ...publicConfig,
          dataDir: canonicalPath(config.dataDir),
          dbUrl: databaseFile ? canonicalPath(databaseFile) : config.dbUrl,
          webDist: config.webDist ? canonicalPath(config.webDist) : undefined,
          goblinDist: config.goblinDist ? canonicalPath(config.goblinDist) : undefined,
        },
      }),
    )
    .digest('hex');
}

/** The launcher uses the writer's ownership policy, including both reclamation guards. */
export async function launcherStoreState(config: ApiConfig): Promise<'free' | 'held'> {
  if ((await dataDirLockState(config.dataDir)).state === 'held') return 'held';
  const database = databaseFilePath(config.dbUrl);
  return database && (await databaseLockState(database)).state === 'held' ? 'held' : 'free';
}

// This read-only helper loads configuration without opening the store or probing providers.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!launcherRuntimeSupported(process.versions.node))
      throw new Error('Node 22.22.2 or later is required');
    const config = loadConfig(process.env, {
      webDistFallback: bundledWebDist(),
      goblinDistFallback: bundledGoblinDist(),
    });
    process.stdout.write(
      (process.argv[2] === '--store-state'
        ? await launcherStoreState(config)
        : instanceIdentity(config)) + '\n',
    );
  } catch {
    console.error('Launcher configuration is invalid. Check the configured GG_* overrides.');
    process.exitCode = 1;
  }
}
