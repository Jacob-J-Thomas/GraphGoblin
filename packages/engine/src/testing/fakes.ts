/**
 * In-memory fakes for every engine port. Deterministic ids and clock. Used by the engine's own
 * tests and by API and E2E tests through `@graphgoblin/engine/testing`.
 */
import type {
  ContextThread,
  ClassifierBinding,
  ClassifierPrimitive,
  HarnessId,
  ModelCatalogEntry,
  JsonValue,
  LoopDefinition,
  LoopVersionRecord,
  RunEvent,
  RunRecord,
  RunStatus,
  Usage,
  WorkingDirectorySpec,
  WebhookAttemptResult,
} from '@graphgoblin/contracts';
import { isTerminal, stableStringify } from '@graphgoblin/domain';
import type {
  ArtifactStorePort,
  ChoiceRequest,
  ChoiceResult,
  ClassifierNoulResult,
  LlmRouteRequest,
  LlmRouteResult,
  NoulRequest,
  ScoreRequest,
  ScoreResult,
  ClassifierPort,
  ClassifierRegistryPort,
  ClassifierResolution,
  ClockPort,
  DeciderPort,
  EnginePorts,
  EngineSettings,
  EventDraft,
  EventStorePort,
  HarnessEvent,
  HarnessItem,
  HarnessPort,
  HarnessPreflight,
  HarnessResult,
  HarnessSession,
  HarnessSessionRecord,
  HarnessSessionRepository,
  HarnessStartRequest,
  HarnessTurnRequest,
  HttpProbePort,
  IdPort,
  Logger,
  LoopRepository,
  ProbeRequest,
  ProbeResponse,
  ReturnDeliveryPort,
  RunRecordChanges,
  RunRepository,
  ScriptPort,
  ScriptRunRequest,
  ScriptRunResult,
  SecretsPort,
  StructuredPort,
  TimerPort,
  WorkspacePort,
} from '../ports.js';
import { AppendConflictError } from '../errors.js';
import { validateGeneratedEvent } from '../event-validation.js';
import {
  AdmissionConflictError,
  assertAdmissionIdentity,
  assertWebhookClaim,
  parseRunAdmission,
  pollAdmissionIdentity,
  queuedEvent,
  type RunAdmission,
  type TriggerAdmissionPort,
  type WebhookClaim,
  type WebhookReceipt,
  type WebhookFailureCode,
} from '../admission.js';

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Wrap an array as an async iterable without an async generator. */
export function asyncIterableOf<T>(items: readonly T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        next: (): Promise<IteratorResult<T>> =>
          Promise.resolve(
            index < items.length
              ? { value: items[index++] as T, done: false }
              : { value: undefined, done: true },
          ),
      };
    },
  };
}

export class FakeClock implements ClockPort {
  private current: number;
  constructor(start = Date.parse('2026-10-02T12:00:00.000Z')) {
    this.current = start;
  }
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current += ms;
  }
  set(iso: string): void {
    this.current = Date.parse(iso);
  }
}

export class FakeIds implements IdPort {
  private counter = 0;
  next(): string {
    this.counter += 1;
    const digits = this.counter.toString(32).toUpperCase().padStart(10, '0');
    const encoded = [...digits].map((c) => ULID_ALPHABET[parseInt(c, 32)] ?? '0').join('');
    return `0000000000000000${encoded}`;
  }
}

export class CapturingLogger implements Logger {
  readonly lines: { level: string; msg: string; obj: Record<string, unknown> }[] = [];
  debug(obj: Record<string, unknown>, msg: string): void {
    this.lines.push({ level: 'debug', msg, obj });
  }
  info(obj: Record<string, unknown>, msg: string): void {
    this.lines.push({ level: 'info', msg, obj });
  }
  warn(obj: Record<string, unknown>, msg: string): void {
    this.lines.push({ level: 'warn', msg, obj });
  }
  error(obj: Record<string, unknown>, msg: string): void {
    this.lines.push({ level: 'error', msg, obj });
  }
}

export class InMemoryEventStore implements EventStorePort {
  private readonly logs = new Map<string, RunEvent[]>();
  private readonly listeners = new Map<string, Set<(event: RunEvent) => void>>();
  constructor(
    private readonly clock: ClockPort,
    private readonly runRepository?: RunRepository,
  ) {}

  async append(
    runId: string,
    drafts: readonly EventDraft[],
    options: { expectedLastSeq?: number; requireRun?: boolean } = {},
  ): Promise<RunEvent[]> {
    if (options.requireRun && !(await this.runRepository?.get(runId))) return [];
    const log = this.logs.get(runId) ?? [];
    if (options.expectedLastSeq !== undefined && options.expectedLastSeq !== log.length) {
      return Promise.reject(new AppendConflictError(runId, options.expectedLastSeq, log.length));
    }
    const stored = drafts.map((draft, index) =>
      validateGeneratedEvent({
        ...draft,
        runId,
        seq: log.length + index + 1,
        ts: this.clock.now().toISOString(),
      }),
    );
    log.push(...stored);
    this.logs.set(runId, log);
    for (const event of stored) {
      for (const listener of this.listeners.get(runId) ?? []) listener(event);
    }
    return Promise.resolve(stored);
  }

