import { parseArgs } from 'node:util';

/** Where the MCP server listens and which gateway it talks to. */
export interface McpConfig {
  /** Gateway origin. `GG_API_URL` or `--api-url`; default `http://127.0.0.1:4747`. */
  apiUrl: string;
  /** Bearer key for the gateway. `GG_API_KEY` or `--api-key`; optional in local trusted mode. */
  apiKey?: string;
  /** `stdio` (default) or `http` (Streamable HTTP, `--http`). */
  transport: 'stdio' | 'http';
  /** HTTP bind address. `GG_MCP_HOST` or `--host`; default `127.0.0.1`. */
  host: string;
  /** HTTP port. `GG_MCP_PORT` or `--port`; default 4748. `0` picks a free port. */
  port: number;
  /** `--help` was passed. */
  help: boolean;
}

export const DEFAULT_API_URL = 'http://127.0.0.1:4747';
export const DEFAULT_HTTP_PORT = 4748;

export const USAGE = `graphgoblin-mcp - GraphGoblin MCP server

Usage: graphgoblin-mcp [--api-url <url>] [--api-key <key>] [--http [--port <n>] [--host <addr>]]

  --api-url <url>   Gateway origin (env GG_API_URL, default ${DEFAULT_API_URL})
  --api-key <key>   Gateway API key (env GG_API_KEY; optional in local trusted mode)
  --http            Serve Streamable HTTP at /mcp instead of stdio
  --port <n>        HTTP port (env GG_MCP_PORT, default ${DEFAULT_HTTP_PORT}; 0 picks a free port)
  --host <addr>     HTTP bind address (env GG_MCP_HOST, default 127.0.0.1)
  -h, --help        Show this help
`;

/** Thrown for unusable flags or environment values; the message is shown to the user. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

function parsePort(raw: string): number {
  const port = Number(raw);
  if (!/^\d+$/.test(raw.trim()) || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigError(`invalid port "${raw}"; expected an integer from 0 to 65535`);
  }
  return port;
}

function parseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`invalid API URL "${raw}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError(`invalid API URL "${raw}"; expected http or https`);
  }
  return raw.replace(/\/+$/, '');
}

/** Read configuration from CLI flags, falling back to environment variables, then defaults. */
export function loadConfig(argv: readonly string[], env: NodeJS.ProcessEnv): McpConfig {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        'api-url': { type: 'string' },
        'api-key': { type: 'string' },
        http: { type: 'boolean' },
        port: { type: 'string' },
        host: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new ConfigError((error as Error).message);
  }
  const apiKey = values['api-key'] ?? (env['GG_API_KEY'] || undefined);
  const port = values.port ?? env['GG_MCP_PORT'];
  return {
    apiUrl: parseUrl(values['api-url'] ?? (env['GG_API_URL'] || DEFAULT_API_URL)),
    ...(apiKey ? { apiKey } : {}),
    transport: values.http ? 'http' : 'stdio',
    host: values.host ?? (env['GG_MCP_HOST'] || '127.0.0.1'),
    port: port ? parsePort(port) : DEFAULT_HTTP_PORT,
    help: values.help ?? false,
  };
}
