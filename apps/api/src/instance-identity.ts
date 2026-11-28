import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { bundledGoblinDist, bundledWebDist, loadConfig, type ApiConfig } from './config.js';
import { canonicalPath } from './canonical-path.js';
import { dataDirLockState, databaseLockState } from './data-dir-lock.js';
import { isPhysicalEntry } from './entry-point.js';
import { databaseFilePath } from '@graphgoblin/infrastructure/sqlite';

/**
 * Opaque instance protocol. 2 is the bounded Windows log cutover (#438): a launcher refuses warm
 * reuse of a still-serving earlier gateway, which must be stopped deliberately before upgrade.
 */
export const INSTANCE_PROTOCOL = 2;

/**
 * Version of the launch-identity projection below; the published digest carries it as a `v1:`
 * prefix (#566). Change it with the projection's shape, never silently.
 */
export const LAUNCH_IDENTITY_VERSION = 1;

/** The checkout root of this module, in both `src` and `dist`. */
const CHECKOUT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The launcher shares the repository's supported installation runtime floor. */
export function launcherRuntimeSupported(version: string): boolean {
  const match = /^22\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const minor = Number(match[1]);
  return minor > 22 || (minor === 22 && Number(match[2]) >= 2);
}

/**
 * Opaque configuration identity for local launchers; never an authentication credential. Its
 * store and serving paths come from the supplied snapshot, so a caller that also derives the launch
 * digest or enrollment metadata from that snapshot describes one observation of every alias.
 */
export function instanceIdentity(
  config: ApiConfig,
  paths: LaunchPaths = launchPaths(config),
): string {
  // Property order is explicit: the protocol-2 serialization keeps the configuration's own key
  // order, the raw non-file database value and omitted absent serving roots. Secrets never enter.
  const { masterKey: _masterKey, jevApiKey: _jevApiKey, ...publicConfig } = config;
  return createHash('sha256')
    .update(
      JSON.stringify({
        protocol: INSTANCE_PROTOCOL,
        runtime: canonicalPath(process.execPath),
        node: process.version,
        entry: canonicalPath(fileURLToPath(new URL('./main.js', import.meta.url))),
        config: {
          ...publicConfig,
          dataDir: paths.dataDir,
          dbUrl: paths.database.kind === 'file' ? paths.database.target : config.dbUrl,
          webDist: paths.webDist ?? undefined,
          goblinDist: paths.goblinDist ?? undefined,
        },
      }),
    )
    .digest('hex');
}

/**
 * The database a launch identity binds. A file keeps the decoded absolute lookup exactly as the
 * SQLite resolver produced it and its canonical target; any other database contributes only a
 * hash of its configuration, so no raw URL leaves the process.
 */
export type LaunchDatabase =
  | { readonly kind: 'file'; readonly lookup: string; readonly target: string }
  | { readonly kind: 'non-file'; readonly configuration: string };

/** One path snapshot shared by the launch digest and the enrollment's lookup/target metadata. */
export interface LaunchPaths {
  readonly checkout: string;
  readonly dataDir: string;
  readonly database: LaunchDatabase;
  readonly webDist: string | null;
  readonly goblinDist: string | null;
}

/** Resolve every path the launch identity names once, through the current resolvers. */
export function launchPaths(config: ApiConfig, checkout: string = CHECKOUT_ROOT): LaunchPaths {
  const lookup = databaseFilePath(config.dbUrl);
  return {
    checkout: canonicalPath(checkout),
    dataDir: canonicalPath(config.dataDir),
    database: lookup
      ? { kind: 'file', lookup, target: canonicalPath(lookup) }
      : {
          kind: 'non-file',
          configuration: createHash('sha256').update(config.dbUrl).digest('hex'),
        },
    webDist: config.webDist ? canonicalPath(config.webDist) : null,
    goblinDist: config.goblinDist ? canonicalPath(config.goblinDist) : null,
  };
}

type LaunchField = ((config: ApiConfig, paths: LaunchPaths) => unknown) | 'secret';

/**
 * Every ApiConfig field, in projection order, with a deliberate decision. Adding a field to
 * ApiConfig fails compilation here until it is either projected or excluded as a secret. The
 * runtime executable, Node version, entry file, build bytes and startup markers are not
 * configuration fields and never enter the projection.
 */
