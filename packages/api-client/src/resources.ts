/**
 * Thin convenience wrappers over the typed client, grouped by resource. Every function takes the
 * client first, returns the response body, and throws `GraphGoblinApiError` on a non-2xx response.
 * Argument and return types come from the generated OpenAPI schema.
 */
import type { GraphGoblinClient, paths } from './client.js';
import { unwrap } from './errors.js';

type Method = 'get' | 'put' | 'patch' | 'post' | 'delete';

/** The JSON request body of an operation. */
export type RequestBody<P extends keyof paths, M extends Method> = paths[P][M] extends {
  requestBody?: { content: { 'application/json': infer B } };
}
  ? B
  : never;

/** The query parameters of an operation. */
export type QueryParams<P extends keyof paths, M extends Method> = paths[P][M] extends {
  parameters: { query?: infer Q };
}
  ? NonNullable<Q>
  : never;

/** The 2xx JSON response body of an operation. */
export type ResponseBody<P extends keyof paths, M extends Method> = paths[P][M] extends {
  responses: infer R;
}
  ? {
      [S in keyof R]: S extends 200 | 201 | 202
        ? R[S] extends { content: { 'application/json': infer B } }
          ? B
          : never
        : never;
    }[keyof R]
  : never;

export type LoopDefinitionBody = RequestBody<'/loops', 'post'>['definition'];
export type StartRunBody = RequestBody<'/loops/{id}/runs', 'post'>;
export type ListRunsQuery = QueryParams<'/runs', 'get'>;
export type RunSnapshot = ResponseBody<'/runs/{id}', 'get'>;
export type RunEventsPage = ResponseBody<'/runs/{id}/events', 'get'>;

const id = (value: string) => ({ params: { path: { id: value } } });

export const loops = {
  list: async (client: GraphGoblinClient) => unwrap(await client.GET('/loops')).items,
  create: async (client: GraphGoblinClient, definition: LoopDefinitionBody) =>
    unwrap(await client.POST('/loops', { body: { definition } })),
  get: async (client: GraphGoblinClient, loopId: string) =>
    unwrap(await client.GET('/loops/{id}', id(loopId))),
  /**
   * Save the draft. With `ifMatch` (a `draftToken` from `get` or an earlier save) a stale copy is
   * refused with `DRAFT_CONFLICT` (409) instead of overwriting a newer server draft; the error's
   * `problem.draftToken` is the server's current token.
   */
  saveDraft: async (
    client: GraphGoblinClient,
    loopId: string,
    definition: LoopDefinitionBody,
    options: { ifMatch?: string } = {},
  ) =>
    unwrap(
      await client.PUT('/loops/{id}/draft', {
        params: {
          path: { id: loopId },
          ...(options.ifMatch ? { header: { 'if-match': `"${options.ifMatch}"` } } : {}),
        },
        body: { definition },
      }),
    ),
  validate: async (client: GraphGoblinClient, loopId: string, definition: LoopDefinitionBody) => {
    const result = unwrap(
      await client.POST('/loops/{id}/validate', { ...id(loopId), body: { definition } }),
    );
    // JSON omits undefined fields. Preserve that guarantee for exact optional consumer types.
    return {
      ...result,
      issues: result.issues.map(({ path, ...issue }) =>
        path === undefined ? issue : { ...issue, path },
      ),
    };
  },
  publish: async (client: GraphGoblinClient, loopId: string) =>
    unwrap(await client.POST('/loops/{id}/publish', id(loopId))).version,
  versions: async (client: GraphGoblinClient, loopId: string) =>
    unwrap(await client.GET('/loops/{id}/versions', id(loopId))).items,
  version: async (client: GraphGoblinClient, loopId: string, versionId: string) =>
    unwrap(
      await client.GET('/loops/{id}/versions/{versionId}', {
        params: { path: { id: loopId, versionId } },
      }),
    ),
  /** The published version as portable JSON; `{ draft: true }` exports the draft instead. */
  export: async (client: GraphGoblinClient, loopId: string, options: { draft?: boolean } = {}) =>
    unwrap(
      await client.GET('/loops/{id}/export', {
        params: {
          path: { id: loopId },
          ...(options.draft ? { query: { draft: 'true' as const } } : {}),
        },
      }),
    ),
  import: async (client: GraphGoblinClient, exported: RequestBody<'/loops/import', 'post'>) =>
    unwrap(await client.POST('/loops/import', { body: exported })),
  remove: async (client: GraphGoblinClient, loopId: string): Promise<void> => {
    unwrap(await client.DELETE('/loops/{id}', id(loopId)));
  },
};

