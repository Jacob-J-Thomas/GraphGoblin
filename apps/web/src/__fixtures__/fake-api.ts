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
  TemplateInstance,
  TemplateInstantiateRequest,
  TemplatePrerequisiteReport,
} from '@graphgoblin/contracts';
import {
  ClassifierModelPutSchema,
  ImplementationTemplateSettingsSchema,
  LoopDefinitionSchema,
  ReviewTemplateSettingsSchema,
  QaTemplateSettingsSchema,
  StarterTemplateSettingsSchema,
  TemplateCatalogEntrySchema,
} from '@graphgoblin/contracts';
import { fakeUlid, minimalLoop, sampleThread } from '@graphgoblin/contracts/testing';
import { z } from 'zod';
import {
  exportLoop,
  importLoop,
  LoopFormatUpgradeRequiredError,
  LoopImportError,
  stableHash,
  validateLoop,
  type ValidationIssue,
} from '@graphgoblin/domain';

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

/** A current-contract, non-GitHub starter entry for gallery tests. */
export function starterTemplateEntry(): TemplateCatalogEntry {
  const prerequisites: TemplatePrerequisiteReport = {
    checks: [
      {
        id: 'assistant-model',
        label: 'Assistant model',
        status: 'ok',
        blocking: 'authoring',
        message: 'An enabled assistant model is available.',
      },
    ],
    canInstantiate: true,
    canRun: true,
  };
  return TemplateCatalogEntrySchema.parse({
    manifest: {
      id: 'quick-start',
      version: '1.0.0',
      kind: 'starter',
      title: 'Quick start',
      description: 'A small loop to try the editor and a first run.',
      tags: ['starter', 'beginner'],
      roles: [{ id: 'assistant', label: 'Assistant', access: 'read-only' }],
      prerequisites: [],
      requiredSecrets: [],
      parentKey: 'starter',
      loops: [
        {
          key: 'starter',
          file: 'starter.json',
          dependsOn: [],
          roleNodes: [],
          settingsNodes: [],
          subloops: [],
        },
      ],
    },
    settingsSchema: z.toJSONSchema(StarterTemplateSettingsSchema, { io: 'input' }),
    defaultSettings: StarterTemplateSettingsSchema.parse({
      kind: 'starter',
      roles: { assistant: { harness: 'codex', model: 'test-codex', effort: 'low' } },
    }),
    prerequisites,
  });
}

/** A current-contract repository template with no prefilled checkout identity or role model. */
export function implementationTemplateEntry(): TemplateCatalogEntry {
  const prerequisites: TemplatePrerequisiteReport = {
    checks: [
      {
        id: 'implementer-model',
        label: 'Implementer model',
        status: 'ok',
        blocking: 'authoring',
        message: 'An enabled implementation model is available.',
      },
      {
        id: 'repository',
        label: 'Repository',
        status: 'ok',
        blocking: 'authoring',
        message: 'The repository is available.',
      },
      {
        id: 'github',
        label: 'GitHub',
        status: 'ok',
        blocking: 'authoring',
        message: 'GitHub is available.',
      },
      {
        id: 'support-key',
        label: 'Revocable runs:read support key',
        status: 'ok',
        blocking: 'authoring',
        message: 'The support key is configured.',
      },
      {
        id: 'support',
        label: 'Verified packaged support entry',
        status: 'ok',
        blocking: 'authoring',
        message: 'The support loops are available.',
      },
    ],
    canInstantiate: true,
    canRun: true,
  };
  return TemplateCatalogEntrySchema.parse({
    manifest: {
      id: 'implementation-workflow',
      version: '1.0.0',
      kind: 'implementation',
      title: 'Implementation workflow',
      description: 'Plan and complete bounded repository work.',
      tags: ['implementation', 'repository'],
      roles: [{ id: 'implementer', label: 'Implementer', access: 'write' }],
      prerequisites: [
        { id: 'repository', label: 'Repository', kind: 'repository', blocking: 'authoring' },
        { id: 'github', label: 'GitHub', kind: 'github', blocking: 'authoring' },
        {
          id: 'support-key',
          label: 'Revocable runs:read support key',
          kind: 'secret',
          blocking: 'authoring',
          secretKey: 'supportReadKey',
        },
        {
          id: 'implementer-model',
          label: 'Implementer model',
          kind: 'role',
          blocking: 'authoring',
          role: 'implementer',
        },
        {
          id: 'support',
          label: 'Verified packaged support entry',
          kind: 'support',
          blocking: 'authoring',
        },
      ],
      requiredSecrets: [{ key: 'supportReadKey', scopes: ['runs:read'] }],
      parentKey: 'parent',
      loops: [
        {
          key: 'worker',
          file: 'worker.json',
          dependsOn: [],
          roleNodes: [],
          settingsNodes: [],
          subloops: [],
        },
        {
          key: 'parent',
          file: 'parent.json',
          dependsOn: ['worker'],
          roleNodes: [],
          settingsNodes: [],
          subloops: [],
        },
      ],
    },
    settingsSchema: z.toJSONSchema(ImplementationTemplateSettingsSchema, { io: 'input' }),
    defaultSettings: null,
    prerequisites,
  });
}