  read(runId: string, afterSeq = 0, limit?: number): Promise<RunEvent[]> {
    const events = (this.logs.get(runId) ?? []).filter((e) => e.seq > afterSeq);
    return Promise.resolve(limit === undefined ? events : events.slice(0, limit));
  }

  subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
    const set = this.listeners.get(runId) ?? new Set();
    set.add(listener);
    this.listeners.set(runId, set);
    return () => {
      set.delete(listener);
    };
  }

  /** Admission installs the complete transaction before notifying subscribers. */
  commitQueued(event: RunEvent): void {
    this.logs.set(event.runId, [event]);
  }
  notifyCommitted(event: RunEvent): void {
    for (const listener of this.listeners.get(event.runId) ?? []) {
      try {
        listener(event);
      } catch {
        /* A subscriber cannot undo a committed transaction. */
      }
    }
  }

  /** Test helper: synchronous read. */
  all(runId: string): RunEvent[] {
    return [...(this.logs.get(runId) ?? [])];
  }
}

export class InMemoryRunRepository implements RunRepository {
  readonly runs = new Map<string, RunRecord>();
  private readonly initial = new Map<string, ContextThread>();
  private readonly threads = new Map<string, ContextThread>();
  private readonly checkpoints = new Map<string, number>();
  private readonly finalized = new Set<string>();

  create(run: RunRecord, initialThread: ContextThread): Promise<void> {
    this.commitCreated(run, initialThread);
    return Promise.resolve();
  }
  commitCreated(run: RunRecord, initialThread: ContextThread): void {
    this.runs.set(run.id, run);
    this.initial.set(run.id, initialThread);
    this.threads.set(run.id, initialThread);
  }
  hasTriggerKey(ownerId: string, loopId: string, nodeId: string, key: string): boolean {
    return [...this.runs.values()].some((run) => {
      const invocation = this.initial.get(run.id)?.invocation;
      return (
        run.ownerId === ownerId &&
        run.loopId === loopId &&
        invocation !== undefined &&
        invocation.trigger.nodeId === nodeId &&
        invocation.trigger.dedupeKey === key
      );
    });
  }
  get(runId: string): Promise<RunRecord | undefined> {
    return Promise.resolve(this.runs.get(runId));
  }
  update(runId: string, changes: RunRecordChanges): Promise<RunRecord> {
    const current = this.runs.get(runId);
    if (!current) return Promise.reject(new Error(`run ${runId} not found`));
    return Promise.resolve(this.apply(current, changes));
  }
  transition(
    runId: string,
    from: readonly RunStatus[],
    changes: RunRecordChanges,
    guard?: { waitId: string },
  ): Promise<RunRecord | undefined> {
    const current = this.runs.get(runId);
    if (!current) return Promise.reject(new Error(`run ${runId} not found`));
    if (!from.includes(current.status) || (guard && current.waiting?.waitId !== guard.waitId))
      return Promise.resolve(undefined);
    return Promise.resolve(this.apply(current, changes));
  }
  claimCancel(
    runId: string,
    from: readonly RunStatus[],
    at: string,
  ): Promise<RunRecord | undefined> {
    const current = this.runs.get(runId);
    if (!current) return Promise.reject(new Error(`run ${runId} not found`));
    if (current.cancelRequestedAt || !from.includes(current.status))
      return Promise.resolve(undefined);
    return Promise.resolve(this.apply(current, { cancelRequestedAt: at }));
  }
  private apply(current: RunRecord, changes: RunRecordChanges): RunRecord {
    const next: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) delete next[key];
      else next[key] = value;
    }
    const record = next as unknown as RunRecord;
    this.runs.set(current.id, record);
    return record;
  }
  listRecoveryCandidates(): Promise<{ id: string; terminal: boolean }[]> {
    return Promise.resolve(
      [...this.runs.values()]
        .filter((r) => !isTerminal(r.status) || !this.finalized.has(r.id))
        .map((r) => ({ id: r.id, terminal: isTerminal(r.status) })),
    );
  }
  listByStatus(statuses: readonly RunStatus[]): Promise<RunRecord[]> {
    return Promise.resolve([...this.runs.values()].filter((r) => statuses.includes(r.status)));
  }
  markFinalized(runId: string): Promise<void> {
    this.finalized.add(runId);
    return Promise.resolve();
  }
  clearFinalized(runId: string): Promise<void> {
    this.finalized.delete(runId);
    return Promise.resolve();
  }
  async listRunReferences(
    statuses: readonly RunStatus[],
  ): Promise<Pick<RunRecord, 'id' | 'loopId' | 'versionId'>[]> {
    return (await this.listByStatus(statuses)).map(({ id, loopId, versionId }) => ({
      id,
      loopId,
      versionId,
    }));
  }
  listChildren(parentRunId: string): Promise<RunRecord[]> {
    return Promise.resolve([...this.runs.values()].filter((r) => r.parentRunId === parentRunId));
  }
  getInitialThread(runId: string): Promise<ContextThread | undefined> {
    return Promise.resolve(this.initial.get(runId));
  }
  getThread(runId: string): Promise<ContextThread | undefined> {
    return Promise.resolve(this.threads.get(runId));
  }
  saveThread(runId: string, thread: ContextThread, seq?: number): Promise<void> {
    this.threads.set(runId, thread);
    if (seq === undefined) this.checkpoints.delete(runId);
    else this.checkpoints.set(runId, seq);
    return Promise.resolve();
  }
  getThreadCheckpoint(runId: string): Promise<{ thread: ContextThread; seq: number } | undefined> {
    const thread = this.threads.get(runId);
    const seq = this.checkpoints.get(runId);
    return Promise.resolve(thread && seq !== undefined ? { thread, seq } : undefined);
  }
  /** Test helper: drop the thread snapshot to force replay. */
  dropThreadSnapshot(runId: string): void {
    this.threads.delete(runId);
    this.checkpoints.delete(runId);
  }
}

