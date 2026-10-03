import { z } from 'zod';
import {
  JsonSchemaSchema,
  JsonValueSchema,
  SlugSchema,
  TimestampSchema,
  UlidSchema,
} from './common.js';
import { OutcomeSchema, WaitKindSchema } from './nodes.js';

export const RunStatusSchema = z.enum([
  'queued',
  'running',
  'waiting',
  'paused',
  'succeeded',
  'failed',
  'cancelled',
  'exhausted',
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  'succeeded',
  'failed',
  'cancelled',
  'exhausted',
];

/**
 * Typed reasons a run can fail. See the resiliency model in docs/05-execution-engine.md.
 * Every code except INTERNAL_ERROR is an "unavoidable" condition; INTERNAL_ERROR is a bug.
 */
export const RunErrorCodeSchema = z.enum([
  'HARNESS_NOT_INSTALLED',
  'HARNESS_NOT_AUTHENTICATED',
  'HARNESS_QUOTA_EXHAUSTED',
  'HARNESS_TURN_FAILED',
  'WORKING_DIRECTORY_MISSING',
  'SCRIPT_EXIT_CODE',
  'SCRIPT_TIMEOUT',
  'INFERENCE_TIMEOUT',
  'OUTPUT_SCHEMA_MISMATCH',
  'SUBLOOP_DEPTH_EXCEEDED',
  'SUBLOOP_NOT_FOUND',
  'DECISION_NO_ROUTE',
  'DECIDER_UNAVAILABLE',
  'SECRET_MISSING',
  'TEMPLATE_ERROR',
  'EXPRESSION_ERROR',
  'WAIT_TIMEOUT',
  'HEARTBEAT_EXHAUSTED',
  'RETURN_DELIVERY_FAILED',
  'INTERNAL_ERROR',
]);
export type RunErrorCode = z.infer<typeof RunErrorCodeSchema>;

export const RunFailureSchema = z.strictObject({
  code: RunErrorCodeSchema,
  message: z.string().max(10_000),
  nodeId: SlugSchema.optional(),
  resumable: z.boolean(),
  details: JsonValueSchema.optional(),
});
export type RunFailure = z.infer<typeof RunFailureSchema>;

/** Why a run is parked and what wakes it. */
export const WaitSpecSchema = z.strictObject({
  nodeId: SlugSchema,
  kind: WaitKindSchema,
  until: TimestampSchema.optional(),
  prompt: z.string().max(10_000).optional(),
  inputSchema: JsonSchemaSchema.optional(),
  signalName: SlugSchema.optional(),
  childRunId: UlidSchema.optional(),
  beat: z.number().int().nonnegative().optional(),
});
export type WaitSpec = z.infer<typeof WaitSpecSchema>;

export const RunRecordSchema = z.strictObject({
  id: UlidSchema,
  ownerId: z.string().min(1).max(128),
  loopId: UlidSchema,
  versionId: UlidSchema,
  parentRunId: UlidSchema.optional(),
  invocationId: UlidSchema,
  status: RunStatusSchema,
  currentNodeId: SlugSchema.optional(),
  iteration: z.number().int().positive(),
  waiting: WaitSpecSchema.optional(),
  cancelRequestedAt: TimestampSchema.optional(),
  pausedAt: TimestampSchema.optional(),
  failure: RunFailureSchema.optional(),
  outcome: OutcomeSchema.optional(),
  result: JsonValueSchema.optional(),
  createdAt: TimestampSchema,
  startedAt: TimestampSchema.optional(),
  finishedAt: TimestampSchema.optional(),
  lastEventSeq: z.number().int().nonnegative(),
});
export type RunRecord = z.infer<typeof RunRecordSchema>;