/** A current-contract review template with explicit review and fixer roles. */
export function reviewTemplateEntry(): TemplateCatalogEntry {
  const prerequisites: TemplatePrerequisiteReport = {
    checks: [
      {
        id: 'reviewer-model',
        label: 'Read-only reviewer model and harness',
        status: 'ok',
        blocking: 'authoring',
        message: 'A current reviewer model is available.',
      },
      {
        id: 'fixer-model',
        label: 'Independent fixer model and harness',
        status: 'ok',
        blocking: 'authoring',
        message: 'A current fixer model is available.',
      },
      {
        id: 'repository',
        label: 'Repository',
        status: 'ok',
        blocking: 'authoring',
        message: 'The repository is available.',
      },
      {
        id: 'github',
        label: 'GitHub',
        status: 'ok',
        blocking: 'authoring',
        message: 'GitHub is available.',
      },
      {
        id: 'support-key',
        label: 'Revocable runs:read support key',
        status: 'ok',
        blocking: 'authoring',
        message: 'The support key is configured.',
      },
      {
        id: 'support',
        label: 'Verified packaged support entry',
        status: 'ok',
        blocking: 'authoring',
        message: 'The review support entry is available.',
      },
    ],
    canInstantiate: true,
    canRun: true,
  };
  return TemplateCatalogEntrySchema.parse({
    manifest: {
      id: 'review',
      version: '1.0.0',
      kind: 'review',
      title: 'GitHub PR review',
      description:
        'Review trusted pull request heads with separate fresh reviewer and fixer sessions.',
      tags: ['github', 'review', 'human'],
      roles: [
        { id: 'reviewer', label: 'Reviewer', access: 'read-only' },
        { id: 'fixer', label: 'Fixer', access: 'write' },
      ],
      prerequisites: [
        {
          id: 'reviewer-model',
          label: 'Reviewer model',
          kind: 'role',
          blocking: 'authoring',
          role: 'reviewer',
        },
        {
          id: 'fixer-model',
          label: 'Fixer model',
          kind: 'role',
          blocking: 'authoring',
          role: 'fixer',
        },
        { id: 'repository', label: 'Repository', kind: 'repository', blocking: 'authoring' },
        { id: 'github', label: 'GitHub', kind: 'github', blocking: 'authoring' },
        {
          id: 'support-key',
          label: 'Revocable runs:read support key',
          kind: 'secret',
          blocking: 'authoring',
          secretKey: 'supportReadKey',
        },
        {
          id: 'support',
          label: 'Verified packaged support entry',
          kind: 'support',
          blocking: 'authoring',
        },
      ],
      requiredSecrets: [{ key: 'supportReadKey', scopes: ['runs:read'] }],
      parentKey: 'parent',
      loops: [
        {
          key: 'parent',
          file: 'parent.json',
          dependsOn: [],
          roleNodes: [],
          settingsNodes: ['settings'],
          subloops: [],
        },
      ],
      supportEntry: 'dist/templates/github/review-entry.js',
    },
    settingsSchema: z.toJSONSchema(ReviewTemplateSettingsSchema, { io: 'input' }),
    defaultSettings: null,
    prerequisites,
  });
}

