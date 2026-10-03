/**
 * @graphgoblin/api
 *
 * The gateway: REST + SSE over the engine, composed with the SQLite, filesystem, process, HTTP,
 * and scheduler adapters. `main.ts` is the process entry point; everything here is importable
 * for tests and for the OpenAPI emitter.
 */
export * from './config.js';
export * from './container.js';
export * from './app.js';
export * from './event-bus.js';
export * from './ids.js';
export * from './master-key.js';
export * from './types.js';
export { streamRunEvents } from './sse.js';
export { problem } from './plugins/errors.js';
export type { AuthContext } from './plugins/auth.js';
export { emitOpenApi } from './emit-openapi.js';
export * from './preflight.js';
