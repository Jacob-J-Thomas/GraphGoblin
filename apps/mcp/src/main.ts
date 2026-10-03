#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Readable, Writable } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ConfigError } from './config.js';
import { loadConfig, USAGE } from './config.js';
import { startHttpServer } from './http.js';
import { createMcpServer } from './server.js';
import type { ToolOptions } from './tools.js';

export interface MainIo {
  /** Protocol input for stdio mode. Default `process.stdin`. */
  stdin?: Readable;
  /** Protocol output for stdio mode. Default `process.stdout`. */
  stdout?: Writable;
  /** Diagnostics. Never stdout: in stdio mode stdout carries the protocol. Default `console.error`. */
  log?: (line: string) => void;
  /** Gateway fetch override, for tests. */
  fetch?: (request: Request) => Promise<Response>;
  /** Tool options, for tests. */
  tools?: ToolOptions;
}

export interface Started {
  /** Non-zero when the server did not start. */
  exitCode: number;
  /** The Streamable HTTP endpoint in `--http` mode. */
  url?: string;
  close(): Promise<void>;
}

const noop = (): Promise<void> => Promise.resolve();

/** Parse configuration and start the server on stdio or Streamable HTTP. */
export async function main(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  io: MainIo = {},
): Promise<Started> {
  const log = io.log ?? ((line: string) => console.error(line));
  let config;
  try {
    config = loadConfig(argv, env);
  } catch (error) {
    // loadConfig reports every problem as a ConfigError.
    log(`graphgoblin-mcp: ${(error as ConfigError).message}\n\n${USAGE}`);
    return { exitCode: 2, close: noop };
  }
  if (config.help) {
    log(USAGE);
    return { exitCode: 0, close: noop };
  }
  const options = {
    apiUrl: config.apiUrl,
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    ...(io.fetch ? { fetch: io.fetch } : {}),
    ...io.tools,
  };

  if (config.transport === 'http') {
    const http = await startHttpServer({
      createServer: () => createMcpServer(options),
      host: config.host,
      port: config.port,
    });
    log(`graphgoblin-mcp: Streamable HTTP on ${http.url} (gateway ${config.apiUrl})`);
    return { exitCode: 0, url: http.url, close: () => http.close() };
  }

  const server = createMcpServer(options);
  await server.connect(new StdioServerTransport(io.stdin, io.stdout));
  log(`graphgoblin-mcp: stdio (gateway ${config.apiUrl})`);
  return { exitCode: 0, close: () => server.close() };
}

/** True when `entry` (normally `process.argv[1]`) is this module, through any symlink or shim. */
export function isEntryPoint(entry: string | undefined, moduleUrl: string): boolean {
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

// Process wiring, exercised by running the binary (and the LIVE=1 Codex check).
if (isEntryPoint(process.argv[1], import.meta.url)) {
  main(process.argv.slice(2), process.env).then(
    (started) => {
      if (started.exitCode !== 0) process.exit(started.exitCode);
      const stop = (): void => void started.close().then(() => process.exit(0));
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    },
    (error: unknown) => {
      console.error(error);
      process.exit(1);
    },
  );
}
