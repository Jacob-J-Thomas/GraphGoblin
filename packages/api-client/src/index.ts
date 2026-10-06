/**
 * @graphgoblin/api-client
 *
 * A typed client for the GraphGoblin REST API, shared by the web app and the MCP server. Types are
 * generated from the API's OpenAPI document; run events stream over SSE with automatic resume.
 * Browser- and Node-compatible: it uses only `fetch`, streams, and `TextDecoderStream`.
 */
export {
  createGraphGoblinClient,
  type FetchLike,
  type GraphGoblinClient,
  type GraphGoblinClientConfig,
  type GraphGoblinClientKind,
  type GraphGoblinClientOptions,
  type components,
  type paths,
} from './client.js';
export {
  GraphGoblinApiError,
  NETWORK_ERROR_STATUS,
  unwrap,
  type FetchResult,
  type ProblemDetails,
} from './errors.js';
export {
  apiKeys,
  events,
  cron,
  loops,
  modelCatalog,
  classifierModels,
  runs,
  secrets,
  settings,
  system,
  type ListRunsQuery,
  type LoopDefinitionBody,
  type QueryParams,
  type RequestBody,
  type ResponseBody,
  type RunEventsPage,
  type RunSnapshot,
  type StartRunBody,
} from './resources.js';
export {
  RunEventParseError,
  SseParser,
  subscribeRunEvents,
  TERMINAL_RUN_EVENT_TYPES,
  type BackoffOptions,
  type RunEventSubscription,
  type SseFrame,
  type SubscribeRunEventsOptions,
} from './sse.js';
export { waitForRun, type WaitForRunOptions, type WaitForRunResult } from './wait.js';
