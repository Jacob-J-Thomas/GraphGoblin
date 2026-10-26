/**
 * An in-memory stand-in for the GraphGoblin API, used as the `fetch` of the real api-client in
 * component tests. It implements the routes the web app calls, records every request, and can
 * stream run events over SSE with events pushed while the stream is open.
 */
import type {
  ApiKeyListItem,
  ClassifierModelEntry,
  ClassifierModelSummary,
  ContextThread,
  HarnessPreflight,
  LoopDefinition,
  LoopDefinitionInput,
  LoopIssue,
  LoopRecord,
  LoopVersionRecord,
  RunEvent,
  RunRecord,
  TemplateCatalogEntry,
  TemplateDraftRequest,
} from '@graphgoblin/contracts';
import {
  ClassifierModelPutSchema,
  LoopDefinitionSchema,
  TemplateCatalogEntrySchema,
} from '@graphgoblin/contracts';
import { fakeUlid, minimalLoop, samplePin, sampleThread } from '@graphgoblin/contracts/testing';
import {
  reconcileThread,
  exportLoop,
  importLoop,
  LoopFormatUpgradeRequiredError,
  LoopImportError,
  stableHash,
  validateLoop,
  upgradeExportCurrent,
  upgradeLoopCurrent,
  type ValidationIssue,
} from '@graphgoblin/domain';

export const TS = '2026-10-02T12:00:00.000Z';

export interface RecordedCall {
  method: string;
  path: string;
  search: URLSearchParams;
  body: unknown;
  headers: Headers;
  signal?: AbortSignal;
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
    pinned: samplePin(),
    invocationId: id('invocation'),
    status: 'running',
    iteration: 1,
    createdAt: TS,
    startedAt: TS,
    lastEventSeq: 0,
    ...overrides,
  };
}

/** The built-in classifier as the API seeds it. */
export const BUILTIN_JEV: ClassifierModelEntry = {
  id: 'jev',
  displayName: 'Jev',
  source: 'builtin',
  provider: 'typesafe',
  providerModel: 'jev-latest',
  primitives: ['choice', 'noul', 'score'],
  endpoint: 'https://api.typesafe.ai',
  secretRef: 'jev-api-key',
  enabled: true,
};

/** A custom HTTP classifier entry, for tests. */
export function customClassifier(
  overrides: Partial<ClassifierModelEntry> & { id: string },
): ClassifierModelEntry {
  return {
    displayName: overrides.id,
    source: 'custom',
    provider: 'http',
    providerModel: `${overrides.id}-latest`,
    primitives: ['choice'],
    endpoint: 'http://127.0.0.1:8008',
    enabled: true,
    ...overrides,
  };
}

/** An independent starting point using the current manifest contract. */
export function starterTemplateEntry(): TemplateCatalogEntry {
  return TemplateCatalogEntrySchema.parse({
    manifest: {
      id: 'quick-start',
      version: '2.0.0',
      title: 'Quick start',
      description: 'A small loop to try the editor and a first run.',
      tags: ['starter', 'beginner'],
      draftFile: 'draft.json',
    },
  });
}

/** An independent starting point using the current manifest contract. */
export function implementationTemplateEntry(): TemplateCatalogEntry {
  return TemplateCatalogEntrySchema.parse({
    manifest: {
      id: 'implementation-workflow',
      version: '2.0.0',
      title: 'Implementation workflow',
      description:
        'Plan a supplied task, implement a focused change and assess verification with a bounded repair loop of ordinary nodes. No commits, pushes, pull requests or labels.',
      tags: ['implementation', 'repository'],
      draftFile: 'draft.json',
    },
  });
}

