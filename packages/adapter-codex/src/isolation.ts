import type { CodexOptions } from '@openai/codex-sdk';
import type { CliCommand, CliRunner } from './cli.js';

/**
 * Loop turns run without the machine's personal Codex extensions (ADR-0063).
 *
 * The CLI loads `~/.codex/config.toml` (and a trusted project's `.codex/config.toml`) for every
 * turn. Without these defaults a loop turn starts the machine's MCP servers, installed and remote
 * plugins (with their own MCP servers), ChatGPT apps, memories, goals, sub-agents, lifecycle hooks
 * and the `notify` program. Verified against CLI 0.160.0 (docs/qa/2026-10-28-wp-423-isolation):
 *
 * - `features.<name>=false` switches a feature off; `features.plugins=false` removes every local
 *   and remote plugin and the MCP servers they bring.
 * - `--config` overrides merge into the loaded tables, so `mcp_servers={}` clears nothing and a
 *   non-table value fails the configuration. Each configured server is switched off by name with
 *   `mcp_servers.<name>.enabled=false`; naming a server that is not configured also fails the
 *   configuration, so the names come from the CLI itself (`codex mcp list --json`).
 * - Arrays replace, so `notify=[]` removes the turn-completion program.
 * - Among repeated `--config` keys the last one wins.
 *
 * Order of the `--config` arguments: server switches, these defaults, then the node's own
 * `configOverrides` (so a node turns one server back on with `mcp_servers.<name>.enabled=true`,
 * or every plugin with `features.plugins=true`), then the SDK's thread options, which no override
 * can weaken.
 *
 * Every key segment that reaches `--config`, a listed server name or a node override key, must be
 * one plain TOML key (letters, digits, `_`, `-`) and not `__proto__`, `constructor` or
 * `prototype` (QA423-01, review round 1). Anything else refuses the turn before it starts, and
 * the configuration is built from prototype-free tables.
 */

type Config = NonNullable<CodexOptions['config']>;
type ConfigValue = Config[string];

const isTable = (value: unknown): value is Config =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Names a JavaScript object treats as its prototype or constructor rather than as data. */
const PROTOTYPE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/** One plain TOML key the loop may pass through `--config`. */
export function plainSegment(segment: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(segment) && !PROTOTYPE_SEGMENTS.has(segment);
}

/**
 * The first key path in an authored configuration with a segment that is not plain, if any.
 * Dotted keys are split as the CLI splits them; tables inside arrays are checked too.
 */
export function unplainKey(value: unknown, prefix = ''): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = unplainKey(item, prefix);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isTable(value)) return undefined;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!key.split('.').every(plainSegment)) return path;
    const found = unplainKey(child, path);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** A node override the loop refuses to pass: the pinned definition cannot run as authored. */
export function overrideRefusal(path: string): Error {
  return Object.assign(
    new Error(
      `The Codex config override key ${JSON.stringify(path.slice(0, 200))} cannot be passed through --config, so the turn did not start: every key segment must be letters, digits, "_" or "-", and not __proto__, constructor or prototype.`,
    ),
    {
      code: 'HARNESS_INVALID_CONFIGURATION',
      retriable: false,
      submission: 'definitely-not-submitted' as const,
    },
  );
}

/**
 * Features that bring the machine's own installs, account connectors or personal state into a
 * turn, or change what an unattended turn can do: plugins, ChatGPT apps, memories, lifecycle
 * hooks, sub-agent spawning (`multi_agent`) and goals. The CLI's own code-mode host
 * (`code_mode_host`) is its tool host, not an extension, and stays on: without it a turn runs no
 * command.
 */
export const ISOLATED_FEATURES = [
  'plugins',
  'apps',
  'memories',
  'hooks',
  'multi_agent',
  'goals',
] as const;

/**
 * A configuration table whose keys are all its own (QA423-01). Server names and authored keys
 * such as `__proto__`, `constructor` or `toString` are ordinary keys to the CLI. A table without
 * a prototype stores and reads them as ordinary keys; on a plain object, assigning `__proto__`
 * changes the prototype instead and the key is lost, and the other names read inherited members.
 */
export function table(entries: Iterable<readonly [string, ConfigValue]> = []): Config {
  const out = Object.create(null) as Config;
  for (const [key, value] of entries) out[key] = value;
  return out;
}

/** The defaults every loop turn starts from, before the node's overrides. */
export function isolationDefaults(): Config {
  return table([
    ['features', table(ISOLATED_FEATURES.map((name) => [name, false] as const))],
    ['notify', []],
  ]);
}