/** A current-contract QA template: authoring is allowed, but run-time isolation is unavailable. */
export function qaTemplateEntry(): TemplateCatalogEntry {
  const prerequisites: TemplatePrerequisiteReport = {
    checks: [
      {
        id: 'qa-model',
        label: 'QA model and harness',
        status: 'ok',
        blocking: 'authoring',
        message: 'A current QA model is available.',
      },
      {
        id: 'adversary-model',
        label: 'Evidence-only adversary model and harness',
        status: 'ok',
        blocking: 'authoring',
        message: 'A current adversary model is available.',
      },
      {
        id: 'repository',
        label: 'Repository',
        status: 'ok',
        blocking: 'authoring',
        message: 'The repository is available.',
      },
      {
        id: 'github',
        label: 'Authenticated configured repository',
        status: 'ok',
        blocking: 'authoring',
        message: 'The configured repository is available.',
      },
      {
        id: 'support-key',
        label: 'Revocable runs:read support key',
        status: 'ok',
        blocking: 'authoring',
        message: 'The support key is configured.',
      },
      {
        id: 'support',
        label: 'Verified packaged QA support entry',
        status: 'ok',
        blocking: 'authoring',
        message: 'The QA support entry is available.',
      },
      {
        id: 'isolation',
        label: 'Enforced evidence-only isolation',
        status: 'unavailable',
        blocking: 'runtime',
        message: 'Enforced evidence-only isolation is unavailable; QA work remains blocked.',
        remediation: 'Wait for an enforced isolation runtime before starting QA work.',
      },
    ],
    canInstantiate: true,
    canRun: false,
  };
  return TemplateCatalogEntrySchema.parse({
    manifest: {
      id: 'qa',
      version: '1.0.0',
      kind: 'qa',
      title: 'Post-merge QA',
      description: 'Draftable QA recipe with saved proof and bounded rework.',
      tags: ['github', 'qa', 'proof'],
      roles: [
        { id: 'qa', label: 'QA', access: 'write' },
        { id: 'adversary', label: 'Evidence-only adversary', access: 'read-only' },
      ],
      prerequisites: [
        { id: 'qa-model', label: 'QA model', kind: 'role', blocking: 'authoring', role: 'qa' },
        {
          id: 'adversary-model',
          label: 'Evidence-only adversary model',
          kind: 'role',
          blocking: 'authoring',
          role: 'adversary',
        },
        { id: 'repository', label: 'Repository', kind: 'repository', blocking: 'authoring' },
        { id: 'github', label: 'GitHub', kind: 'github', blocking: 'authoring' },
        {
          id: 'support-key',
          label: 'Revocable runs:read support key',
          kind: 'secret',
          blocking: 'authoring',
          secretKey: 'supportReadKey',
        },
        { id: 'support', label: 'QA support entry', kind: 'support', blocking: 'authoring' },
        {
          id: 'isolation',
          label: 'Enforced evidence-only isolation is unavailable',
          kind: 'isolation',
          blocking: 'runtime',
          role: 'adversary',
        },
      ],
      requiredSecrets: [{ key: 'supportReadKey', scopes: ['runs:read'] }],
      parentKey: 'parent',
      loops: [
        {
          key: 'qa-worker',
          file: 'qa-worker.json',
          dependsOn: ['adversary'],
          roleNodes: [{ role: 'qa', nodeId: 'qa' }],
          settingsNodes: [],
          subloops: [{ nodeId: 'adversary-call', loopKey: 'adversary' }],
        },
        {
          key: 'adversary',
          file: 'adversary.json',
          dependsOn: [],
          roleNodes: [{ role: 'adversary', nodeId: 'adversary' }],
          settingsNodes: [],
          subloops: [],
        },
        {
          key: 'parent',
          file: 'parent.json',
          dependsOn: ['qa-worker'],
          roleNodes: [],
          settingsNodes: ['settings'],
          subloops: [{ nodeId: 'qa-call', loopKey: 'qa-worker' }],
        },
      ],
      supportEntry: 'dist/templates/github/qa-entry.js',
    },
    settingsSchema: z.toJSONSchema(QaTemplateSettingsSchema, { io: 'input' }),
    defaultSettings: null,
    prerequisites,
  });
}