export class InMemoryLoopRepository implements LoopRepository {
  readonly versions = new Map<string, LoopVersionRecord>();

  add(record: LoopVersionRecord): void {
    this.versions.set(record.id, record);
  }
  /** Convenience: register a published definition and return its record. */
  publish(
    id: string,
    loopId: string,
    version: number,
    definition: LoopDefinition,
    at = '2026-10-02T11:00:00.000Z',
  ): LoopVersionRecord {
    const record: LoopVersionRecord = {
      id,
      loopId,
      version,
      status: 'published',
      definition,
      createdAt: at,
      publishedAt: at,
    };
    this.add(record);
    return record;
  }
  getVersion(versionId: string): Promise<LoopVersionRecord | undefined> {
    return Promise.resolve(this.versions.get(versionId));
  }
  getLatestPublished(loopId: string): Promise<LoopVersionRecord | undefined> {
    const published = [...this.versions.values()].filter(
      (v) => v.loopId === loopId && v.status === 'published',
    );
    published.sort((a, b) => b.version - a.version);
    return Promise.resolve(published[0]);
  }
  getPublished(loopId: string, version: number): Promise<LoopVersionRecord | undefined> {
    return Promise.resolve(
      [...this.versions.values()].find(
        (v) => v.loopId === loopId && v.version === version && v.status === 'published',
      ),
    );
  }
}

export class InMemorySessionRepository implements HarnessSessionRepository {
  readonly rows: HarnessSessionRecord[] = [];
  upsert(row: HarnessSessionRecord): Promise<void> {
    const index = this.rows.findIndex(
      (r) => r.runId === row.runId && r.nodeId === row.nodeId && r.attempt === row.attempt,
    );
    if (index >= 0) this.rows[index] = row;
    else this.rows.push(row);
    return Promise.resolve();
  }
  forNode(runId: string, nodeId: string): Promise<HarnessSessionRecord | undefined> {
    const rows = this.rows
      .filter((r) => r.runId === runId && r.nodeId === nodeId)
      .sort((a, b) => b.attempt - a.attempt);
    return Promise.resolve(rows[0]);
  }
  latestWithSession(runId: string, harness: HarnessId): Promise<HarnessSessionRecord | undefined> {
    const rows = this.rows
      .filter((r) => r.runId === runId && r.harness === harness && r.sessionId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return Promise.resolve(rows[0]);
  }
  byScopeKey(scopeKey: string, harness: HarnessId): Promise<HarnessSessionRecord | undefined> {
    const rows = this.rows
      .filter((r) => r.scopeKey === scopeKey && r.harness === harness && r.sessionId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return Promise.resolve(rows[0]);
  }
}

// ---------------------------------------------------------------------------
// Fake harness: scripted sessions
// ---------------------------------------------------------------------------

export interface ScriptedTurn {
  /** Matched against the prompt; the first turn whose matcher accepts is used. Omit to match anything. */
  match?: (request: HarnessTurnRequest) => boolean;
  items?: HarnessItem[];
  finalText?: string;
  structured?: unknown;
  usage?: Partial<Usage>;
  /** Simulate a harness-level failure. */
  error?: { code: string; message: string; retriable?: boolean };
  /** Delay before completing, in fake-clock-independent real milliseconds; lets tests cancel mid-turn. */
  delayMs?: number;
}

const ZERO_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  reasoningOutputTokens: 0,
};

export class FakeHarness implements HarnessPort {
  readonly started: HarnessStartRequest[] = [];
  readonly resumed: { sessionId: string; request: HarnessStartRequest }[] = [];
  readonly cancelled: string[] = [];
  preflightResult: HarnessPreflight = {
    ok: true,
    version: 'fake',
    authenticated: true,
    problems: [],
  };
  private sessionCounter = 0;

  constructor(
    private turns: ScriptedTurn[] = [],
    readonly id: HarnessId = 'codex',
  ) {}

  /** Replace the script. Turns are consumed in order unless they carry a matcher. */
  script(turns: ScriptedTurn[]): void {
    this.turns = turns;
  }

  preflight(): Promise<HarnessPreflight> {
    return Promise.resolve(this.preflightResult);
  }

  start(request: HarnessStartRequest, signal: AbortSignal): HarnessSession {
    this.started.push(request);
    this.sessionCounter += 1;
    const sessionId =
      this.id === 'codex'
        ? `fake-session-${this.sessionCounter}`
        : `fake-${this.id}-session-${this.sessionCounter}`;
    return this.session(sessionId, 'fresh', request.turn, signal);
  }