/** `mcp_servers.<name>.enabled=false` for each server the machine configures, in listed order. */
export function serverSwitches(names: readonly string[]): Config {
  return names.length
    ? table([
        ['mcp_servers', table(names.map((name) => [name, table([['enabled', false]])] as const))],
      ])
    : table();
}

/** Dotted keys become nested tables, as the CLI splits every `--config` key on dots. */
function expand(config: Config): Config {
  const out = table();
  for (const [key, raw] of Object.entries(config)) {
    const value = isTable(raw) ? expand(raw) : raw;
    const path = key.split('.');
    const leaf = path.pop()!;
    let current = out;
    for (const part of path) {
      const next = current[part];
      current = current[part] = isTable(next) ? next : table();
    }
    const existing = current[leaf];
    current[leaf] = isTable(value) && isTable(existing) ? merge(existing, value) : value;
  }
  return out;
}

function merge(base: Config, override: Config): Config {
  const out = table(Object.entries(base));
  for (const [key, value] of Object.entries(override)) {
    const current = out[key];
    out[key] = isTable(current) && isTable(value) ? merge(current, value) : value;
  }
  return out;
}

/**
 * Layer configurations; a later layer wins key path by key path. Arrays and scalars replace,
 * tables merge, as the CLI layers its own configuration.
 */
export function layerConfig(...layers: Config[]): Config {
  return layers.reduce<Config>((acc, layer) => merge(acc, expand(layer)), table());
}

/** The CLI's own words for a failure: its non-empty lines joined, bounded to 300 characters. */
function excerpt(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' | ')
    .slice(0, 300);
}

function listingFailure(
  code: 'HARNESS_NOT_INSTALLED' | 'HARNESS_TURN_FAILED',
  reason: string,
): Error {
  return Object.assign(
    new Error(
      `Codex could not list the machine's MCP servers, so the turn did not start: ${reason}`,
    ),
    { code, retriable: false, submission: 'definitely-not-submitted' as const },
  );
}

/** The listing switches off the same features as the turn, so plugin servers are not listed. */
export const LISTING_ARGS = [
  'mcp',
  'list',
  '--json',
  ...ISOLATED_FEATURES.flatMap((name) => ['--config', `features.${name}=false`]),
];

/**
 * The names of the MCP servers the CLI would start in `cwd`, read from the CLI itself so every
 * configuration layer it loads (user, profile, trusted project) is included.
 */
export async function configuredServers(
  cli: CliCommand | undefined,
  run: CliRunner,
  timeoutMs: number,
  cwd: string | undefined,
  signal: AbortSignal | undefined,
): Promise<string[]> {
  if (!cli) throw listingFailure('HARNESS_NOT_INSTALLED', 'the Codex CLI was not found.');
  const result = await run({ ...cli, ...(cwd ? { cwd } : {}) }, LISTING_ARGS, timeoutMs, signal);
  if (result.spawnError !== undefined)
    throw listingFailure(
      /enoent/i.test(result.spawnError) ? 'HARNESS_NOT_INSTALLED' : 'HARNESS_TURN_FAILED',
      `the CLI did not run (${result.spawnError}).`,
    );
  if (result.code !== 0)
    throw listingFailure(
      'HARNESS_TURN_FAILED',
      `mcp list exited ${result.code}: ${excerpt(result.output)}`,
    );
  // Only stdout carries the JSON; warnings or logs the CLI writes to stderr are not part of it.
  let listed: unknown;
  try {
    listed = JSON.parse(result.stdout);
  } catch {
    throw listingFailure(
      'HARNESS_TURN_FAILED',
      `mcp list printed no JSON: ${excerpt(result.stdout)}`,
    );
  }
  if (
    !Array.isArray(listed) ||
    !listed.every((entry) => isTable(entry) && typeof entry['name'] === 'string')
  )
    throw listingFailure('HARNESS_TURN_FAILED', 'mcp list printed an unexpected shape.');
  const names = listed.map((entry) => (entry as { name: string }).name);
  // Validated before any argument is built: a name the loop cannot pass as one plain key stops
  // the turn rather than leaving that server enabled (QA423-01).
  const unusable = names.find((name) => !plainSegment(name));
  if (unusable !== undefined)
    throw listingFailure(
      'HARNESS_TURN_FAILED',
      `the server name ${JSON.stringify(unusable.slice(0, 100))} cannot be switched off through --config.`,
    );
  return names;
}