export class FakeApi {
  templates: TemplateCatalogEntry[] = [];
  templateInstances = new Map<string, TemplateInstance>();
  /** Static per-template report for focused settings checks; tests may override the route. */
  templatePrerequisiteReports = new Map<string, TemplatePrerequisiteReport>();
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
    delivery?: {
      state: 'filtered' | 'deduplicated' | 'pending' | 'admitted' | 'failed';
      attempts: number;
      nextAttemptAt?: string;
      failureCode?: string;
    };
  }[] = [];
  preflight: ({ harness: string } & HarnessPreflight)[] = [
    { harness: 'codex', ok: true, version: '1.0', authenticated: true, problems: [] },
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
      if (node.kind !== 'decision' || node.config.evaluation.kind !== 'classifier') return [];
      const id = node.config.evaluation.model;
      const entry = this.classifiers.find((c) => c.id === id);
      const issue = (code: string, severity: 'error' | 'warning', message: string): LoopIssue => ({
        code,
        severity,
        nodeId: node.id,
        path: 'config.evaluation.model',
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
    ['GET /templates', () => json({ items: this.templates })],
    [
      'GET /templates/:id',
      (_call, [templateId]) => {
        const entry = this.templates.find((item) => item.manifest.id === templateId);
        return entry ? json(entry) : problem(404, 'TEMPLATE_NOT_FOUND', 'template not found');
      },
    ],
    [
      'POST /templates/:id/prerequisites',
      (_call, [templateId]) => {
        const entry = this.templates.find((item) => item.manifest.id === templateId);
        if (!entry) return problem(404, 'TEMPLATE_NOT_FOUND', 'template not found');
        return json(this.templatePrerequisiteReports.get(templateId!) ?? entry.prerequisites);
      },
    ],
    [
      'POST /templates/:id/instantiate',
      (call, [templateId]) => {
        const entry = this.templates.find((item) => item.manifest.id === templateId);
        if (!entry) return problem(404, 'TEMPLATE_NOT_FOUND', 'template not found');
        const report = this.templatePrerequisiteReports.get(templateId!) ?? entry.prerequisites;
        if (!report.canInstantiate)
          return problem(
            409,
            'TEMPLATE_PREREQUISITES_FAILED',
            'creation requirements are not ready',
          );
        const request = call.body as TemplateInstantiateRequest;
        const loop = this.addLoop({
          ...minimalLoop(),
          name: request.name ?? entry.manifest.title,
        });
        const draft = this.loops.get(loop.id)!.draft!;
        const instance: TemplateInstance = {
          id: id('template-instance'),
          ownerId: 'local',
          templateId: templateId!,
          templateVersion: entry.manifest.version,
          createdAt: TS,
          parentLoopId: loop.id,
          loops: [
            {
              key: entry.manifest.parentKey,
              loopId: loop.id,
              versionId: draft.id,
              version: draft.version,
              status: 'draft',
            },
          ],
          settings: request.settings,
        };
        this.templateInstances.set(instance.id, instance);
        return json({ instance, prerequisites: report }, 201);
      },
    ],
    [
      'GET /template-instances/:id',
      (_call, [instanceId]) => {
        const instance = this.templateInstances.get(instanceId!);
        return instance ? json(instance) : problem(404, 'TEMPLATE_INSTANCE_NOT_FOUND');
      },
    ],
    ['GET /loops', () => json({ items: [...this.loops.values()].map((l) => l.loop) })],
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
      (call) => {
        try {
          const imported = importLoop(call.body);
          const loop = this.addLoop(imported.definition);
          return json(
            { loop, draft: this.loops.get(loop.id)!.draft, issues: imported.issues },
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
        const template = [...this.templateInstances.values()].find(
          (instance) =>
            instance.ownerId === entry?.loop.ownerId &&
            instance.loops.some((loop) => loop.loopId === loopId),
        );
        return entry
          ? json({
              ...entry,
              ...(draftToken ? { draftToken } : {}),
              ...(template ? { templateInstanceId: template.id } : {}),
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
        const run = this.addRun({ loopId: loopId!, versionId: version.id, status: 'queued' });
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
