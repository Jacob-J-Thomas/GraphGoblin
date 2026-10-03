/**
 * An in-memory stand-in for the GraphGoblin API, used as the `fetch` of the real api-client in
 * component tests. It implements the routes the web app calls, records every request, and can
 * stream run events over SSE with events pushed while the stream is open.
 */
import type {
  ContextThread,
  LoopDefinitionInput,
  LoopRecord,
  LoopVersionRecord,
  RunEvent,
  RunRecord,
} from '@graphgoblin/contracts';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { fakeUlid, sampleThread } from '@graphgoblin/contracts/testing';
import { validateLoop } from '@graphgoblin/domain';

export const TS = '2026-10-02T12:00:00.000Z';

export interface RecordedCall {
  method: string;
  path: string;
  search: URLSearchParams;
  body: unknown;
  headers: Headers;
}

type Handler = (call: RecordedCall, params: string[]) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function problem(status: number, code: string, detail?: string, errors?: unknown): Response {
  return new Response(
    JSON.stringify({ type: 'about:blank', title: code, status, code, detail, errors }),
    {
      status,
      headers: { 'content-type': 'application/problem+json' },
    },
  );
}

let counter = 0;
export function id(seed: string): string {
  counter += 1;
  return fakeUlid(`${seed}-${counter}`);
}

export function runRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: id('run'),
    ownerId: 'local',
    loopId: id('loop'),
    versionId: id('version'),
    invocationId: id('invocation'),
    status: 'running',
    iteration: 1,
    createdAt: TS,
    startedAt: TS,
    lastEventSeq: 0,
    ...overrides,
  };
}

export class FakeApi {
  loops = new Map<
    string,
    { loop: LoopRecord; draft?: LoopVersionRecord; current?: LoopVersionRecord }
  >();
  runs = new Map<string, RunRecord>();
  threads = new Map<string, ContextThread>();
  events = new Map<string, RunEvent[]>();
  catalog: {
    harness: string;
    model: string;
    displayName: string;
    efforts: string[];
    defaultEffort: string;
    enabled: boolean;
  }[] = [];
  secretList: { name: string; createdAt: string; updatedAt: string }[] = [];
  apiKeyList: {
    id: string;
    ownerId: string;
    label: string;
    scopes: string[];
    createdAt: string;
    revokedAt?: string;
  }[] = [];
  settingsValues: Record<string, unknown> = {};
  inbound: {
    id: string;
    ownerId: string;
    type: string;
    payload: unknown;
    receivedAt: string;
    dedupeKey?: string;
    source: string;
    runIds: string[];
  }[] = [];
  preflight = [
    { harness: 'codex', ok: true, version: '1.0', authenticated: true, problems: [] as string[] },
  ];
  calls: RecordedCall[] = [];
  /** When true every request fails like a dropped network. */
  offline = false;
  /** When set, every request without `Bearer <requiredKey>` is a 401, as with GG_REQUIRE_API_KEY. */
  requiredKey: string | undefined;
  /** Issues only the real API finds (cron syntax, subloop references), for validate and publish. */
  serverOnlyIssues: {
    code: string;
    severity: 'error' | 'warning';
    message: string;
    nodeId?: string;
  }[] = [];
  private overrides = new Map<string, Handler>();
  private streams = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();

  /** Replace the handler for `METHOD /path/pattern` (`:id` matches one segment). */
  override(route: string, handler: Handler): void {
    this.overrides.set(route, handler);
  }

  addLoop(
    definition: LoopDefinitionInput,
    options: { published?: boolean; draft?: boolean } = {},
  ): LoopRecord {
    const loopId = id('loop');
    const parsed = LoopDefinitionSchema.parse(definition);
    const version = (status: 'draft' | 'published', n: number): LoopVersionRecord => ({
      id: id('version'),
      loopId,
      version: n,
      status,
      definition: parsed,
      createdAt: TS,
      ...(status === 'published' ? { publishedAt: TS } : {}),
    });
    const current = options.published ? version('published', 1) : undefined;
    const draft = (options.draft ?? !options.published) ? version('draft', 2) : undefined;
    const loop: LoopRecord = {
      id: loopId,
      ownerId: 'local',
      name: parsed.name,
      ...(parsed.description ? { description: parsed.description } : {}),
      ...(current ? { currentVersionId: current.id } : {}),
      ...(draft ? { draftVersionId: draft.id } : {}),
      createdAt: TS,
      updatedAt: TS,
    };
    this.loops.set(loopId, { loop, ...(draft ? { draft } : {}), ...(current ? { current } : {}) });
    return loop;
  }

