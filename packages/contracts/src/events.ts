import { z } from 'zod';
import {
  EffortSchema,
  HarnessIdSchema,
  JsonValueSchema,
  SlugSchema,
  TimestampSchema,
  UlidSchema,
} from './common.js';
import { OutcomeSchema } from './nodes.js';
import { JsonPatchSchema } from './patch.js';
import { RunFailureSchema, RunStatusSchema, WaitSpecSchema } from './run.js';
import {
  ContextThreadSchema,
  ReplayOriginSchema,
  ReturnChannelSchema,
  UsageSchema,
} from './thread.js';

const Base = {
  runId: UlidSchema,
  seq: z.number().int().positive(),
  ts: TimestampSchema,
};

const Actor = z.strictObject({
  kind: z.enum(['user', 'api-key', 'mcp-client', 'system', 'run']),
  id: z.string().min(1).max(256),
});

/**
 * The append-only run event log. One `seq` per run, strictly increasing.
 * Large payloads live in artifacts and are referenced here.
 */
export const RunEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...Base,
    type: z.literal('run.queued'),
    /** Present when the run is a replay fork; mirrors `invocation.replayOf` on its thread. */
    replayOf: ReplayOriginSchema.optional(),
    /** The thread the run starts from, including a subloop seed, so replay needs no other source. */
    initialThread: ContextThreadSchema.optional(),
  }),
  z.strictObject({ ...Base, type: z.literal('run.started'), attempt: z.number().int().positive() }),
  z.strictObject({
    ...Base,
    type: z.literal('run.finished'),
    status: RunStatusSchema,
    outcome: OutcomeSchema,
    resultRef: z.string().max(4096).optional(),
    result: JsonValueSchema.optional(),
  }),
  z.strictObject({ ...Base, type: z.literal('run.failed'), failure: RunFailureSchema }),
  z.strictObject({ ...Base, type: z.literal('run.paused'), actor: Actor }),
  z.strictObject({ ...Base, type: z.literal('run.resumed'), actor: Actor }),
  z.strictObject({ ...Base, type: z.literal('run.cancel_requested'), actor: Actor }),
  z.strictObject({ ...Base, type: z.literal('run.cancelled') }),
  z.strictObject({
    ...Base,
    type: z.literal('run.waiting'),
    nodeId: SlugSchema,
    wait: WaitSpecSchema,
  }),
  z.strictObject({
    ...Base,
    type: z.literal('run.woken'),
    nodeId: SlugSchema,
    reason: z.enum(['input', 'timer', 'signal', 'child', 'timeout', 'manual']),
    payload: JsonValueSchema.optional(),
  }),
  z.strictObject({
    ...Base,
    type: z.literal('iteration.incremented'),
    from: z.number().int().positive(),
    to: z.number().int().positive(),
    targetNodeId: SlugSchema,
  }),
  z.strictObject({
    ...Base,
    type: z.literal('node.started'),
    nodeId: SlugSchema,
    kind: z.string(),
    attempt: z.number().int().positive(),
    configHash: z.string().max(128),
  }),
  z.strictObject({
    ...Base,
    type: z.literal('node.finished'),
    nodeId: SlugSchema,
    patch: JsonPatchSchema,
    route: SlugSchema.optional(),
    durationMs: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ...Base,
    type: z.literal('node.progress'),
    nodeId: SlugSchema,
    progress: JsonValueSchema,
  }),
  z.strictObject({
    ...Base,
    type: z.literal('harness.session'),
    nodeId: SlugSchema,
    harness: HarnessIdSchema,
    sessionId: z.string().min(1).max(256),
    mode: z.enum(['fresh', 'resumed']),
    model: z.string().optional(),
    effort: EffortSchema.optional(),
  }),
  z.strictObject({
    ...Base,
    type: z.literal('harness.usage'),
    nodeId: SlugSchema,
    usage: UsageSchema,
  }),
  z.strictObject({
    ...Base,
    type: z.literal('decision.made'),
    nodeId: SlugSchema,
    strategy: z.enum(['jev', 'codex', 'expression']),
    route: SlugSchema,
    confidence: z.number().min(0).max(1).optional(),
    alternatives: z
      .array(z.strictObject({ route: SlugSchema, confidence: z.number().min(0).max(1).optional() }))
      .optional(),
  }),
  z.strictObject({
    ...Base,
    type: z.literal('signal.received'),
    name: SlugSchema,
    payload: JsonValueSchema.optional(),
  }),
  z.strictObject({
    ...Base,
    type: z.literal('input.received'),
    nodeId: SlugSchema,
    payload: JsonValueSchema,
  }),
  z.strictObject({
    ...Base,
    type: z.literal('heartbeat.beat'),
    nodeId: SlugSchema,
    beat: z.number().int().positive(),
    result: JsonValueSchema.optional(),
  }),
  z.strictObject({
    ...Base,
    type: z.literal('child_run.started'),
    nodeId: SlugSchema,
    childRunId: UlidSchema,
  }),
  z.strictObject({
    ...Base,
    type: z.literal('child_run.finished'),
    nodeId: SlugSchema,
    childRunId: UlidSchema,
    outcome: OutcomeSchema.optional(),
    status: RunStatusSchema,
  }),
  z.strictObject({
    ...Base,
    type: z.literal('return.delivered'),
    channel: ReturnChannelSchema,
    target: z.string().max(4096).optional(),
  }),
  z.strictObject({
    ...Base,
    type: z.literal('return.failed'),
    channel: ReturnChannelSchema,
    error: z.string().max(4000),
  }),
]);
export type RunEvent = z.infer<typeof RunEventSchema>;
export type RunEventType = RunEvent['type'];
export type RunEventOfType<T extends RunEventType> = Extract<RunEvent, { type: T }>;

/** An event before the store assigns `seq` and `ts`. */
export type RunEventDraft = RunEvent extends infer E
  ? E extends { seq: number; ts: string }
    ? Omit<E, 'seq' | 'ts'>
    : never
  : never;
