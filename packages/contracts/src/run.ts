import { z } from 'zod';
import { ExecutionLimitsSchema } from './loop.js';
import {
  JsonSchemaSchema,
  JsonValueSchema,
  HarnessIdSchema,
  SlugSchema,
  TimestampSchema,
  UlidSchema,
  EffortSchema,
} from './common.js';
import { ClassifierBindingSchema, ClassifierModelIdSchema } from './classifiers.js';
import { HarnessDefaultsSchema } from './evaluation.js';
import { OutcomeSchema, WaitKindSchema } from './nodes.js';
import { WebhookDeliverySchema } from './delivery.js';

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
  'HARNESS_TRANSPORT_FAILED',
  'HARNESS_OUTPUT_LIMIT',
  'RUN_DEADLINE_EXCEEDED',
  'STRUCTURED_COMPLETION_TIMEOUT',
  'RUN_INTERRUPTED_BY_STOP',
  'SCRIPT_TERMINATION_UNCONFIRMED',
  'HARNESS_DELIVERY_UNCERTAIN',
  'HARNESS_SESSION_MISSING',
  'HARNESS_TERMINATION_UNCONFIRMED',
  'WORKING_DIRECTORY_MISSING',
  'SCRIPT_EXIT_CODE',
  'SCRIPT_TIMEOUT',
  'INFERENCE_TIMEOUT',
  'OUTPUT_SCHEMA_MISMATCH',
  'ARTIFACT_WRITE_FAILED',
  'SUBLOOP_DEPTH_EXCEEDED',
  'SUBLOOP_NOT_FOUND',
  // A stored definition the current contract refuses (an exit that publishes an Event, ADR-0044).
  'LOOP_UPGRADE_REQUIRED',
  // Factual historical failures retain their original cause during the offline cutover.
  'DECISION_NO_ROUTE',
  'EVALUATION_UNAVAILABLE',
  'EVALUATION_PROVIDER_FAILED',
  'EVALUATION_INVALID_CONFIGURATION',
  'EVALUATION_INVALID_RESPONSE',
  'EVALUATION_RESULT_REJECTED',
  'EVALUATION_EXPRESSION_FAILED',
  'DECIDER_UNAVAILABLE',
  'SECRET_MISSING',
  'TEMPLATE_ERROR',
  'TEMPLATE_PREREQUISITE_UNAVAILABLE',
  'TEMPLATE_ISOLATION_UNAVAILABLE',
  'TEMPLATE_REPORT_UNAVAILABLE',
  'TEMPLATE_AUTHORITY_REFUSED',
  'TEMPLATE_BINDING_CHANGED',
  'EXPRESSION_ERROR',
  'WAIT_TIMEOUT',
  'HEARTBEAT_EXHAUSTED',
  'HTTP_PROBE_BODY_OVERFLOW',
  'RETURN_DELIVERY_FAILED',
  'MAX_NODE_VISITS',
  'EVENT_INVALID',
  'INTERNAL_ERROR',
]);
export type RunErrorCode = z.infer<typeof RunErrorCodeSchema>;

export const PromptSubmissionSchema = z.enum([
  'definitely-not-submitted',
  'delivery-uncertain',
  'session-missing',
]);
export type PromptSubmission = z.infer<typeof PromptSubmissionSchema>;
/** Current turn evidence, including positively observed submission before an outcome is known. */
export const TurnSubmissionSchema = z.enum([...PromptSubmissionSchema.options, 'submitted']);
export type TurnSubmission = z.infer<typeof TurnSubmissionSchema>;
export const PromptProvenanceSchema = z.strictObject({
  visitId: z.string().min(1).max(64),
  turnId: UlidSchema,
  submission: PromptSubmissionSchema,
  promptKind: z.enum(['authored', 'repair', 'continuation']),
  sessionId: z.string().min(1).max(256).optional(),
  /** Exact uninvoked intent when its separate log append could not be reconciled. */
  retry: z
    .strictObject({
      harness: HarnessIdSchema,
      prompt: z.string(),
      resumeSessionId: z.string().min(1).max(256).optional(),
    })
    .optional(),
});
export type PromptProvenance = z.infer<typeof PromptProvenanceSchema>;

/** A missing conversation's identity and the exact selection that must be retained. */
export const MissingSessionSchema = z.strictObject({
  visitId: z.string().min(1).max(64),
  harness: HarnessIdSchema,
  sessionId: z.string().min(1).max(256).optional(),
  origin: z.enum(['resume-previous', 'resume-named', 'resume-own', 'current-visit']),
  model: z.string().min(1),
  effort: EffortSchema,
});
export type MissingSession = z.infer<typeof MissingSessionSchema>;