  resume(sessionId: string, request: HarnessStartRequest, signal: AbortSignal): HarnessSession {
    this.resumed.push({ sessionId, request });
    return this.session(sessionId, 'resumed', request.turn, signal);
  }

  private pick(request: HarnessTurnRequest): ScriptedTurn {
    const index = this.turns.findIndex((t) => (t.match ? t.match(request) : true));
    if (index < 0) return { finalText: 'OK' };
    const [turn] = this.turns.splice(index, 1);
    return turn as ScriptedTurn;
  }

  private session(
    sessionId: string,
    mode: 'fresh' | 'resumed',
    request: HarnessTurnRequest,
    signal: AbortSignal,
  ): HarnessSession {
    const turn = this.pick(request);
    const usage: Usage = { ...ZERO_USAGE, ...turn.usage };
    const items = turn.items ?? [{ id: 'i1', type: 'message', summary: turn.finalText ?? 'OK' }];
    const events: HarnessEvent[] = [
      { type: 'session', sessionId, mode },
      ...items.map((item) => ({ type: 'item', item }) as const),
    ];
    if (turn.error) {
      events.push({
        type: 'error',
        code: turn.error.code,
        message: turn.error.message,
        retriable: turn.error.retriable ?? false,
      });
    } else {
      events.push({ type: 'usage', usage }, { type: 'turn-complete' });
    }
    const cancelled = { value: false };
    const resultPromise: Promise<HarnessResult> = new Promise((resolve, reject) => {
      const finish = (): void => {
        if (signal.aborted || cancelled.value) {
          reject(new DOMException('aborted', 'AbortError'));
          return;
        }
        if (turn.error) {
          reject(
            Object.assign(new Error(turn.error.message), {
              code: turn.error.code,
              retriable: turn.error.retriable ?? false,
            }),
          );
          return;
        }
        resolve({
          finalText: turn.finalText ?? 'OK',
          ...(turn.structured !== undefined ? { structured: turn.structured } : {}),
          usage,
          items,
        });
      };
      if (turn.delayMs) {
        const timer = setTimeout(finish, turn.delayMs);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            finish();
          },
          { once: true },
        );
      } else {
        finish();
      }
    });
    resultPromise.catch(() => undefined);
    const cancelledLog = this.cancelled;
    return {
      sessionId: Promise.resolve(sessionId),
      events: asyncIterableOf(events),
      result: resultPromise,
      cancel(): Promise<void> {
        cancelled.value = true;
        cancelledLog.push(sessionId);
        return Promise.resolve();
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Deciders, structured completions
// ---------------------------------------------------------------------------

export class FakeClassifier implements ClassifierPort {
  readonly choices: ChoiceRequest[] = [];
  readonly classifierNouls: NoulRequest[] = [];
  readonly scores: ScoreRequest[] = [];
  isAvailable = true;
  constructor(
    readonly id: 'jev',
    private readonly chooser: (request: ChoiceRequest) => ChoiceResult = (r) => ({
      type: 'choice',
      optionId: r.options[0]?.id ?? '',
      confidence: 1,
      probabilities:
        id === 'jev' ? Object.fromEntries(r.options.map((o, i) => [o.id, i === 0 ? 1 : 0])) : null,
    }),
  ) {}
  available(): boolean {
    return this.isAvailable;
  }
  choose(request: ChoiceRequest, _signal?: AbortSignal): Promise<ChoiceResult> {
    this.choices.push(request);
    return Promise.resolve(this.chooser(request));
  }
  classifyNoul(request: NoulRequest, _signal?: AbortSignal): Promise<ClassifierNoulResult> {
    this.classifierNouls.push(request);
    return Promise.resolve({ type: 'noul', trueProbability: 1 });
  }
  score(request: ScoreRequest, _signal?: AbortSignal): Promise<ScoreResult> {
    this.scores.push(request);
    return Promise.resolve({
      type: 'score',
      score: 0,
      confidence: 1,
      legend: Object.fromEntries(request.anchors.map((anchor, index) => [String(index), anchor])),
      probabilities: Object.fromEntries(
        request.anchors.map((_anchor, index) => [String(index), index === 0 ? 1 : 0]),
      ),
    });
  }
}

export class FakeDecider implements DeciderPort {
  readonly id = 'codex' as const;
  readonly routes: LlmRouteRequest[] = [];
  isAvailable = true;
  constructor(_id: 'codex' = 'codex') {}
  available(): boolean {
    return this.isAvailable;
  }
  route(request: LlmRouteRequest, _signal?: AbortSignal): Promise<LlmRouteResult> {
    this.routes.push(request);
    return Promise.resolve({
      route: request.routes[0]?.id ?? '',
      confidence: 1,
      reasoning: 'Selected',
    });
  }
}

export class FakeStructured implements StructuredPort {
  readonly requests: { prompt: string; schema: unknown }[] = [];
  constructor(private responder: (prompt: string, schema: unknown) => unknown = () => ({})) {}
  respondWith(responder: (prompt: string, schema: unknown) => unknown): void {
    this.responder = responder;
  }
  complete(
    request: { prompt: string; schema: unknown },
    _signal?: AbortSignal,
  ): Promise<{ value: unknown }> {
    this.requests.push({ prompt: request.prompt, schema: request.schema });
    return Promise.resolve({ value: this.responder(request.prompt, request.schema) });
  }
}

// ---------------------------------------------------------------------------
// Scripts, workspace, timers, probes, delivery, artifacts, secrets
// ---------------------------------------------------------------------------

export class FakeScripts implements ScriptPort {
  readonly calls: ScriptRunRequest[] = [];
  constructor(
    private responder: (request: ScriptRunRequest) => ScriptRunResult = () => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutOverflow: false,
      stderrOverflow: false,
      timedOut: false,
    }),
  ) {}
  respondWith(responder: (request: ScriptRunRequest) => ScriptRunResult): void {
    this.responder = responder;
  }
  run(request: ScriptRunRequest): Promise<ScriptRunResult> {
    this.calls.push(request);
    return Promise.resolve(this.responder(request));
  }
}

export class FakeWorkspace implements WorkspacePort {
  readonly files = new Map<string, string>();
  readonly resolved: { spec: WorkingDirectorySpec; runId: string }[] = [];
  resolve(
    spec: WorkingDirectorySpec,
    _view: Record<string, unknown>,
    runId: string,
  ): Promise<string> {
    this.resolved.push({ spec, runId });
    if (spec.kind === 'fixed') return Promise.resolve(spec.path);
    if (spec.kind === 'template') return Promise.resolve(spec.template);
    return Promise.resolve(`/tmp/graphgoblin/${runId}`);
  }
  writeFile(dir: string, path: string, content: string): Promise<string> {
    const abs = path.startsWith('/') || /^[A-Za-z]:/.test(path) ? path : `${dir}/${path}`;
    this.files.set(abs, content);
    return Promise.resolve(abs);
  }
}

export class FakeTimers implements TimerPort {
  readonly scheduled: { runId: string; key: string; at: Date }[] = [];
  private listeners: ((runId: string, key: string) => void | boolean | Promise<void | boolean>)[] =
    [];
  /** An upsert, like the real store: one timer per run and key. */
  schedule(runId: string, key: string, at: Date): Promise<void> {
    const existing = this.scheduled.find((t) => t.runId === runId && t.key === key);
    if (existing) existing.at = at;
    else this.scheduled.push({ runId, key, at });
    return Promise.resolve();
  }
  cancel(runId: string, key?: string): Promise<void> {
    for (let i = this.scheduled.length - 1; i >= 0; i -= 1) {
      const t = this.scheduled[i] as { runId: string; key: string };
      if (t.runId === runId && (key === undefined || t.key === key)) this.scheduled.splice(i, 1);
    }
    return Promise.resolve();
  }
  onFire(
    listener: (runId: string, key: string) => void | boolean | Promise<void | boolean>,
  ): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
  /** Test helper: fire every timer due at or before `now`, removing them, and wait for the listeners. */
  async fireDue(now: Date): Promise<number> {
    const due = this.scheduled.filter((t) => t.at.getTime() <= now.getTime());
    for (const t of due) {
      const firedAt = t.at.getTime();
      let delivered = true;
      for (const listener of this.listeners) {
        if ((await listener(t.runId, t.key)) === false) delivered = false;
      }
      const index = this.scheduled.indexOf(t);
      if (delivered && index >= 0 && t.at.getTime() === firedAt) this.scheduled.splice(index, 1);
    }
    return due.length;
  }
  /** Test helper: fire a specific timer regardless of time and wait for the listeners. */
  async fire(runId: string, key: string): Promise<void> {
    // A bare name (`timer`) fires the run's scheduled timer of that name, whatever wait identity
    // its key carries (`timer@42`); a key that matches nothing is delivered as given.
    const index = this.scheduled.findIndex(
      (t) => t.runId === runId && (t.key === key || t.key.startsWith(`${key}@`)),
    );
    const fired = index >= 0 ? (this.scheduled[index] as { key: string }).key : key;
    const timer = this.scheduled[index];
    const firedAt = timer?.at.getTime();
    let delivered = true;
    for (const listener of this.listeners) {
      if ((await listener(runId, fired)) === false) delivered = false;
    }
    const remaining = timer ? this.scheduled.indexOf(timer) : -1;
    if (delivered && remaining >= 0 && timer?.at.getTime() === firedAt)
      this.scheduled.splice(remaining, 1);
  }
}

export class FakeProbes implements HttpProbePort {
  readonly requests: ProbeRequest[] = [];
  constructor(
    private responder: (request: ProbeRequest) => ProbeResponse = () => ({
      status: 200,
      headers: {},
      body: '',
    }),
  ) {}
  respondWith(responder: (request: ProbeRequest) => ProbeResponse): void {
    this.responder = responder;
  }
  fetch(request: ProbeRequest, _signal?: AbortSignal): Promise<ProbeResponse> {
    this.requests.push(request);
    return Promise.resolve(this.responder(request));
  }
}

export class FakeDelivery implements ReturnDeliveryPort {
  readonly webhooks: { url: string; payload: JsonValue; secret?: string; deliveryId: string }[] =
    [];
  readonly events: { eventType: string; payload: JsonValue }[] = [];
  readonly logged: { runId: string; payload: JsonValue }[] = [];
  failWebhooks = false;
  responder?: (
    deliveryId: string,
    attempt: number,
  ) => WebhookAttemptResult | Promise<WebhookAttemptResult>;
  webhook(
    url: string,
    payload: JsonValue,
    secret: string | undefined,
    deliveryId: string,
  ): Promise<WebhookAttemptResult> {
    this.webhooks.push({ url, payload, ...(secret ? { secret } : {}), deliveryId });
    if (this.responder)
      return Promise.resolve(
        this.responder(
          deliveryId,
          this.webhooks.filter((call) => call.deliveryId === deliveryId).length,
        ),
      );
    if (this.failWebhooks)
      return Promise.resolve({
        ok: false,
        error: {
          code: 'http',
          message: 'Webhook returned HTTP 400.',
          httpStatus: 400,
          retryable: false,
          acknowledgement: 'rejected',
        },
      });
    return Promise.resolve({ ok: true });
  }
  publishEvent(eventType: string, payload: JsonValue): Promise<void> {
    this.events.push({ eventType, payload });
    return Promise.resolve();
  }
  log(runId: string, payload: JsonValue): void {
    this.logged.push({ runId, payload });
  }
}

export class InMemoryArtifacts implements ArtifactStorePort {
  readonly blobs = new Map<string, { kind: string; content: string }>();
  private counter = 0;
  put(kind: string, content: string): Promise<{ ref: string; bytes: number }> {
    this.counter += 1;
    const ref = `mem://${kind}/${this.counter}`;
    this.blobs.set(ref, { kind, content });
    return Promise.resolve({ ref, bytes: Buffer.byteLength(content, 'utf8') });
  }
  get(ref: string): Promise<string | undefined> {
    return Promise.resolve(this.blobs.get(ref)?.content);
  }
}

export class InMemorySecrets implements SecretsPort {
  constructor(private readonly values: Record<string, string> = {}) {}
  resolve(name: string): Promise<string | undefined> {
    return Promise.resolve(this.values[name]);
  }
}

export const DEFAULT_TEST_SETTINGS: EngineSettings = {
  defaults: { byHarness: { codex: { model: 'gpt-6-luna', effort: 'low' } } },
  maxConcurrentRuns: 4,
  structuredTimeoutMs: 5000,
};

export class FakeClassifierRegistry implements ClassifierRegistryPort {
  readonly requests: {
    ownerId: string;
    modelId: string;
    primitive: ClassifierPrimitive;
    binding: ClassifierBinding;
  }[] = [];
  readonly models = new Map<string, ClassifierPort & Partial<Pick<DeciderPort, 'available'>>>();
  readonly unavailable = new Map<
    string,
    Extract<ClassifierResolution, { status: 'unavailable' }>
  >();
  /** Catalog metadata per id; ids registered in `models` or `unavailable` get a default entry. */
  readonly bindings = new Map<string, ClassifierBinding>();
  constructor(builtin?: ClassifierPort & Partial<Pick<DeciderPort, 'available'>>) {
    if (builtin) this.models.set('jev', builtin);
  }
  bind(_ownerId: string, modelId: string): Promise<ClassifierBinding | undefined> {
    const known = this.models.has(modelId) || this.unavailable.has(modelId);
    return Promise.resolve(
      this.bindings.get(modelId) ??
        (known
          ? {
              provider: modelId === 'jev' ? 'typesafe' : 'http',
              providerModel: modelId === 'jev' ? 'jev-latest' : modelId,
              primitives: ['choice', 'noul', 'score'],
              endpoint: 'https://classifier.test',
            }
          : undefined),
    );
  }
  resolve(
    ownerId: string,
    modelId: string,
    primitive: ClassifierPrimitive,
    binding: ClassifierBinding,
  ): Promise<ClassifierResolution> {
    this.requests.push({ ownerId, modelId, primitive, binding });
    const unavailable = this.unavailable.get(modelId);
    if (unavailable) return Promise.resolve(unavailable);
    const classifier = this.models.get(modelId);
    if (!classifier)
      return Promise.resolve({
        status: 'unavailable',
        reason: 'CLASSIFIER_MODEL_NOT_FOUND',
        message: `Classifier '${modelId}' not found`,
      });
    if (classifier.available && !classifier.available())
      return Promise.resolve({
        status: 'unavailable',
        reason: 'CLASSIFIER_SECRET_MISSING',
        message: `Classifier '${modelId}' is unconfigured`,
      });
    return Promise.resolve({
      status: 'ready',
      classifier,
      provenance: {
        provider: binding.provider,
        classifierId: modelId,
        model: binding.providerModel,
      },
    });
  }
}

export class FakeModelCatalog {
  entries: ModelCatalogEntry[] = ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra'].map((model) => ({
    harness: 'codex',
    model,
    source: 'harness',
    displayName: model,
    efforts: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'low',
    enabled: true,
  }));
  list(): Promise<ModelCatalogEntry[]> {
    return Promise.resolve(this.entries);
  }
}