  addRun(overrides: Partial<RunRecord> = {}, thread?: ContextThread): RunRecord {
    const run = runRecord(overrides);
    this.runs.set(run.id, run);
    this.threads.set(
      run.id,
      thread ??
        sampleThread({
          run: { id: run.id, loopId: run.loopId, versionId: run.versionId, iteration: 1 },
        }),
    );
    this.events.set(run.id, []);
    return run;
  }

  /** Append an event to a run's log and to every open stream for it. */
  pushEvent(runId: string, event: RunEvent): void {
    this.events.get(runId)?.push(event);
    const frame = new TextEncoder().encode(
      `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
    );
    for (const controller of this.streams.get(runId) ?? []) controller.enqueue(frame);
  }

  /** Close every open stream for a run, as a dropped connection would. */
  dropStreams(runId: string): void {
    for (const controller of this.streams.get(runId) ?? []) controller.close();
    this.streams.delete(runId);
  }

  callsTo(method: string, path: string | RegExp): RecordedCall[] {
    return this.calls.filter(
      (c) =>
        c.method === method && (typeof path === 'string' ? c.path === path : path.test(c.path)),
    );
  }

  fetch = async (request: Request): Promise<Response> => {
    if (this.offline) throw new TypeError('Failed to fetch');
    const url = new URL(request.url);
    const text =
      request.method === 'GET' || request.method === 'DELETE' ? '' : await request.text();
    const call: RecordedCall = {
      method: request.method,
      path: url.pathname,
      search: url.searchParams,
      body: text ? (JSON.parse(text) as unknown) : undefined,
      headers: request.headers,
    };
    this.calls.push(call);
    if (this.requiredKey && request.headers.get('authorization') !== `Bearer ${this.requiredKey}`)
      return problem(401, 'UNAUTHORIZED', 'an API key is required');
    for (const [route, handler] of this.overrides) {
      const params = match(route, call);
      if (params) return handler(call, params);
    }
    for (const [route, handler] of this.routes) {
      const params = match(route, call);
      if (params) return handler(call, params);
    }
    return problem(404, 'NOT_FOUND', `${call.method} ${call.path}`);
  };

  private stream(runId: string, after: number): Response {
    const events = (this.events.get(runId) ?? []).filter((e) => e.seq > after);
    const encoder = new TextEncoder();
    const streams = this.streams;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(
            encoder.encode(
              `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            ),
          );
        }
        const set = streams.get(runId) ?? new Set();
        set.add(controller);
        streams.set(runId, set);
      },
      cancel() {
        streams.get(runId)?.clear();
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }

  private routes: [string, Handler][] = [
    ['GET /loops', () => json({ items: [...this.loops.values()].map((l) => l.loop) })],
    [
      'POST /loops',
      (call) => {
        const def = (call.body as { definition: LoopDefinitionInput }).definition;
        const loop = this.addLoop(def);
        const entry = this.loops.get(loop.id)!;
        return json(
          { loop, draft: entry.draft, issues: validateLoop(LoopDefinitionSchema.parse(def)) },
          201,
        );
      },
    ],
    [
      'POST /loops/import',
      (call) => {
        const body = call.body as { loop?: LoopDefinitionInput };
        if (!body.loop)
          return problem(
            400,
            'LOOP_IMPORT_ERROR',
            'document is neither a loop export nor a loop definition',
          );
        const loop = this.addLoop(body.loop);
        return json({ loop, draft: this.loops.get(loop.id)!.draft, issues: [] }, 201);
      },
    ],
    [
      'GET /loops/:id',
      (_call, [loopId]) => {
        const entry = this.loops.get(loopId!);
        return entry ? json(entry) : problem(404, 'LOOP_NOT_FOUND', 'loop not found');
      },
    ],
    [
      'PUT /loops/:id/draft',
      (call, [loopId]) => {
        const entry = this.loops.get(loopId!);
        if (!entry) return problem(404, 'LOOP_NOT_FOUND');
        const parsed = LoopDefinitionSchema.safeParse(
          (call.body as { definition: unknown }).definition,
        );
        if (!parsed.success)
          return problem(400, 'VALIDATION_FAILED', 'the request did not match the schema');
        const draft: LoopVersionRecord = {
          id: entry.draft?.id ?? id('version'),
          loopId: loopId!,
          version: (entry.current?.version ?? 0) + 1,
          status: 'draft',
          definition: parsed.data,
          createdAt: TS,
        };
        entry.draft = draft;
        entry.loop = { ...entry.loop, draftVersionId: draft.id, name: parsed.data.name };
        return json({ draft, issues: validateLoop(parsed.data) });
      },
    ],
    [
      'POST /loops/:id/validate',
      (call) => {
        const parsed = LoopDefinitionSchema.safeParse(
          (call.body as { definition?: unknown }).definition,
        );
        if (!parsed.success)
          return problem(400, 'VALIDATION_FAILED', 'the request did not match the schema');
        const issues = [...validateLoop(parsed.data), ...this.serverOnlyIssues];
        return json({ issues, publishable: !issues.some((i) => i.severity === 'error') });
      },
    ],
    [
      'POST /loops/:id/publish',
      (_call, [loopId]) => {
        const entry = this.loops.get(loopId!);
        if (!entry?.draft) return problem(409, 'NO_DRAFT', 'the loop has no draft to publish');
        const issues = [...validateLoop(entry.draft.definition), ...this.serverOnlyIssues];
        if (issues.some((i) => i.severity === 'error')) {
          return problem(422, 'LOOP_INVALID', 'the draft has structural errors', issues);
        }
        const version: LoopVersionRecord = { ...entry.draft, status: 'published', publishedAt: TS };
        entry.current = version;
        delete entry.draft;
        const { draftVersionId: _d, ...loop } = entry.loop;
        entry.loop = { ...loop, currentVersionId: version.id };
        return json({ version });
      },
    ],
    [
      'GET /loops/:id/export',
      (call, [loopId]) => {
        const entry = this.loops.get(loopId!);
        const version = call.search.get('draft') === 'true' ? entry?.draft : entry?.current;
        if (!version) return problem(404, 'VERSION_NOT_FOUND', 'the loop has no published version');
        return json({
          format: 'graphgoblin-loop',
          formatVersion: 1,
          exportedAt: TS,
          loop: version.definition,
        });
      },
    ],
    [
      'DELETE /loops/:id',
      (_call, [loopId]) => {
        this.loops.delete(loopId!);
        return new Response(null, { status: 204 });
      },
    ],
    [
      'POST /loops/:id/runs',
      (call, [loopId]) => {
        const entry = this.loops.get(loopId!);
        if (!entry?.current) return problem(409, 'VERSION_NOT_PUBLISHED', 'publish first');
        const run = this.addRun({ loopId: loopId!, versionId: entry.current.id, status: 'queued' });
        void call;
        return json({ run }, 202);
      },
    ],
    [
      'GET /runs',
      (call) => {
        let items = [...this.runs.values()];
        const loopId = call.search.get('loopId');
        const status = call.search.get('status');
        const parent = call.search.get('parent');
        if (loopId) items = items.filter((r) => r.loopId === loopId);
        if (status) items = items.filter((r) => status.split(',').includes(r.status));
        if (parent === 'none') items = items.filter((r) => !r.parentRunId);
        else if (parent) items = items.filter((r) => r.parentRunId === parent);
        return json({ items });
      },
    ],
    [
      'GET /runs/:id/events',
      (call, [runId]) => {
        if (!this.runs.has(runId!)) return problem(404, 'RUN_NOT_FOUND');
        const after = Number(call.search.get('after') ?? 0);
        if (call.headers.get('accept') === 'text/event-stream') return this.stream(runId!, after);
        return json({ items: (this.events.get(runId!) ?? []).filter((e) => e.seq > after) });
      },
    ],
    [
      'GET /runs/:id/thread',
      (_call, [runId]) => {
        const thread = this.threads.get(runId!);
        return thread ? json(thread) : problem(404, 'THREAD_NOT_FOUND', 'the run has no thread');
      },
    ],
    [
      'GET /runs/:id',
      (_call, [runId]) => {
        const run = this.runs.get(runId!);
        return run ? json(run) : problem(404, 'RUN_NOT_FOUND', 'run not found');
      },
    ],
    ...(['cancel', 'pause', 'resume'] as const).map((action): [string, Handler] => [
      `POST /runs/:id/${action}`,
      (_call, [runId]) => {
        const run = this.runs.get(runId!);
        if (!run) return problem(404, 'RUN_NOT_FOUND');
        const status =
          action === 'cancel' ? 'cancelled' : action === 'pause' ? 'paused' : 'running';
        const next = { ...run, status } as RunRecord;
        this.runs.set(run.id, next);
        return json(next);
      },
    ]),
    [
      'POST /runs/:id/input',
      (_call, [runId]) => {
        const run = this.runs.get(runId!)!;
        const { waiting: _w, ...rest } = run;
        this.runs.set(run.id, { ...rest, status: 'running' });
        return json({ run: this.runs.get(run.id) });
      },
    ],
    ['POST /runs/:id/signals/:name', () => json({ woke: true })],
    ['GET /settings', () => json(this.settingsValues)],
    [
      'PUT /settings',
      (call) => {
        Object.assign(this.settingsValues, call.body);
        return json(this.settingsValues);
      },
    ],
    [
      'DELETE /settings/:key',
      (_call, [key]) => {
        if (!(key! in this.settingsValues))
          return problem(404, 'SETTING_NOT_FOUND', `setting ${key} not found`);
        delete this.settingsValues[key!];
        return new Response(null, { status: 204 });
      },
    ],
    ['GET /model-catalog', () => json({ items: this.catalog })],
    [
      'PUT /model-catalog/:harness/:model',
      (call, [harness, model]) => {
        const entry = {
          harness: harness!,
          model: model!,
          ...(call.body as object),
        } as FakeApi['catalog'][number];
        this.catalog = [...this.catalog.filter((m) => m.model !== model), entry];
        return json(entry);
      },
    ],
    [
      'DELETE /model-catalog/:harness/:model',
      (_call, [, model]) => {
        this.catalog = this.catalog.filter((m) => m.model !== model);
        return new Response(null, { status: 204 });
      },
    ],
    ['GET /secrets', () => json({ items: this.secretList })],
    [
      'PUT /secrets/:name',
      (_call, [name]) => {
        const entry = { name: name!, createdAt: TS, updatedAt: TS };
        this.secretList = [...this.secretList.filter((s) => s.name !== name), entry];
        return json(entry);
      },
    ],
    [
      'DELETE /secrets/:name',
      (_call, [name]) => {
        this.secretList = this.secretList.filter((s) => s.name !== name);
        return new Response(null, { status: 204 });
      },
    ],
    ['GET /api-keys', () => json({ items: this.apiKeyList })],
    [
      'POST /api-keys',
      (call) => {
        const key = {
          id: id('key'),
          ownerId: 'local',
          label: (call.body as { label: string }).label,
          scopes: ['*'],
          createdAt: TS,
        };
        this.apiKeyList.push(key);
        return json({ key, token: 'gg_secret_token_123' }, 201);
      },
    ],
    [
      'DELETE /api-keys/:id',
      (_call, [keyId]) => {
        this.apiKeyList = this.apiKeyList.map((k) =>
          k.id === keyId ? { ...k, revokedAt: TS } : k,
        );
        return new Response(null, { status: 204 });
      },
    ],
    ['GET /harness/preflight', () => json({ items: this.preflight })],
    ['GET /events', () => json({ items: this.inbound })],
  ];
}

function match(route: string, call: RecordedCall): string[] | undefined {
  const [method, pattern] = route.split(' ') as [string, string];
  if (method !== call.method) return undefined;
  const want = pattern.split('/');
  const got = call.path.split('/');
  if (want.length !== got.length) return undefined;
  const params: string[] = [];
  for (let i = 0; i < want.length; i += 1) {
    if (want[i]!.startsWith(':')) params.push(decodeURIComponent(got[i]!));
    else if (want[i] !== got[i]) return undefined;
  }
  return params;
}

/** Build a run event with defaults for the base fields. */
export function event<T extends RunEvent['type']>(
  runId: string,
  seq: number,
  type: T,
  fields: Omit<Extract<RunEvent, { type: T }>, 'runId' | 'seq' | 'ts' | 'type'>,
): RunEvent {
  return { runId, seq, ts: TS, type, ...fields } as RunEvent;
}
