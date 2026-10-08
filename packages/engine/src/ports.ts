import type { TriggerAdmissionPort } from './admission.js';
import type {
  ChoiceAnswer,
  ChoiceOption,
  ClassifierPrimitive,
  ScoreAnswer,
  HarnessDefaults,
  HarnessPreflight as ContractHarnessPreflight,
  ModelCatalogEntry,
  ContextThread,
  Effort,
  HarnessId,
  HarnessOptions,
  Capabilities,
  JsonSchema,
  JsonValue,
  LoopVersionRecord,
  ProgressItemStatus,
  RunEvent,
  RunRecord,
  RunStatus,
  Usage,
  WorkingDirectorySpec,
} from '@graphgoblin/contracts';

/**
 * Ports the engine depends on. Adapters implement them; `@graphgoblin/engine/testing` ships
 * in-memory fakes for every one so the engine can be tested without I/O.
 * See docs/02-architecture.md and docs/05-execution-engine.md.
 */

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A run event before the store assigns `runId`, `seq`, and `ts`. */
export type EventDraft = DistributiveOmit<RunEvent, 'runId' | 'seq' | 'ts'>;

export interface ClockPort {
  now(): Date;
}

export interface IdPort {
  /** A new ULID. */
  next(): string;
}

export interface Logger {
  debug(obj: Record<string, unknown>, msg: string): void;
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface EventStorePort {
  /**
   * Append in order, atomically, assigning strictly increasing `seq` per run. Returns the stored
   * events. With `expectedLastSeq`, the append happens only if the run's last `seq` is exactly
   * that (0 for an empty log); otherwise nothing is written and `AppendConflictError` is thrown.
   */
  append(
    runId: string,
    drafts: readonly EventDraft[],
    options?: { expectedLastSeq?: number },
  ): Promise<RunEvent[]>;
  /** Events after `afterSeq` (default 0), oldest first, at most `limit` of them when given. */
  read(runId: string, afterSeq?: number, limit?: number): Promise<RunEvent[]>;
  subscribe(runId: string, listener: (event: RunEvent) => void): () => void;
}

/** Field-level changes to a run record; `undefined` clears a field. */
export type RunRecordChanges = { [K in keyof RunRecord]?: RunRecord[K] | undefined };

export interface RunRepository {
  create(run: RunRecord, initialThread: ContextThread): Promise<void>;
  get(runId: string): Promise<RunRecord | undefined>;
  update(runId: string, changes: RunRecordChanges): Promise<RunRecord>;
  /**
   * Compare-and-set: apply `changes` only if the run's status is one of `from`.
   * Returns the updated record, or undefined when the status did not match. Lifecycle transitions
   * go through this so concurrent commands cannot clobber each other.
   */
  transition(
    runId: string,
    from: readonly RunStatus[],
    changes: RunRecordChanges,
  ): Promise<RunRecord | undefined>;
  /**
   * Record a cancel request once: set `cancelRequestedAt` only when it is unset and the status is
   * one of `from`, atomically. Returns the updated record, or undefined when another request got
   * there first or the status did not match, so concurrent cancels append one audit event.
   */
  claimCancel(
    runId: string,
    from: readonly RunStatus[],
    at: string,
  ): Promise<RunRecord | undefined>;
  listByStatus(statuses: readonly RunStatus[]): Promise<RunRecord[]>;
  /**
   * Record that everything after the run's terminal status is done: timers dropped, children
   * cancelled, returns delivered, parent woken. Until then the run is listed by `listUnfinalized`.
   */
  markFinalized(runId: string): Promise<void>;
  /** Forget a finalization: the run is leaving its terminal status (a resume of a failure). */
  clearFinalized(runId: string): Promise<void>;
  /** Terminal runs whose finalization was never recorded (the process died part-way). */
  listUnfinalized(): Promise<RunRecord[]>;
  listChildren(parentRunId: string): Promise<RunRecord[]>;
  getInitialThread(runId: string): Promise<ContextThread | undefined>;
  getThread(runId: string): Promise<ContextThread | undefined>;
  /**
   * Save the thread snapshot. `seq` is the last event it reflects: the thread equals the initial
   * thread with every event up to `seq` replayed. Without `seq` it is a plain snapshot for reads.
   */
  saveThread(runId: string, thread: ContextThread, seq?: number): Promise<void>;
  /** The snapshot with the `seq` it reflects, when it was saved with one. */
  getThreadCheckpoint(runId: string): Promise<{ thread: ContextThread; seq: number } | undefined>;
}

export interface LoopRepository {
  getVersion(versionId: string): Promise<LoopVersionRecord | undefined>;
  getLatestPublished(loopId: string): Promise<LoopVersionRecord | undefined>;
  getPublished(loopId: string, version: number): Promise<LoopVersionRecord | undefined>;
}

export interface HarnessSessionRecord {
  runId: string;
  nodeId: string;
  attempt: number;
  harness: HarnessId;
  sessionId?: string;
  status: 'starting' | 'active' | 'finished' | 'failed';
  model?: string;
  effort?: Effort;
  /** For `resume-named` sessions: `${loopId}:${key}`. */
  scopeKey?: string;
  updatedAt: string;
}

export interface HarnessSessionRepository {
  upsert(row: HarnessSessionRecord): Promise<void>;
  forNode(runId: string, nodeId: string): Promise<HarnessSessionRecord | undefined>;
  latestWithSession(runId: string, harness: HarnessId): Promise<HarnessSessionRecord | undefined>;
  byScopeKey(scopeKey: string, harness: HarnessId): Promise<HarnessSessionRecord | undefined>;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

export type HarnessItemType =
  'message' | 'reasoning' | 'command' | 'file-change' | 'tool-call' | 'search' | 'error' | 'other';

export interface HarnessItem {
  id: string;
  type: HarnessItemType;
  summary: string;
  /** Bounded, one-line command text for safe progress display. */
  commandPreview?: string;
  /** Process exit code when the harness reports one. */
  exitCode?: number;
  /** Allowlisted harness item state when the SDK reports one. */
  status?: ProgressItemStatus;
  detail?: JsonValue;
}

export type HarnessEvent =
  | { type: 'session'; sessionId: string; mode: 'fresh' | 'resumed' }
  | { type: 'item'; item: HarnessItem }
  | { type: 'usage'; usage: Usage }
  | { type: 'turn-complete' }
  | { type: 'error'; code: string; message: string; retriable: boolean };

export interface HarnessTurnRequest {
  prompt: string;
  outputSchema?: JsonSchema;
}

export interface HarnessStartRequest {
  workingDirectory: string;
  model?: string;
  effort?: Effort;
  options: HarnessOptions;
  capabilities?: Capabilities;
  turn: HarnessTurnRequest;
}

export interface HarnessResult {
  finalText: string;
  structured?: unknown;
  usage: Usage;
  items: HarnessItem[];
}

export interface HarnessSession {
  sessionId: Promise<string>;
  events: AsyncIterable<HarnessEvent>;
  result: Promise<HarnessResult>;
  cancel(): Promise<void>;
}

export type HarnessPreflight = ContractHarnessPreflight;

export interface HarnessPort {
  readonly id: HarnessId;
  preflight(): Promise<HarnessPreflight>;
  start(request: HarnessStartRequest, signal: AbortSignal): HarnessSession;
  /**
   * Continue an existing session. The request carries the node's full session settings (model,
   * effort, harness options, working directory), the same as `start`, so a resumed turn never
   * falls back to harness or machine defaults.
   */
  resume(sessionId: string, request: HarnessStartRequest, signal: AbortSignal): HarnessSession;
}

// ---------------------------------------------------------------------------
// Decisions and structured completions
// ---------------------------------------------------------------------------

export interface ChoiceRequest {
  question: string;
  options: ChoiceOption[];
  context: JsonValue;
  model?: string;
  effort?: Effort;
}

export type ChoiceResult = ChoiceAnswer;

export interface ModelCatalogPort {
  list(): Promise<ModelCatalogEntry[]>;
}

export interface PrimitiveRequest {
  question: string;
  context: JsonValue;
  model?: string;
  effort?: Effort;
}

export interface NoulRequest extends PrimitiveRequest {
  criteria: { true: string; false: string };
}
export interface ClassifierNoulResult {
  type: 'noul';
  trueProbability: number;
}
export interface LlmNoulResult {
  type: 'noul';
  holds: boolean;
  confidence: number;
  reasoning: string;
}
export interface ScoreRequest extends PrimitiveRequest {
  anchors: string[];
}
export type ScoreResult = ScoreAnswer;

export interface DeciderPort {
  readonly id: 'jev' | 'codex';
  available(): boolean;
  choose(request: ChoiceRequest, signal: AbortSignal): Promise<ChoiceResult>;
  /** Strict boolean Noul capability. */
  noul(request: NoulRequest, signal: AbortSignal): Promise<LlmNoulResult>;
}

/** Primitive-specific provider snapshot; an in-flight request retains its resolved configuration. */
export interface ClassifierPort {
  choose(request: ChoiceRequest, signal: AbortSignal): Promise<ChoiceResult>;
  classifyNoul(request: NoulRequest, signal: AbortSignal): Promise<ClassifierNoulResult>;
  score(request: ScoreRequest, signal: AbortSignal): Promise<ScoreResult>;
}

export type ClassifierUnavailableReason =
  | 'CLASSIFIER_MODEL_NOT_FOUND'
  | 'CLASSIFIER_PRIMITIVE_UNSUPPORTED'
  | 'CLASSIFIER_MODEL_DISABLED'
  | 'CLASSIFIER_SECRET_MISSING'
  | 'CLASSIFIER_SECRET_UNREADABLE';

export type ClassifierResolution =
  | {
      status: 'ready';
      classifier: ClassifierPort;
      provenance: { provider: string; classifierId: string; model: string };
    }
  | { status: 'unavailable'; reason: ClassifierUnavailableReason; message: string };

export interface ClassifierRegistryPort {
  resolve(
    ownerId: string,
    modelId: string,
    primitive: ClassifierPrimitive,
  ): Promise<ClassifierResolution>;
}

/** A single structured completion: prompt in, schema-shaped value out. Used for repair and Codex decisions. */
export interface StructuredPort {
  complete(
    request: {
      prompt: string;
      schema: JsonSchema;
      model?: string;
      effort?: Effort;
      workingDirectory?: string;
    },
    signal: AbortSignal,
  ): Promise<{ value: unknown; usage?: Usage }>;
}

// ---------------------------------------------------------------------------
// Processes, workspace, timers, probes, delivery, artifacts, secrets
// ---------------------------------------------------------------------------

export interface ScriptRunRequest {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  stdin?: string;
  timeoutMs?: number;
  /** Opt-in raw-byte stdout bound; callers must check stdoutOverflow before parsing. */
  maxStdoutBytes?: number;
  signal: AbortSignal;
}

export interface ScriptRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Present whenever maxStdoutBytes was requested; true means stdout was truncated. */
  stdoutOverflow?: boolean;
}

export interface ScriptPort {
  run(request: ScriptRunRequest): Promise<ScriptRunResult>;
}

export interface WorkspacePort {
  /** Resolve and ensure a run's working directory. */
  resolve(
    spec: WorkingDirectorySpec,
    view: Record<string, unknown>,
    runId: string,
  ): Promise<string>;
  /** Write a file; relative paths resolve against `dir`. Returns the absolute path. */
  writeFile(dir: string, path: string, content: string): Promise<string>;
}

export interface TimerPort {
  /** Arm or re-arm the run's timer named `key`: one timer per run and key (an upsert). */
  schedule(runId: string, key: string, at: Date): Promise<void>;
  cancel(runId: string, key?: string): Promise<void>;
  /**
   * Listeners may return a promise. Implementations await it and remove the fired timer only
   * afterwards, so delivery is at-least-once: a fire interrupted by a crash fires again after a
   * restart. Listeners must therefore be idempotent.
   */
  onFire(listener: (runId: string, key: string) => void | Promise<void>): () => void;
}

export interface ProbeRequest {
  method: 'GET' | 'POST' | 'HEAD';
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

export interface ProbeResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  json?: unknown;
}

export interface HttpProbePort {
  fetch(request: ProbeRequest, signal: AbortSignal): Promise<ProbeResponse>;
}

export interface ReturnDeliveryPort {
  webhook(url: string, payload: JsonValue, secret?: string): Promise<void>;
  publishEvent(eventType: string, payload: JsonValue): Promise<void>;
  log(runId: string, payload: JsonValue): void;
}

export interface ArtifactStorePort {
  put(kind: string, content: string): Promise<{ ref: string; bytes: number }>;
  get(ref: string): Promise<string | undefined>;
}

export interface SecretsPort {
  resolve(name: string): Promise<string | undefined>;
}

export interface EngineSettings {
  /** Last-resort model and effort, below node, loop, and owner defaults. */
  defaults: HarnessDefaults;
  /**
   * The owner's default model and effort (Settings), read when a run starts or resumes. Either may
   * be absent; the configured defaults above then apply.
   */
  ownerDefaults?: (ownerId: string) => Promise<HarnessDefaults>;
  maxConcurrentRuns: number;
  /** Max wall-clock for a single structured completion used in decisions and repair. */
  structuredTimeoutMs: number;
}

export interface EnginePorts {
  clock: ClockPort;
  ids: IdPort;
  logger: Logger;
  events: EventStorePort;
  runs: RunRepository;
  admission: TriggerAdmissionPort;
  loops: LoopRepository;
  sessions: HarnessSessionRepository;
  harnesses: Partial<Record<HarnessId, HarnessPort>>;
  deciders: DeciderPort[];
  classifiers: ClassifierRegistryPort;
  modelCatalog: ModelCatalogPort;
  structured?: StructuredPort;
  scripts: ScriptPort;
  workspace: WorkspacePort;
  timers: TimerPort;
  probes: HttpProbePort;
  delivery: ReturnDeliveryPort;
  artifacts: ArtifactStorePort;
  secrets: SecretsPort;
}
