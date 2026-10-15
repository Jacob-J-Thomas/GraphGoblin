import type {
  ContextThread,
  JsonPatch,
  JsonValue,
  LoopDefinition,
  Node,
  NodeKind,
  NodeOfKind,
  Outcome,
  ReturnChannel,
  RunRecord,
  WaitSpec,
  Effort,
  HarnessId,
  RunEvent,
} from '@graphgoblin/contracts';
import type { EnginePorts, EventDraft, EngineSettings } from './ports.js';

/** Why a parked node was woken, with the payload that woke it. */
export interface WakeInfo {
  reason: 'input' | 'timer' | 'signal' | 'child' | 'timeout' | 'manual';
  payload?: JsonValue;
  /** Timer key for timer wakes: `timer`, `timeout`, or `heartbeat`. */
  key?: string;
}

export interface ChildStartRequest {
  loopId: string;
  version: 'latest' | number;
  seed: Pick<Partial<ContextThread>, 'messages' | 'vars' | 'artifacts' | 'outputs' | 'lastOutput'>;
  triggerPayload: JsonValue;
  depthLimit: number;
}

export interface ChildOutcome {
  runId: string;
  status: RunRecord['status'];
  outcome?: Outcome;
  result?: JsonValue;
  thread?: ContextThread;
}

/** Services the executor hands to handlers. Everything that touches the outside world goes through here. */
export interface HandlerServices {
  /** Render a Liquid template against the thread view plus extras. */
  render(template: string, extras?: Record<string, unknown>): Promise<string>;
  /** Append events to the run log right away (progress, decisions, usage). */
  record(draft: EventDraft): Promise<void>;
  /** Resolve the model and effort for an inferencing or decision step. */
  resolveModel(
    harness: HarnessId,
    model?: string,
    effort?: Effort,
  ): Promise<{ model: string; effort: Effort }>;
  /** Start a child run and return its id. The parent then parks on it. */
  startChild(request: ChildStartRequest): Promise<string>;
  /** Read a finished child's outcome and final thread. */
  childOutcome(childRunId: string): Promise<ChildOutcome>;
  /** Events of this run so far. */
  events(): Promise<readonly RunEvent[]>;
  /** Current depth of this run in the subloop tree (0 for a top-level run). */
  depth(): Promise<number>;
  /** Working directory for this run, resolved once per run. */
  workingDirectory(): Promise<string>;
  /** Generate ids and read the clock. */
  newId(): string;
  now(): string;
}

export interface NodeContext<K extends NodeKind = NodeKind> {
  node: NodeOfKind<K>;
  config: NodeOfKind<K>['config'];
  definition: LoopDefinition;
  thread: Readonly<ContextThread>;
  run: Readonly<RunRecord>;
  attempt: number;
  /** Set when this execution resumes a parked node. */
  wake?: WakeInfo;
  /** The wait spec recorded when this node parked, if it did. */
  previousWait?: WaitSpec;
  signal: AbortSignal;
  ports: EnginePorts;
  settings: EngineSettings;
  services: HandlerServices;
}

export type NodeResult =
  | { kind: 'done'; patch: JsonPatch; route: string }
  | { kind: 'park'; patch: JsonPatch; wait: WaitSpec }
  | {
      kind: 'exit';
      patch: JsonPatch;
      outcome: Outcome;
      reason: string;
      returnPayload?: JsonValue;
      channels: ReturnChannel[];
    }
  | { kind: 'loop-back'; patch: JsonPatch; targetNodeId: string };

export interface NodeHandler<K extends NodeKind = NodeKind> {
  readonly kind: K;
  execute(ctx: NodeContext<K>): Promise<NodeResult>;
}

export type HandlerRegistry = { [K in NodeKind]: NodeHandler<K> };

export function nodeOfKind<K extends NodeKind>(node: Node, kind: K): NodeOfKind<K> {
  if (node.kind !== kind) {
    throw new Error(`expected node ${node.id} to be ${kind}, got ${node.kind}`);
  }
  return node as NodeOfKind<K>;
}