/** An independent starting point using the current manifest contract. */
export function reviewTemplateEntry(): TemplateCatalogEntry {
  return TemplateCatalogEntrySchema.parse({
    manifest: {
      id: 'review',
      version: '2.0.0',
      title: 'Review workflow',
      description:
        'Review a supplied change with separate fresh reviewer and fixer turns, then review again within a bounded cycle of ordinary nodes. No pushes, GitHub approvals, labels or merges.',
      tags: ['review', 'fixes'],
      draftFile: 'draft.json',
    },
  });
}

/** An independent starting point using the current manifest contract. */
export function qaTemplateEntry(): TemplateCatalogEntry {
  return TemplateCatalogEntrySchema.parse({
    manifest: {
      id: 'qa',
      version: '2.0.0',
      title: 'QA assessment',
      description:
        'Define criteria, assess supplied evidence and challenge the assessment with separate fresh turns in ordinary nodes. No GitHub effects, authenticated proof or enforced evidence isolation.',
      tags: ['qa', 'evidence', 'adversarial'],
      draftFile: 'draft.json',
    },
  });
}

export class FakeApi {
  templates: TemplateCatalogEntry[] = [];
  loops = new Map<
    string,
    {
      loop: LoopRecord;
      draft?: LoopVersionRecord;
      current?: LoopVersionRecord;
      /** Every published version, oldest first. */
      history: LoopVersionRecord[];
    }
  >();
  runs = new Map<string, RunRecord>();
  threads = new Map<string, ContextThread>();
  events = new Map<string, RunEvent[]>();
  catalog: {
    harness: string;
    model: string;
    source: 'harness' | 'litellm';
    displayName: string;
    efforts: string[];
    defaultEffort: string;
    enabled: boolean;
  }[] = [];
  secretList: { name: string; createdAt: string; updatedAt: string }[] = [];
  /** Classifier entries; GET derives `configured` from `secretList`, as the API does from secrets. */
  classifiers: ClassifierModelEntry[] = [BUILTIN_JEV];
  apiKeyList: ApiKeyListItem[] = [];
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
    target?: { loopId: string; versionId: string; triggerNodeId: string };
    admissionId?: string;
    delivery?: {
      state: 'filtered' | 'deduplicated' | 'pending' | 'admitted' | 'failed';
      attempts: number;
      nextAttemptAt?: string;
      failureCode?: string;
    };
  }[] = [];
  preflight: ({ harness: string } & HarnessPreflight)[] = [
    {
      harness: 'codex',
      state: 'ready',
      ok: true,
      version: '1.0',
      authenticated: true,
      problems: [],
    },
  ];
  calls: RecordedCall[] = [];
  /** When true every request fails like a dropped network. */
  offline = false;
  /** When set, every request without `Bearer <requiredKey>` is a 401, as with GG_REQUIRE_API_KEY. */
  requiredKey: string | undefined;
  /** Issues only the real API finds (cron syntax, subloop references), for validate and publish. */
  serverOnlyIssues: ValidationIssue[] = [];
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
    this.loops.set(loopId, {
      loop,
      ...(draft ? { draft } : {}),
      ...(current ? { current } : {}),
      history: current ? [current] : [],
    });
    return loop;
  }

  /** Publish `definition` as the loop's next version, as the editor's Publish would. */
  publishVersion(loopId: string, definition: LoopDefinitionInput): LoopVersionRecord {
    const entry = this.loops.get(loopId)!;
    const version: LoopVersionRecord = {
      id: id('version'),
      loopId,
      version: (entry.current?.version ?? 0) + 1,
      status: 'published',
      definition: LoopDefinitionSchema.parse(definition),
      createdAt: TS,
      publishedAt: TS,
    };
    entry.current = version;
    entry.history.push(version);
    entry.loop = { ...entry.loop, currentVersionId: version.id };
    return version;
  }

  /** The draft token the real API derives: a hash of the draft, or else the published definition. */
  draftToken(loopId: string): string | undefined {
    const entry = this.loops.get(loopId);
    const base = entry?.draft ?? entry?.current;
    return base ? stableHash(base.definition) : undefined;
  }

  /** Save a draft as another tab or device would, without If-Match. */
  saveDraftElsewhere(loopId: string, definition: LoopDefinitionInput): void {
    const entry = this.loops.get(loopId)!;
    const parsed = LoopDefinitionSchema.parse(definition);
    entry.draft = {
      id: entry.draft?.id ?? id('version'),
      loopId,
      version: (entry.current?.version ?? 0) + 1,
      status: 'draft',
      definition: parsed,
      createdAt: TS,
    };
    entry.loop = { ...entry.loop, draftVersionId: entry.draft.id, name: parsed.name };
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
    // Model the server's tail confirmation after a synchronous batch, including any audits
    // or resume that follow an outcome. A terminal event alone is no longer completion.
    queueMicrotask(() => this.completeStream(runId));
  }

  private completeStream(runId: string, after?: number): void {
    const log = this.events.get(runId) ?? [];
    const marker = log
      .slice()
      .reverse()
      .find((event) =>
        ['run.finished', 'run.failed', 'run.cancelled', 'run.started', 'run.resumed'].includes(
          event.type,
        ),
      );
    if (!marker || marker.type === 'run.started' || marker.type === 'run.resumed') return;
    const cursor = Math.max(after ?? 0, log.at(-1)?.seq ?? 0);
    const frame = new TextEncoder().encode(
      `event: stream.complete\ndata: ${JSON.stringify({ after: cursor })}\n\n`,
    );
    for (const controller of this.streams.get(runId) ?? []) {
      controller.enqueue(frame);
      controller.close();
    }
    this.streams.delete(runId);
  }

  /** Close every open stream for a run, as a dropped connection would. */
  dropStreams(runId: string): void {
    for (const controller of this.streams.get(runId) ?? []) controller.close();
    this.streams.delete(runId);
  }

  /**
   * The API's classifier checks, in part: a decision explicitly using a classifier whose model
   * is missing from the catalog or disabled. Secret checks are left out here.
   */
  classifierIssues(definition: LoopDefinition): LoopIssue[] {
    return definition.nodes.flatMap((node): LoopIssue[] => {
      if (node.kind !== 'decision' || node.config.kind !== 'classifier') return [];
      const id = node.config.model;
      const entry = this.classifiers.find((c) => c.id === id);
      const issue = (code: string, severity: 'error' | 'warning', message: string): LoopIssue => ({
        code,
        severity,
        nodeId: node.id,
        path: 'config.model',
        message: `Decision '${node.label}' (${node.id}), classifier '${entry?.displayName ?? id}' (${id}): ${message}`,
      });
      if (!entry) return [issue('CLASSIFIER_MODEL_NOT_FOUND', 'error', 'model not found.')];
      if (!entry.enabled)
        return [issue('CLASSIFIER_MODEL_DISABLED', 'warning', 'model is disabled.')];
      return [];
    });
  }

  /** An entry as GET reports it: configured unless its secret is not in `secretList`. */
  classifierSummary(entry: ClassifierModelEntry): ClassifierModelSummary {
    const missing =
      entry.secretRef !== undefined && !this.secretList.some((s) => s.name === entry.secretRef);
    return missing
      ? {
          ...entry,
          configured: false,
          configurationReason: `Missing or blank secret '${entry.secretRef}'. Set it in Settings, Secrets.`,
        }
      : { ...entry, configured: true };
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
      signal: request.signal,
    };
    this.calls.push(call);
    if (this.requiredKey && request.headers.get('authorization') !== `Bearer ${this.requiredKey}`)
      return problem(401, 'UNAUTHORIZED', 'an API key is required');
    for (const [route, handler] of this.overrides) {
      const params = match(route, call);
      if (params) return handler(call, params);
    }
    return this.builtIn(call);
  };

  /** Answer `call` with the built-in routes, ignoring overrides (for overrides that delegate). */
  builtIn(call: RecordedCall): Response | Promise<Response> {
    if (call.method === 'GET' && call.path === '/system/storage')
      return json({
        state: 'adequate',
        checkedAt: null,
        volumes: [],
        cleaning: false,
        deletedRuns: 0,
        removedFileBytes: 0,
        reusableDatabaseBytes: 0,
        pendingResources: 0,
        preservedResources: 0,
      });
    if (call.method === 'GET' && call.path === '/system/shutdown')
      return json({
        phase: 'running',
        controlToken: 'fake-running',
        graceMs: 300000,
        activeRunIds: [],
        unconfirmedRunIds: [],
        choices: [],
      });
    for (const [route, handler] of this.routes) {
      const params = match(route, call);
      if (params) return handler(call, params);
    }
    return problem(404, 'NOT_FOUND', `${call.method} ${call.path}`);
  }

  private stream(runId: string, after: number): Response {
    const events = (this.events.get(runId) ?? []).filter((e) => e.seq > after);
    const encoder = new TextEncoder();
    const streams = this.streams;
    const complete = () => this.completeStream(runId, after);
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
        complete();
      },
      cancel() {
        streams.get(runId)?.clear();
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }

  private routes: [string, Handler][] = [
    ['GET /templates', () => json({ items: this.templates })],
    [
      'GET /templates/:id',
      (_call, [templateId]) => {
        const entry = this.templates.find((item) => item.manifest.id === templateId);
        return entry ? json(entry) : problem(404, 'TEMPLATE_NOT_FOUND', 'template not found');
      },
    ],
    [
      'POST /templates/:id/draft',
      (call, [templateId]) => {
        const entry = this.templates.find((item) => item.manifest.id === templateId);
        if (!entry) return problem(404, 'TEMPLATE_NOT_FOUND', 'template not found');
        if (!entry.manifest.draftFile)
          return problem(409, 'TEMPLATE_DRAFT_UNAVAILABLE', 'editable draft not available');
        const request = call.body as TemplateDraftRequest;
        const loop = this.addLoop({
          ...minimalLoop(),
          name: request.name ?? entry.manifest.title,
        });
        const draft = this.loops.get(loop.id)!.draft!;
        return json({ loop, draft, issues: validateLoop(draft.definition) }, 201);
      },
    ],
    ['GET /loops/:id/triggers', () => json({ schedules: [], webhooks: [], polls: [] })],
    [
      'GET /loops',
      () =>
        json({
          items: [...this.loops.values()].map(({ loop }) => {
            const history = [...this.runs.values()]
              .filter((r) => r.loopId === loop.id)
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
            const latest = history[0];
            return {
              ...loop,
              runCount: history.length,
              latestRun: latest
                ? {
                    id: latest.id,
                    status: latest.status,
                    createdAt: latest.createdAt,
                  }
                : null,
            };
          }),
        }),
    ],
    [
      'POST /loops',
      (call) => {
        const def = (call.body as { definition: LoopDefinitionInput }).definition;
        const loop = this.addLoop(def);
        const entry = this.loops.get(loop.id)!;
        return json(
          {
            loop,
            draft: entry.draft,
            issues: validateLoop(LoopDefinitionSchema.parse(def)),
          },
          201,
        );
      },
    ],
    [
      'POST /loops/import',
      async (call) => {
        try {
          let input = call.body;
          let notices: { code: string; path: string; message: string }[] = [];
          if (
            typeof input === 'object' &&
            input !== null &&
            (('formatVersion' in input && [1, 2, 3].includes(Number(input.formatVersion))) ||
              ('schemaVersion' in input && [1, 2, 3].includes(Number(input.schemaVersion))))
          ) {
            const converted =
              'formatVersion' in input
                ? await upgradeExportCurrent(input)
                : await upgradeLoopCurrent(input);
            if (!converted.ok)
              return problem(
                400,
                converted.issues.some((issue) => issue.kind === 'pending')
                  ? 'LOOP_FORMAT_UPGRADE_REQUIRED'
                  : 'LOOP_IMPORT_SOURCE_INVALID',
                'Use graphgoblin-upgrade export with --resolutions resolutions.json and the reported v3 item ids and hashes. See docs/guide/08-offline-upgrade.md#convert-a-portable-export.',
                { issues: converted.issues, reviewItems: converted.reviewItems },
              );
            input = converted.value;
            notices = converted.notices;
          }
          const imported = importLoop(input);
          const loop = this.addLoop(imported.definition);
          return json(
            { loop, draft: this.loops.get(loop.id)!.draft, issues: imported.issues, notices },
            201,
          );
        } catch (error) {
          if (error instanceof LoopFormatUpgradeRequiredError)
            return problem(400, error.code, error.message);
          if (!(error instanceof LoopImportError)) throw error;
          return problem(400, error.code, error.message, error.details);
        }
      },
    ],
    [
      'GET /loops/:id',
      (_call, [loopId]) => {
        const entry = this.loops.get(loopId!);
        const draftToken = this.draftToken(loopId!);
        return entry
          ? json({
              ...entry,
              ...(draftToken ? { draftToken } : {}),
            })
          : problem(404, 'LOOP_NOT_FOUND', 'loop not found');
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
        const ifMatch = call.headers.get('if-match');
        const serverToken = this.draftToken(loopId!);
        if (ifMatch !== null && ifMatch.replace(/^"(.*)"$/, '$1') !== serverToken) {
          return new Response(
            JSON.stringify({
              status: 409,
              code: 'DRAFT_CONFLICT',
              detail: 'the draft changed on the server',
              draftToken: serverToken,
            }),
            { status: 409, headers: { 'content-type': 'application/problem+json' } },
          );
        }
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
        return json({
          draft,
          draftToken: stableHash(parsed.data),
          issues: validateLoop(parsed.data),
        });
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
        const issues = [
          ...validateLoop(parsed.data),
          ...this.serverOnlyIssues,
          ...this.classifierIssues(parsed.data),
        ];
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
        entry.history.push(version);
        delete entry.draft;
        const { draftVersionId: _d, ...loop } = entry.loop;
        entry.loop = { ...loop, currentVersionId: version.id };
        return json({ version });
      },
    ],
    [
      'GET /loops/:id/versions',
      (_call, [loopId]) => {
        const entry = this.loops.get(loopId!);
        if (!entry) return problem(404, 'LOOP_NOT_FOUND', 'loop not found');
        return json({ items: [...entry.history, ...(entry.draft ? [entry.draft] : [])] });
      },
    ],
    [
      'GET /loops/:id/versions/:versionId',
      (_call, [loopId, versionId]) => {
        const entry = this.loops.get(loopId!);
        if (!entry) return problem(404, 'LOOP_NOT_FOUND', 'loop not found');
        const version = [...entry.history, ...(entry.draft ? [entry.draft] : [])].find(
          (candidate) => candidate.id === versionId,
        );
        return version
          ? json(version)
          : problem(404, 'VERSION_NOT_FOUND', `version ${versionId} not found`);
      },
    ],
    [
      'GET /loops/:id/export',
      (call, [loopId]) => {
        const entry = this.loops.get(loopId!);
        const version = call.search.get('draft') === 'true' ? entry?.draft : entry?.current;
        if (!version) return problem(404, 'VERSION_NOT_FOUND', 'the loop has no published version');
        return json(exportLoop(version.definition, TS));
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
        if (!entry?.current)
          return problem(404, 'LOOP_NOT_FOUND', 'the loop has no published version');
        const asked = (call.body as { versionId?: string } | undefined)?.versionId;
        const version = asked ? entry.history.find((v) => v.id === asked) : entry.current;
        if (!version) return problem(404, 'VERSION_NOT_FOUND', `version ${asked} not found`);
        const run = this.addRun({
          loopId: loopId!,
          versionId: version.id,
          pinned: samplePin({
            version: version.version,
            name: version.definition.name,
            label: `${version.definition.name} v${version.version}`,
          }),
          status: 'queued',
        });
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
        const before = call.search.get('before');
        if (before) items = items.filter((r) => r.createdAt < before);
        items.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
        const cursor = call.search.get('cursor');
        if (cursor) items = items.slice(items.findIndex((item) => item.id === cursor) + 1);
        const limit = Number(call.search.get('limit') ?? 100);
        return json({
          items: items.slice(0, limit),
          nextCursor: items.length > limit ? items[limit - 1]!.id : null,
        });
      },
    ],
    [
      'GET /runs/:id/events',
      (call, [runId]) => {
        if (!this.runs.has(runId!)) return problem(404, 'RUN_NOT_FOUND');
        const after = Number(call.search.get('after') ?? 0);
        if (call.headers.get('accept') === 'text/event-stream') return this.stream(runId!, after);
        const all = this.events.get(runId!) ?? [];
        const cursor = call.search.get('cursor');
        const position: { seq: number; direction: string } | undefined = cursor
          ? (JSON.parse(atob(cursor)) as { seq: number; direction: string })
          : undefined;
        const around = call.search.get('around');
        const older = position?.direction === 'older' || around !== null;
        const bound = position?.seq ?? (around !== null ? Number(around) + 1 : after);
        const limit = Number(call.search.get('limit') ?? 500);
        const matches = all.filter((e) => (older ? e.seq < bound : e.seq > bound));
        const items = older ? matches.slice(-limit) : matches.slice(0, limit);
        const first = items[0]?.seq ?? bound;
        const last = items.at(-1)?.seq ?? bound;
        return json({
          items,
          nextAfter: last,
          hasMore: all.some((e) => e.seq > last),
          olderCursor: all.some((e) => e.seq < first)
            ? btoa(JSON.stringify({ seq: first, direction: 'older' }))
            : null,
          newerCursor: all.some((e) => e.seq > last)
            ? btoa(JSON.stringify({ seq: last, direction: 'newer' }))
            : null,
        });
      },
    ],
    [
      'GET /runs/:id/thread',
      (call, [runId]) => {
        const current = this.threads.get(runId!);
        if (!current) return problem(404, 'THREAD_NOT_FOUND', 'the run has no thread');
        const events = this.events.get(runId!) ?? [];
        if (!events.length) return json(current);
        const first = events[0];
        const run = this.runs.get(runId!);
        const loop = run ? this.loops.get(run.loopId) : undefined;
        const definition =
          loop?.history.find((v) => v.id === run?.versionId)?.definition ??
          loop?.current?.definition ??
          loop?.draft?.definition;
        const initial =
          first?.type === 'run.queued' && first.initialThread
            ? first.initialThread
            : {
                ...current,
                run: { ...current.run, iteration: 1 },
                messages: [],
                vars: {},
                artifacts: [],
                outputs: {},
                counters: {
                  nodeVisits: {},
                  usage: {
                    inputTokens: 0,
                    outputTokens: 0,
                    cachedInputTokens: 0,
                    reasoningOutputTokens: 0,
                  },
                },
                gates: Object.fromEntries(
                  (definition?.nodes ?? [])
                    .filter(
                      (node) => node.kind === 'decision' && node.config.maxPasses !== undefined,
                    )
                    .map((node) => [node.id, { passes: 1 }]),
                ),
              };
        try {
          const at = call.search.get('at');
          return json(
            reconcileThread(initial, events, undefined, at === null ? undefined : Number(at)),
          );
        } catch (error) {
          return problem(500, 'THREAD_REPLAY_FAILED', String(error));
        }
      },
    ],
    [
      'GET /runs/:id/observation',
      (_call, [runId]) => {
        if (!this.runs.has(runId!)) return problem(404, 'RUN_NOT_FOUND');
        const all = this.events.get(runId!) ?? [];
        const cancelled = all.findLast((event) => event.type === 'run.cancelled');
        const before = cancelled ? all.filter((event) => event.seq < cancelled.seq) : [];
        const requested = before.findLast((event) => event.type === 'run.cancel_requested');
        const resumed = before.findLast((event) => event.type === 'run.resumed');
        return json({
          lifecycle: all.findLast((event) =>
            ['run.finished', 'run.failed', 'run.cancelled', 'run.started', 'run.resumed'].includes(
              event.type,
            ),
          ),
          exit: all.findLast((event) => event.type === 'exit.evaluated'),
          gate: all.findLast((event) => event.type === 'decision.made' && event.gate !== undefined),
          finished: all.findLast((event) => event.type === 'run.finished'),
          cancelled,
          cancelRequested:
            requested && (!resumed || requested.seq > resumed.seq) ? requested : undefined,
          freshSessionChoices: all
            .filter((event) => event.type === 'run.resumed' && event.freshSession !== undefined)
            .slice(-20),
        });
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
      'GET /system/model-defaults',
      () => json({ byHarness: { codex: { model: 'gpt-6-luna', effort: 'low' } } }),
    ],
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
    [
      'GET /model-catalog',
      () =>
        json({
          items: this.catalog.map((entry) => ({
            ...entry,
            ecosystemDefault:
              (entry.harness === 'codex' && entry.model === 'gpt-6-luna') ||
              (entry.harness === 'claude' && entry.model === 'claude-opus-5-5'),
          })),
        }),
    ],
    [
      'PATCH /model-catalog/:harness/:model',
      (call, [harness, model]) => {
        const entry = this.catalog.find((m) => m.harness === harness && m.model === model);
        if (!entry) return problem(404, 'MODEL_NOT_FOUND', 'model not in catalog');
        const body = call.body as { enabled?: unknown };
        if (typeof body.enabled !== 'boolean' || Object.keys(body).length !== 1)
          return problem(400, 'VALIDATION_FAILED');
        entry.enabled = body.enabled;
        return json(entry);
      },
    ],
    [
      'PUT /model-catalog/:harness/:model',
      (call, [harness, model]) => {
        const existing = this.catalog.find((m) => m.harness === harness && m.model === model);
        const source = existing?.source ?? (call.body as { source?: string }).source ?? 'harness';
        if (source === 'harness')
          return problem(
            409,
            'MODEL_MANAGED_BY_HARNESS',
            existing
              ? 'Harness models can only be enabled or disabled'
              : 'Models for this harness come from the harness and cannot be added',
          );
        if (!existing)
          return problem(
            409,
            'LITELLM_NOT_CONFIGURED',
            'LiteLLM is not configured; adding local models is not available yet',
          );
        const entry = {
          harness: harness!,
          model: model!,
          ...(call.body as object),
          source,
          enabled: (call.body as { enabled?: boolean }).enabled ?? existing.enabled,
        } as FakeApi['catalog'][number];
        this.catalog = [
          ...this.catalog.filter((m) => !(m.model === model && m.harness === harness)),
          entry,
        ];
        return json(entry);
      },
    ],
    [
      'DELETE /model-catalog/:harness/:model',
      (_call, [harness, model]) => {
        const entry = this.catalog.find((m) => m.harness === harness && m.model === model);
        if (!entry) return problem(404, 'MODEL_NOT_FOUND', 'model not in catalog');
        if (entry.source === 'harness')
          return problem(
            409,
            'MODEL_MANAGED_BY_HARNESS',
            'Harness models can only be enabled or disabled',
          );
        this.catalog = this.catalog.filter((m) => !(m.model === model && m.harness === harness));
        return new Response(null, { status: 204 });
      },
    ],
    [
      'GET /classifier-models',
      () =>
        json({
          items: [...this.classifiers]
            .sort((a, b) =>
              a.source !== b.source ? (a.source === 'builtin' ? -1 : 1) : a.id.localeCompare(b.id),
            )
            .map((entry) => this.classifierSummary(entry)),
        }),
    ],
    [
      'PUT /classifier-models/:id',
      (call, [classifierId]) => {
        if (classifierId === 'jev')
          return problem(
            409,
            'CLASSIFIER_MANAGED_BY_SYSTEM',
            'Built-in Jev can only be enabled or disabled',
          );
        const parsed = ClassifierModelPutSchema.safeParse(call.body);
        if (!parsed.success)
          return problem(
            400,
            'VALIDATION_FAILED',
            'the request did not match the schema',
            parsed.error.issues.map((i) => ({ path: `/${i.path.join('/')}`, message: i.message })),
          );
        const existing = this.classifiers.find((c) => c.id === classifierId);
        if (existing && call.headers.get('if-none-match') === '*')
          return problem(409, 'CLASSIFIER_EXISTS', `Classifier '${classifierId}' already exists`);
        const entry: ClassifierModelEntry = {
          id: classifierId!,
          ...parsed.data,
          source: 'custom',
          enabled: existing?.enabled ?? false,
        };
        this.classifiers = [...this.classifiers.filter((c) => c.id !== classifierId), entry];
        return json(this.classifierSummary(entry));
      },
    ],
    [
      'PATCH /classifier-models/:id',
      (call, [classifierId]) => {
        const entry = this.classifiers.find((c) => c.id === classifierId);
        if (!entry)
          return problem(
            404,
            'CLASSIFIER_MODEL_NOT_FOUND',
            `Classifier '${classifierId}' not found`,
          );
        const body = call.body as { enabled?: unknown };
        if (typeof body.enabled !== 'boolean' || Object.keys(body).length !== 1)
          return problem(400, 'VALIDATION_FAILED');
        entry.enabled = body.enabled;
        return json(this.classifierSummary(entry));
      },
    ],
    [
      'DELETE /classifier-models/:id',
      (_call, [classifierId]) => {
        if (classifierId === 'jev')
          return problem(
            409,
            'CLASSIFIER_MANAGED_BY_SYSTEM',
            'Built-in Jev can only be enabled or disabled',
          );
        if (!this.classifiers.some((c) => c.id === classifierId))
          return problem(
            404,
            'CLASSIFIER_MODEL_NOT_FOUND',
            `Classifier '${classifierId}' not found`,
          );
        this.classifiers = this.classifiers.filter((c) => c.id !== classifierId);
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
        this.apiKeyList.push({ ...key, current: false });
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
    [
      'GET /events',
      (call) => {
        let items = [...this.inbound];
        const type = call.search.get('type');
        if (type) items = items.filter((event) => event.type === type);
        const before = call.search.get('before');
        if (before) items = items.filter((event) => event.receivedAt < before);
        const anchor = call.search.get('anchor');
        if (anchor) {
          const start = items.findIndex((item) => item.id === anchor);
          items = start < 0 ? [] : items.slice(start);
        }
        const cursor = call.search.get('cursor');
        if (cursor) items = items.slice(items.findIndex((item) => item.id === cursor) + 1);
        const limit = Number(call.search.get('limit') ?? 100);
        return json({
          items: items.slice(0, limit),
          nextCursor: items.length > limit ? items[limit - 1]!.id : null,
        });
      },
    ],
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

/** The fields every `run.queued` carries: the pinned definition record and its description. */
export function queuedFields(
  extra: { initialThread?: ContextThread } = {},
): Omit<Extract<RunEvent, { type: 'run.queued' }>, 'runId' | 'seq' | 'ts' | 'type'> {
  return { versionId: fakeUlid('version'), pinned: samplePin(), ...extra };
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
