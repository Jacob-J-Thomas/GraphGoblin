import type { CodexOptions } from '@openai/codex-sdk';
import type { CliCommand, CliRunner } from './cli.js';

/**
 * Loop turns run without the machine's personal Codex extensions (ADR-0063).
 *
 * The CLI loads `~/.codex/config.toml` (and a trusted project's `.codex/config.toml`) for every
 * turn. Without these defaults a loop turn starts the machine's MCP servers, installed and remote
 * plugins (with their own MCP servers), ChatGPT apps, memories, lifecycle hooks and the `notify`
 * program. Verified against CLI 0.160.0 (docs/qa/2026-10-28-wp-423-isolation):
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
 */

type Config = NonNullable<CodexOptions['config']>;

/** Features that bring the machine's own installs, account connectors or personal state. */
export const ISOLATED_FEATURES = ['plugins', 'apps', 'memories', 'hooks'] as const;

/** The defaults every loop turn starts from, before the node's overrides. */
export function isolationDefaults(): Config {
  return {
    features: Object.fromEntries(ISOLATED_FEATURES.map((name) => [name, false])),
    notify: [],
  };
}

/** `mcp_servers.<name>.enabled=false` for each server the machine configures. */
export function serverSwitches(names: readonly string[]): Config {
  return names.length
    ? { mcp_servers: Object.fromEntries(names.map((name) => [name, { enabled: false }])) }
    : {};
}

const isTable = (value: unknown): value is Config =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Dotted keys become nested tables, as the CLI splits every `--config` key on dots. */
function expand(config: Config): Config {
  const out: Config = {};
  for (const [key, raw] of Object.entries(config)) {
    const value = isTable(raw) ? expand(raw) : raw;
    const path = key.split('.');
    const leaf = path.pop()!;
    let table = out;
    for (const part of path) {
      const next = table[part];
      table = table[part] = isTable(next) ? next : {};
    }
    table[leaf] = isTable(value) && isTable(table[leaf]) ? merge(table[leaf], value) : value;
  }
  return out;
}

function merge(base: Config, override: Config): Config {
  const out: Config = { ...base };
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
  return layers.reduce<Config>((acc, layer) => merge(acc, expand(layer)), {});
}

/** A server name usable as one `--config` key segment. */
const SERVER_NAME = /^[A-Za-z0-9_-]+$/;

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
  const firstLine = result.output.trim().split(/\r?\n/)[0]?.slice(0, 300) ?? '';
  if (result.code !== 0)
    throw listingFailure('HARNESS_TURN_FAILED', `mcp list exited ${result.code}: ${firstLine}`);
  let listed: unknown;
  try {
    listed = JSON.parse(result.output);
  } catch {
    throw listingFailure('HARNESS_TURN_FAILED', `mcp list printed no JSON: ${firstLine}`);
  }
  if (
    !Array.isArray(listed) ||
    !listed.every((entry) => isTable(entry) && typeof entry['name'] === 'string')
  )
    throw listingFailure('HARNESS_TURN_FAILED', 'mcp list printed an unexpected shape.');
  const names = listed.map((entry) => (entry as { name: string }).name);
  const unusable = names.find((name) => !SERVER_NAME.test(name));
  if (unusable !== undefined)
    throw listingFailure(
      'HARNESS_TURN_FAILED',
      `the server name ${JSON.stringify(unusable.slice(0, 100))} cannot be switched off through --config.`,
    );
  return names;
}