export const FreshSessionChoiceSchema = MissingSessionSchema.extend({
  nodeId: SlugSchema,
  failureSeq: z.number().int().positive(),
  priorContextCarried: z.literal(false),
  /** Original authored task, when this visit had already recorded one. */
  prompt: z.string().optional(),
});

export const RunFailureSchema = z.strictObject({
  code: RunErrorCodeSchema,
  message: z.string().max(10_000),
  nodeId: SlugSchema.optional(),
  resumable: z.boolean(),
  details: JsonValueSchema.optional(),
  inference: PromptProvenanceSchema.optional(),
  missingSession: MissingSessionSchema.optional(),
});
export type RunFailure = z.infer<typeof RunFailureSchema>;

/** Why a run is parked and what wakes it. */
export const WaitSpecSchema = z.strictObject({
  /** Opaque identity of this recorded park. Return it with input and signals. */
  waitId: z.string().min(1).max(64),
  nodeId: SlugSchema,
  kind: WaitKindSchema,
  until: TimestampSchema.optional(),
  prompt: z.string().max(10_000).optional(),
  inputSchema: JsonSchemaSchema.optional(),
  signalName: SlugSchema.optional(),
  childRunId: UlidSchema.optional(),
  beat: z.number().int().nonnegative().optional(),
  /** When a wait with a timeout times out; `until` is its own deadline (a timer or next beat). */
  timeoutAt: TimestampSchema.optional(),
  /**
   * The `node.started` sequence that produced this park, used to bound event reads.
   * `waitId` is the identity returned by callers and carried in timer keys.
   */
  startedSeq: z.number().int().positive(),
});
export type WaitSpec = z.infer<typeof WaitSpecSchema>;

/**
 * The model and effort defaults a run inherits below its own loop's defaults, resolved when the
 * run is created and kept for its whole life (ADR-0041): later Settings or `GG_DEFAULTS` changes
 * reach new runs only. A subloop child inherits its parent's; a replay fork keeps its source's.
 */
export const PinnedDefaultsSchema = z.strictObject({
  /** The owner's Settings defaults when the run was created. */
  owner: HarnessDefaultsSchema,
  /** The process defaults (`GG_DEFAULTS`) when the run was created. */
  process: HarnessDefaultsSchema,
});
export type PinnedDefaults = z.infer<typeof PinnedDefaultsSchema>;

/**
 * What a run's `versionId` pins: an immutable definition record (ADR-0041). A published start pins
 * that published version; a draft start pins a snapshot of the draft frozen when the run was
 * created, so later draft edits never reach it.
 */
export const RunPinSchema = z.strictObject({
  /** `published`: a published loop version. `draft`: the snapshot of the draft taken at start. */
  source: z.enum(['published', 'draft']),
  /** The loop version number: the published number, or the draft's number when it was frozen. */
  version: z.number().int().positive(),
  /** The loop name in the pinned definition; renaming the loop later does not change it. */
  name: z.string().min(1).max(120),
  /** Readable label: `<name> v<version>`, or `<name> draft v<version>` for a draft snapshot. */
  label: z.string().min(1).max(160),
  defaults: PinnedDefaultsSchema,
  limits: ExecutionLimitsSchema,
  /**
   * The execution binding of every classifier the pinned definition references, by catalog id,
   * taken at start (a child inherits its parent's for the ids they share). A classifier missing at
   * start has no binding, and its decision fails without consulting the current catalog.
   */
  classifiers: z.record(ClassifierModelIdSchema, ClassifierBindingSchema),
});
export type RunPin = z.infer<typeof RunPinSchema>;

export const RunRecordSchema = z.strictObject({
  id: UlidSchema,
  ownerId: z.string().min(1).max(128),
  loopId: UlidSchema,
  /**
   * The immutable definition record the run executes for its whole life: a published version, or
   * the draft snapshot taken when the run was created (ADR-0041). `pinned` describes it.
   */
  versionId: UlidSchema,
  pinned: RunPinSchema,
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
  /** Webhook delivery is independent of execution status; absent when no webhook is queued. */
  deliveries: z.array(WebhookDeliverySchema).optional(),
  createdAt: TimestampSchema,
  startedAt: TimestampSchema.optional(),
  finishedAt: TimestampSchema.optional(),
  lastEventSeq: z.number().int().nonnegative(),
});
export type RunRecord = z.infer<typeof RunRecordSchema>;