/** Staged writes exposed only by the testing adapter for transaction fault injection. */
export type AdmissionWrite =
  | 'claim.inbound'
  | 'claim.receipt'
  | 'create.snapshot'
  | 'create.run'
  | 'create.event'
  | 'create.receipt'
  | 'create.link';

export class InMemoryTriggerAdmission implements TriggerAdmissionPort {
  readonly receipts = new Map<string, WebhookReceipt>();
  readonly inbound = new Map<string, WebhookClaim['inbound']>();
  /** Resolved endpoint provenance for preserved inbound-only claims in the testing adapter. */
  readonly inboundScopes = new Map<
    string,
    Pick<WebhookClaim, 'ownerId' | 'loopId' | 'triggerNodeId'>
  >();
  constructor(
    private readonly runs: InMemoryRunRepository,
    private readonly events: InMemoryEventStore,
    private readonly loops: InMemoryLoopRepository,
    private readonly beforeWrite: (write: AdmissionWrite) => void = () => {},
  ) {}
  async create(authored: RunAdmission, receiptId?: string): Promise<RunRecord> {
    const input = parseRunAdmission(authored);
    const receipt = receiptId ? this.receipts.get(receiptId) : undefined;
    if (
      receiptId &&
      (!receipt?.intent ||
        !['pending', 'admitted'].includes(receipt.status) ||
        stableStringify(parseRunAdmission(receipt.intent)) !== stableStringify(input))
    )
      throw new AdmissionConflictError();
    if (receipt && !this.inbound.has(receipt.inboundId)) throw new AdmissionConflictError();
    if (receipt) {
      const inbound = this.inbound.get(receipt.inboundId)!;
      if (
        inbound.runIds.length &&
        stableStringify(inbound.runIds) !== stableStringify([input.run.id])
      )
        throw new AdmissionConflictError();
      assertWebhookClaim({ ...receipt, inbound: { ...inbound, runIds: [] } }, input);
    }
    let run = this.runs.runs.get(input.run.id);
    const created = !run;
    // A draft snapshot is immutable: the same id may only ever hold the same record.
    const existing = input.snapshot ? this.loops.versions.get(input.snapshot.id) : undefined;
    if (existing && stableStringify(existing) !== stableStringify(input.snapshot))
      throw new AdmissionConflictError();
    if (run) {
      const thread = await this.runs.getInitialThread(run.id);
      if (!thread || (input.snapshot && !existing)) throw new AdmissionConflictError();
      assertAdmissionIdentity(input, run, thread, this.events.all(run.id)[0]);
    } else {
      if (this.events.all(input.run.id).length) throw new AdmissionConflictError();
      run = { ...input.run, lastEventSeq: 1 };
      if (input.snapshot && !existing) this.beforeWrite('create.snapshot');
      this.beforeWrite('create.run');
      this.beforeWrite('create.event');
    }
    // Prepare every write (including injected failures) before installing any state. No await
    // separates installation and publication, so listeners see the complete transaction.
    const admitted = receipt ? structuredClone(receipt) : undefined;
    const linked = receipt ? structuredClone(this.inbound.get(receipt.inboundId)!) : undefined;
    if (admitted && linked) {
      admitted.status = 'admitted';
      delete admitted.nextAttemptAt;
      delete admitted.failureCode;
      linked.runIds = [run.id];
      this.beforeWrite('create.receipt');
      this.beforeWrite('create.link');
    }
    if (created) {
      if (input.snapshot && !existing) this.loops.add(structuredClone(input.snapshot));
      this.runs.commitCreated(run, input.initialThread);
      this.events.commitQueued(queuedEvent(input));
    }
    if (admitted && linked) {
      this.receipts.set(admitted.id, admitted);
      this.inbound.set(linked.id, linked);
    }
    if (created) this.events.notifyCommitted(queuedEvent(input));
    return run;
  }
  async createPollItem(authored: RunAdmission): Promise<RunRecord | undefined> {
    const input = parseRunAdmission(authored);
    const { nodeId, dedupeKey } = pollAdmissionIdentity(input);
    const reserved = [...this.receipts.values()].some(
      (receipt) =>
        receipt.status === 'pending' &&
        receipt.ownerId === input.run.ownerId &&
        receipt.loopId === input.run.loopId &&
        receipt.triggerNodeId === nodeId &&
        receipt.intent?.initialThread.invocation.trigger.dedupeKey === dedupeKey,
    );
    if (reserved || this.runs.hasTriggerKey(input.run.ownerId, input.run.loopId, nodeId, dedupeKey))
      return undefined;
    return this.create(input);
  }
  claim(input: WebhookClaim, intent: RunAdmission): Promise<{ receipt: WebhookReceipt }> {
    const frozen = parseRunAdmission(intent);
    assertWebhookClaim(input, frozen);
    const keySeen =
      !!input.inbound.dedupeKey &&
      ([...this.receipts.values()].some(
        (receipt) =>
          receipt.ownerId === input.ownerId &&
          receipt.loopId === input.loopId &&
          receipt.triggerNodeId === input.triggerNodeId &&
          (this.inbound.get(receipt.inboundId)?.dedupeKey === input.inbound.dedupeKey ||
            receipt.intent?.initialThread.invocation.trigger.dedupeKey === input.inbound.dedupeKey),
      ) ||
        [...this.inbound.values()].some((inbound) => {
          const scope = this.inboundScopes.get(inbound.id);
          return (
            inbound.type === 'webhook' &&
            inbound.dedupeKey === input.inbound.dedupeKey &&
            inbound.ownerId === input.ownerId &&
            scope?.ownerId === input.ownerId &&
            scope.loopId === input.loopId &&
            scope.triggerNodeId === input.triggerNodeId
          );
        }) ||
        this.runs.hasTriggerKey(
          input.ownerId,
          input.loopId,
          input.triggerNodeId,
          input.inbound.dedupeKey,
        ));
    const receipt: WebhookReceipt = {
      id: input.id,
      ownerId: input.ownerId,
      loopId: input.loopId,
      triggerNodeId: input.triggerNodeId,
      contentHash: input.contentHash,
      inboundId: input.inbound.id,
      status: keySeen ? 'deduplicated' : 'pending',
      attempts: 0,
      ...(!keySeen
        ? {
            intent: frozen,
            nextAttemptAt: input.inbound.receivedAt,
          }
        : {}),
    };
    if (this.receipts.has(input.id) || this.inbound.has(input.inbound.id))
      throw new AdmissionConflictError();
    const inbound = structuredClone(input.inbound);
    this.beforeWrite('claim.inbound');
    this.beforeWrite('claim.receipt');
    this.receipts.set(receipt.id, receipt);
    this.inbound.set(inbound.id, inbound);
    this.inboundScopes.set(inbound.id, {
      ownerId: input.ownerId,
      loopId: input.loopId,
      triggerNodeId: input.triggerNodeId,
    });
    return Promise.resolve({ receipt: structuredClone(receipt) });
  }
  get(id: string): Promise<WebhookReceipt | undefined> {
    const receipt = this.receipts.get(id);
    return Promise.resolve(
      receipt
        ? {
            ...structuredClone(receipt),
            ...(receipt.intent ? { intent: parseRunAdmission(receipt.intent) } : {}),
          }
        : undefined,
    );
  }
  due(now: string, limit: number): Promise<Pick<WebhookReceipt, 'id' | 'attempts'>[]> {
    return Promise.resolve(
      [...this.receipts.values()]
        .filter(
          (r) => r.status === 'pending' && r.nextAttemptAt !== undefined && r.nextAttemptAt <= now,
        )
        .sort(
          (a, b) =>
            (a.nextAttemptAt ?? '').localeCompare(b.nextAttemptAt ?? '') ||
            a.id.localeCompare(b.id),
        )
        .slice(0, Math.max(0, Math.min(5, limit)))
        .map(({ id, attempts }) => ({ id, attempts })),
    );
  }
  failed(id: string, code: WebhookFailureCode, nextAttemptAt?: string): Promise<void> {
    const receipt = this.receipts.get(id);
    if (!receipt || receipt.status !== 'pending') return Promise.resolve();
    receipt.attempts += 1;
    receipt.failureCode = code;
    if (nextAttemptAt) receipt.nextAttemptAt = nextAttemptAt;
    else {
      receipt.status = 'failed';
      delete receipt.nextAttemptAt;
    }
    return Promise.resolve();
  }
  hasPendingPin(loopId: string): Promise<boolean> {
    return Promise.resolve(
      [...this.receipts.values()].some(
        (r) => r.status === 'pending' && r.intent?.pinnedLoopIds.includes(loopId),
      ),
    );
  }
}