const LAUNCH_FIELDS = {
  host: (config) => config.host,
  port: (config) => config.port,
  dataDir: (_config, paths) => paths.dataDir,
  dbUrl: (_config, paths) =>
    paths.database.kind === 'file'
      ? { kind: 'file', target: paths.database.target }
      : { kind: 'non-file', configuration: paths.database.configuration },
  requireApiKey: (config) => config.requireApiKey,
  masterKey: 'secret',
  logLevel: (config) => config.logLevel,
  maxConcurrentRuns: (config) => config.maxConcurrentRuns,
  defaults: (config) => config.defaults,
  timerPollMs: (config) => config.timerPollMs,
  shutdownGraceMs: (config) => config.shutdownGraceMs,
  hookRateLimitPerMinute: (config) => config.hookRateLimitPerMinute,
  swaggerUi: (config) => config.swaggerUi,
  publicUrl: (config) => config.publicUrl ?? null,
  codexBinary: (config) => config.codexBinary ?? null,
  claudeBinary: (config) => config.claudeBinary ?? null,
  ollamaEnabled: (config) => config.ollamaEnabled,
  ollamaUrl: (config) => config.ollamaUrl,
  webDist: (_config, paths) => paths.webDist,
  goblinDist: (_config, paths) => paths.goblinDist,
  jevApiKey: 'secret',
} satisfies { readonly [Key in keyof ApiConfig]-?: LaunchField };

/** JSON with object keys sorted by UTF-16 code unit at every depth; absent members dropped. */
function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const members = Object.entries(value)
      .filter(([, member]) => member !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`);
    return `{${members.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The exact hashed text: an ordered list of `[name, value]` pairs. Exported for golden vectors. */
export function launchProjection(
  config: ApiConfig,
  paths: LaunchPaths,
  protocol: number = INSTANCE_PROTOCOL,
): string {
  const entries: [string, unknown][] = [
    ['version', LAUNCH_IDENTITY_VERSION],
    ['protocol', protocol],
    ['checkout', paths.checkout],
  ];
  for (const [name, field] of Object.entries(LAUNCH_FIELDS) as [keyof ApiConfig, LaunchField][])
    if (field !== 'secret') entries.push([name, field(config, paths)]);
  return canonicalJson(entries);
}

/**
 * Versioned digest of effective non-secret launch settings (#566). It attests configuration
 * equality against an ordinary wrong listener; it does not authenticate a peer. Unlike
 * `instanceIdentity`, it is independent of the runtime executable, Node version and entry file,
 * so an in-place runtime or build replacement keeps a launcher's enrollment.
 */
export function launchIdentity(
  config: ApiConfig,
  paths: LaunchPaths,
  protocol: number = INSTANCE_PROTOCOL,
): string {
  const digest = createHash('sha256').update(launchProjection(config, paths, protocol));
  return `v${LAUNCH_IDENTITY_VERSION}:${digest.digest('hex')}`;
}

/** Flat string-only record read by the Windows launcher's strict parser. */
export type LaunchEnrollment = {
  readonly version: string;
  readonly launch: string;
  readonly instance: string;
  readonly dataDir: string;
} & (
  | { readonly database: 'file'; readonly lookup: string; readonly target: string }
  | { readonly database: 'non-file' }
);

/** The launch digest, full fingerprint and store metadata, all from one path snapshot. */
export function launchEnrollment(
  config: ApiConfig,
  paths: LaunchPaths = launchPaths(config),
): LaunchEnrollment {
  const head = {
    version: String(LAUNCH_IDENTITY_VERSION),
    launch: launchIdentity(config, paths),
    instance: instanceIdentity(config, paths),
    dataDir: paths.dataDir,
  };
  return paths.database.kind === 'file'
    ? {
        ...head,
        database: 'file',
        lookup: paths.database.lookup,
        target: paths.database.target,
      }
    : { ...head, database: 'non-file' };
}

/** The launcher uses the writer's ownership policy, including both reclamation guards. */
export async function launcherStoreState(config: ApiConfig): ReturnType<typeof dataDirLockState> {
  const directory = await dataDirLockState(config.dataDir);
  if (directory.state === 'held') return directory;
  const database = databaseFilePath(config.dbUrl);
  return database ? databaseLockState(database) : { state: 'free' };
}

/** Match Node's entry module when the launcher invokes it through a checkout alias. */
export const isLauncherIdentityEntry = isPhysicalEntry;

/** One helper response line for `argv[2]`; the legacy identity remains the default mode. */
export async function launcherHelperOutput(
  config: ApiConfig,
  mode: string | undefined,
): Promise<string> {
  if (mode === '--store-state') return JSON.stringify(await launcherStoreState(config)) + '\n';
  if (mode === '--launch-enrollment') return JSON.stringify(launchEnrollment(config)) + '\n';
  return instanceIdentity(config) + '\n';
}

// This read-only helper loads configuration without opening the store or probing providers.
if (isLauncherIdentityEntry(process.argv[1], import.meta.url)) {
  try {
    if (!launcherRuntimeSupported(process.versions.node))
      throw new Error('Node 22.22.2 or later is required');
    const config = loadConfig(process.env, {
      webDistFallback: bundledWebDist(),
      goblinDistFallback: bundledGoblinDist(),
    });
    process.stdout.write(await launcherHelperOutput(config, process.argv[2]));
  } catch {
    console.error('Launcher configuration is invalid. Check the configured GG_* overrides.');
    process.exitCode = 1;
  }
}