export const runs = {
  /** Start a run from a manual trigger. Returns the queued run; it executes in the background. */
  start: async (client: GraphGoblinClient, loopId: string, body: StartRunBody = {}) =>
    unwrap(await client.POST('/loops/{id}/runs', { ...id(loopId), body })).run,
  list: async (client: GraphGoblinClient, query: ListRunsQuery = {}) =>
    unwrap(await client.GET('/runs', { params: { query } })).items,
  get: async (client: GraphGoblinClient, runId: string) =>
    unwrap(await client.GET('/runs/{id}', id(runId))),
  thread: async (client: GraphGoblinClient, runId: string) =>
    unwrap(await client.GET('/runs/{id}/thread', id(runId))),
  /** One page of the persisted event log after `after`; use `subscribeRunEvents` for a live tail. */
  events: async (
    client: GraphGoblinClient,
    runId: string,
    query: QueryParams<'/runs/{id}/events', 'get'> = {},
  ) => unwrap(await client.GET('/runs/{id}/events', { params: { path: { id: runId }, query } })),
  cancel: async (client: GraphGoblinClient, runId: string) =>
    unwrap(await client.POST('/runs/{id}/cancel', id(runId))),
  pause: async (client: GraphGoblinClient, runId: string) =>
    unwrap(await client.POST('/runs/{id}/pause', id(runId))),
  resume: async (client: GraphGoblinClient, runId: string) =>
    unwrap(await client.POST('/runs/{id}/resume', id(runId))),
  /** Answer a wait node in input mode. */
  provideInput: async (
    client: GraphGoblinClient,
    runId: string,
    input: RequestBody<'/runs/{id}/input', 'post'>['input'],
  ) => unwrap(await client.POST('/runs/{id}/input', { ...id(runId), body: { input } })),
  /** Deliver a named signal; `woke` says whether a waiting node consumed it. */
  signal: async (
    client: GraphGoblinClient,
    runId: string,
    name: string,
    payload?: RequestBody<'/runs/{id}/signals/{name}', 'post'>['payload'],
  ) =>
    unwrap(
      await client.POST('/runs/{id}/signals/{name}', {
        params: { path: { id: runId, name } },
        body: payload === undefined ? {} : { payload },
      }),
    ),
  sessions: async (client: GraphGoblinClient, runId: string) =>
    unwrap(await client.GET('/runs/{id}/sessions', id(runId))).items,
  /** Fork a new run at `nodeId` with the thread from just before that node. Returns the queued fork. */
  replay: async (client: GraphGoblinClient, runId: string, nodeId: string) =>
    unwrap(await client.POST('/runs/{id}/replay', { ...id(runId), body: { nodeId } })).run,
};

export const settings = {
  get: async (client: GraphGoblinClient) => unwrap(await client.GET('/settings')),
  update: async (client: GraphGoblinClient, values: RequestBody<'/settings', 'put'>) =>
    unwrap(await client.PUT('/settings', { body: values })),
  remove: async (client: GraphGoblinClient, key: string): Promise<void> => {
    unwrap(await client.DELETE('/settings/{key}', { params: { path: { key } } }));
  },
};

export const secrets = {
  /** Names and timestamps only; values are never returned. */
  list: async (client: GraphGoblinClient) => unwrap(await client.GET('/secrets')).items,
  set: async (client: GraphGoblinClient, name: string, value: string) =>
    unwrap(await client.PUT('/secrets/{name}', { params: { path: { name } }, body: { value } })),
  remove: async (client: GraphGoblinClient, name: string): Promise<void> => {
    unwrap(await client.DELETE('/secrets/{name}', { params: { path: { name } } }));
  },
};

export const apiKeys = {
  list: async (client: GraphGoblinClient) => unwrap(await client.GET('/api-keys')).items,
  /** Create a key. The plaintext `token` is returned once and never again. */
  create: async (client: GraphGoblinClient, body: RequestBody<'/api-keys', 'post'>) =>
    unwrap(await client.POST('/api-keys', { body })),
  revoke: async (client: GraphGoblinClient, keyId: string): Promise<void> => {
    unwrap(await client.DELETE('/api-keys/{id}', id(keyId)));
  },
};

export const modelCatalog = {
  list: async (client: GraphGoblinClient) => unwrap(await client.GET('/model-catalog')).items,
  setEnabled: async (client: GraphGoblinClient, harness: string, model: string, enabled: boolean) =>
    unwrap(
      await client.PATCH('/model-catalog/{harness}/{model}', {
        params: { path: { harness, model } },
        body: { enabled },
      }),
    ),
  upsert: async (
    client: GraphGoblinClient,
    harness: string,
    model: string,
    entry: RequestBody<'/model-catalog/{harness}/{model}', 'put'>,
  ) =>
    unwrap(
      await client.PUT('/model-catalog/{harness}/{model}', {
        params: { path: { harness, model } },
        body: entry,
      }),
    ),
  remove: async (client: GraphGoblinClient, harness: string, model: string): Promise<void> => {
    unwrap(
      await client.DELETE('/model-catalog/{harness}/{model}', {
        params: { path: { harness, model } },
      }),
    );
  },
};

export const events = {
  /** Publish an inbound event on the bus. */
  publish: async (client: GraphGoblinClient, event: RequestBody<'/events', 'post'>) =>
    unwrap(await client.POST('/events', { body: event })),
  list: async (client: GraphGoblinClient) => unwrap(await client.GET('/events')).items,
};

export const system = {
  health: async (client: GraphGoblinClient) => unwrap(await client.GET('/healthz')),
  version: async (client: GraphGoblinClient) => unwrap(await client.GET('/version')),
  /** Is each configured harness installed and authenticated? */
  preflight: async (client: GraphGoblinClient) =>
    unwrap(await client.GET('/harness/preflight')).items,
  /** First-run checks for the whole installation: `{ ok, checks: [{ id, label, status, message }] }`. */
  installation: async (client: GraphGoblinClient) => unwrap(await client.GET('/system/preflight')),
};
