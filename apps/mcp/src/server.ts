import { createGraphGoblinClient, type GraphGoblinClient } from '@graphgoblin/api-client';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerResources } from './resources.js';
import { registerTools, type ToolOptions } from './tools.js';

export const SERVER_NAME = 'graphgoblin';
export const SERVER_VERSION = '0.1.0';

const INSTRUCTIONS = `GraphGoblin runs agent loops: graphs of trigger, decision, inference, script, mutate, subloop, wait, heartbeat, and exit nodes.
To run a loop: list_loops, describe_loop (read the trigger inputSchema), start_run, then wait_for_run until finished is true.
If wait_for_run reports a run waiting for input, call provide_input and wait again. Use read_run_events and get_run_thread to explain what a run did.`;

/** Connection to the gateway: an existing client, or the settings to build one. */
export type GatewayOptions =
  | { client: GraphGoblinClient }
  | { apiUrl: string; apiKey?: string; fetch?: (request: Request) => Promise<Response> };

export type CreateServerOptions = GatewayOptions & ToolOptions;

/** The gateway client the MCP server uses; `client: 'mcp'` makes runs record `manual.mcp`. */
export function createGatewayClient(options: GatewayOptions): GraphGoblinClient {
  if ('client' in options) return options.client;
  return createGraphGoblinClient({
    baseUrl: options.apiUrl,
    client: 'mcp',
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}

/** A GraphGoblin MCP server with every tool and resource registered, not yet connected. */
export function createMcpServer(options: CreateServerOptions): McpServer {
  const client = createGatewayClient(options);
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION, title: 'GraphGoblin' },
    { instructions: INSTRUCTIONS, capabilities: { tools: {}, resources: {} } },
  );
  registerTools(server, client, options);
  registerResources(server, client);
  return server;
}
