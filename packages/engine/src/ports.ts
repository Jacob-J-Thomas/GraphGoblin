import type {
  ContextThread,
  Effort,
  HarnessId,
  HarnessOptions,
  Capabilities,
  JsonSchema,
  JsonValue,
  LoopVersionRecord,
  RunEvent,
  RunRecord,
  RunStatus,
  Usage,
  WorkingDirectorySpec,
} from '@graphgoblin/contracts';
import type { PredicateAnswer } from '@graphgoblin/domain';

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
  /** Append in order, assigning strictly increasing `seq` per run. Returns the stored events. */
  append(runId: string, drafts: readonly EventDraft[]): Promise<RunEvent[]>;
  read(runId: string, afterSeq?: number): Promise<RunEvent[]>;
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
  listByStatus(statuses: readonly RunStatus[]): Promise<RunRecord[]>;
  listChildren(parentRunId: string): Promise<RunRecord[]>;
  getInitialThread(runId: string): Promise<ContextThread | undefined>;
  getThread(runId: string): Promise<ContextThread | undefined>;
  saveThread(runId: string, thread: ContextThread): Promise<void>;
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
  latestWithSession(runId: string): Promise<HarnessSessionRecord | undefined>;
  byScopeKey(scopeKey: string): Promise<HarnessSessionRecord | undefined>;
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

export interface HarnessPreflight {
  ok: boolean;
  version?: string;
  authenticated: boolean;
  problems: string[];
}

export interface HarnessPort {
  readonly id: HarnessId;
  preflight(): Promise<HarnessPreflight>;
  start(request: HarnessStartRequest, signal: AbortSignal): HarnessSession;
  resume(sessionId: string, request: HarnessTurnRequest, signal: AbortSignal): HarnessSession;
}

// ---------------------------------------------------------------------------
// Decisions and structured completions
// ---------------------------------------------------------------------------

export interface ChoiceRequest {
  question: string;
  options: { label: string; description: string }[];
  context: JsonValue;
  model?: string;
  effort?: Effort;
}

export interface ChoiceResult {
  label: string;
  confidence?: number;
  alternatives?: { label: string; confidence?: number }[];
}

export interface YesNoRequest {
  question: string;
  context: JsonValue;
  model?: string;
  effort?: Effort;
}

export interface DeciderPort {
  readonly id: 'jev' | 'codex';
  available(): boolean;
  choose(request: ChoiceRequest, signal: AbortSignal): Promise<ChoiceResult>;
  judge(request: YesNoRequest, signal: AbortSignal): Promise<PredicateAnswer>;
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
  signal: AbortSignal;
}

export interface ScriptRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
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
  schedule(runId: string, key: string, at: Date): Promise<void>;
  cancel(runId: string, key?: string): Promise<void>;
  /** Listeners may return a promise; implementations should await it before considering the fire handled. */
  onFire(listener: (runId: string, key: string) => void | Promise<void>): () => void;
}

/** Persisted timers. A secondary port shared by the scheduler adapter (which fires) and the storage adapter (which keeps). */
export interface TimerStorePort {
  upsert(runId: string, key: string, at: Date): Promise<void>;
  remove(runId: string, key?: string): Promise<void>;
  /** Timers due at or before `now`, oldest first. */
  listDue(now: Date, limit?: number): Promise<{ runId: string; key: string; at: Date }[]>;
  list(runId: string): Promise<{ runId: string; key: string; at: Date }[]>;
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
  defaultModel: string;
  defaultEffort: Effort;
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
  loops: LoopRepository;
  sessions: HarnessSessionRepository;
  harnesses: Partial<Record<HarnessId, HarnessPort>>;
  deciders: DeciderPort[];
  structured?: StructuredPort;
  scripts: ScriptPort;
  workspace: WorkspacePort;
  timers: TimerPort;
  probes: HttpProbePort;
  delivery: ReturnDeliveryPort;
  artifacts: ArtifactStorePort;
  secrets: SecretsPort;
}
