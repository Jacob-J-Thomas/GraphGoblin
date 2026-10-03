/**
 * @graphgoblin/mcp
 *
 * The GraphGoblin MCP server: loop and run tools plus run resources for agents, as a thin client of
 * the gateway API through `@graphgoblin/api-client`. Runs on stdio (the `graphgoblin-mcp` binary)
 * or Streamable HTTP (`--http`). See docs/07-api-and-streaming.md.
 */
export {
  ConfigError,
  DEFAULT_API_URL,
  DEFAULT_HTTP_PORT,
  loadConfig,
  type McpConfig,
} from './config.js';
export { describeDefinition, describeLoop, summarizeLoop, summarizeRun } from './describe.js';
export {
  MCP_PATH,
  startHttpServer,
  type HttpServerOptions,
  type RunningHttpServer,
} from './http.js';
export { isEntryPoint, main, type MainIo, type Started } from './main.js';
export { MAX_RESOURCE_EVENTS, readAllEvents, registerResources } from './resources.js';
export { describeError, McpToolError, ok, toolError } from './results.js';
export {
  createGatewayClient,
  createMcpServer,
  SERVER_NAME,
  SERVER_VERSION,
  type CreateServerOptions,
  type GatewayOptions,
} from './server.js';
export {
  DEFAULT_WAIT_SECONDS,
  MAX_WAIT_SECONDS,
  registerTools,
  resolveLoop,
  type ToolOptions,
} from './tools.js';