export interface FakePorts extends EnginePorts {
  admission: InMemoryTriggerAdmission;
  modelCatalog: FakeModelCatalog;
  classifiers: FakeClassifierRegistry;
  clock: FakeClock;
  ids: FakeIds;
  logger: CapturingLogger;
  events: InMemoryEventStore;
  runs: InMemoryRunRepository;
  loops: InMemoryLoopRepository;
  sessions: InMemorySessionRepository;
  harness: FakeHarness;
  jev: FakeClassifier;
  codexDecider: FakeDecider;
  structuredFake: FakeStructured;
  scripts: FakeScripts;
  workspace: FakeWorkspace;
  timers: FakeTimers;
  probes: FakeProbes;
  delivery: FakeDelivery;
  artifacts: InMemoryArtifacts;
  secretsFake: InMemorySecrets;
}

/** Build a complete set of fake ports wired together. */
export function createFakePorts(options: { secrets?: Record<string, string> } = {}): FakePorts {
  const clock = new FakeClock();
  const runs = new InMemoryRunRepository();
  const events = new InMemoryEventStore(clock, runs);
  const loops = new InMemoryLoopRepository();
  const admission = new InMemoryTriggerAdmission(runs, events, loops);
  const harness = new FakeHarness();
  const jev = new FakeClassifier('jev');
  const codexDecider = new FakeDecider('codex');
  const structuredFake = new FakeStructured();
  const secretsFake = new InMemorySecrets(options.secrets);
  return {
    clock,
    ids: new FakeIds(),
    logger: new CapturingLogger(),
    events,
    runs,
    admission,
    loops,
    sessions: new InMemorySessionRepository(),
    harnesses: { codex: harness },
    harness,
    deciders: [codexDecider],
    classifiers: new FakeClassifierRegistry(jev),
    modelCatalog: new FakeModelCatalog(),
    jev,
    codexDecider,
    structured: structuredFake,
    structuredFake,
    scripts: new FakeScripts(),
    workspace: new FakeWorkspace(),
    timers: new FakeTimers(),
    probes: new FakeProbes(),
    delivery: new FakeDelivery(),
    artifacts: new InMemoryArtifacts(),
    secrets: secretsFake,
    secretsFake,
  };
}
