import { z } from 'zod';
import {
  DecisionEvidenceSchema,
  DecisionEmissionSchema,
  PrimitiveAnswerSchema,
  EvaluationProvenanceSchema,
  EvaluationAcceptanceSchema,
} from './evaluation.js';
import {
  EffortSchema,
  HarnessIdSchema,
  JsonValueSchema,
  SlugSchema,
  TimestampSchema,
  UlidSchema,
} from './common.js';
import { OutcomeSchema, ExitPredicateMatchSchema } from './nodes.js';
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

export const ExitDiagnosticSchema = z.strictObject({
  code: z.enum([
    'CRITERION_ERROR',
    'RETURN_MAPPING_ERROR',
    'DECIDER_UNAVAILABLE',
    'DECIDER_NOT_AUTHENTICATED',
    'DECIDER_RATE_LIMITED',
    'DECIDER_HTTP_ERROR',
    'DECIDER_UNREACHABLE',
    'DECIDER_INVALID_RESPONSE',
    'DECIDER_REDIRECT',
    'DECIDER_TIMEOUT',
    'DECIDER_ERROR',
    'EVALUATION_UNAVAILABLE',
    'EVALUATION_PROVIDER_FAILED',
    'EVALUATION_INVALID_CONFIGURATION',
    'EVALUATION_INVALID_RESPONSE',
    'EVALUATION_RESULT_REJECTED',
    'EVALUATION_EXPRESSION_FAILED',
  ]),
  message: z.string().min(1).max(256),
  status: z.number().int().min(100).max(599).optional(),
});

const CriterionEvidence = {
  /** Zero-based position in the exit configuration. The inspector displays index + 1. */
  index: z.number().int().min(0).max(31),
  strategy: z.enum([
    'expression',
    'classifier',
    'llm',
    'max-iterations',
    'max-duration',
    'last-output-matches',
  ]),
};
export const ExitCriterionEvaluationSchema = z.union([
  z.strictObject({
    ...CriterionEvidence,
    strategy: z.enum(['expression', 'classifier', 'llm']),
    status: z.enum(['matched', 'not-matched']),
    answer: PrimitiveAnswerSchema,
    provenance: EvaluationProvenanceSchema,
    /** Null means the archived evidence did not establish the acceptance gate. */
    acceptance: EvaluationAcceptanceSchema.nullable(),
    match: ExitPredicateMatchSchema,
    configuredMinConfidence: z.number().min(0).max(1).optional(),
    rejection: z
      .strictObject({
        kind: z.enum(['classifier-confidence', 'llm-reported-confidence']),
        minimum: z.number().min(0).max(1),
        confidence: z.number().min(0).max(1).nullable(),
      })
      .optional(),
  }),
  z.strictObject({
    ...CriterionEvidence,
    strategy: z.enum(['max-iterations', 'max-duration', 'last-output-matches']),
    status: z.enum(['matched', 'not-matched']),
    holds: z.boolean().nullable(),
  }),
  z.strictObject({
    ...CriterionEvidence,
    status: z.literal('skipped'),
    reason: z.strictObject({
      code: z.enum(['EARLIER_CRITERION_MATCHED', 'EARLIER_CRITERION_FAILED']),
      message: z.string().min(1).max(256),
    }),
  }),
  z.strictObject({
    ...CriterionEvidence,
    status: z.literal('error'),
    diagnostic: ExitDiagnosticSchema,
    provenance: EvaluationProvenanceSchema.optional(),
  }),
]);
export type ExitCriterionEvaluation = z.infer<typeof ExitCriterionEvaluationSchema>;
/** Fresh predicate evidence is complete; converted history uses the canonical schema above. */
export const ExitCriterionEmissionSchema = ExitCriterionEvaluationSchema.superRefine(
  (evidence, ctx) => {
    if (!('answer' in evidence)) {
      if ('holds' in evidence && evidence.holds === null)
        ctx.addIssue({
          code: 'custom',
          path: ['holds'],
          message: 'fresh criterion evidence requires a boolean',
        });
      return;
    }
    const fresh = DecisionEmissionSchema.safeParse({
      answer: evidence.answer,
      provenance: evidence.provenance,
      portId: evidence.answer.type === 'choice' ? evidence.answer.optionId : 'answer',
      diagnostics: [],
    });
    if (!fresh.success) for (const issue of fresh.error.issues) ctx.addIssue({ ...issue });
    if (evidence.acceptance === null)
      ctx.addIssue({
        code: 'custom',
        path: ['acceptance'],
        message: 'fresh evidence requires acceptance',
      });
    if (evidence.provenance.kind !== evidence.strategy)
      ctx.addIssue({
        code: 'custom',
        path: ['strategy'],
        message: 'evidence strategy must match provenance',
      });
    if (evidence.status === 'matched' && evidence.rejection)
      ctx.addIssue({
        code: 'custom',
        path: ['rejection'],
        message: 'a rejected predicate cannot match',
      });
    if (evidence.status === 'matched' && evidence.acceptance?.status === 'rejected')
      ctx.addIssue({
        code: 'custom',
        path: ['acceptance'],
        message: 'a rejected evaluation cannot match',
      });
  },
);

export const ExitEvaluationOutcomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('completed'),
    outcome: OutcomeSchema,
    reason: z.enum(['criterion-matched', 'default-success']),
    criterionIndex: z.number().int().min(0).max(31).optional(),
  }),
  z.strictObject({
    kind: z.literal('looped-back'),
    reason: z.literal('no-criterion-matched'),
    targetNodeId: SlugSchema,
  }),
  z.strictObject({
    kind: z.literal('limit-reached'),
    limit: z.enum(['max-iterations', 'max-duration', 'iteration-ceiling']),
    value: z.number().positive(),
    criterionIndex: z.number().int().min(0).max(31).optional(),
    outcome: z.literal('exhausted'),
  }),
  z.strictObject({ kind: z.literal('failed'), diagnostic: ExitDiagnosticSchema }),
  z.strictObject({ kind: z.literal('cancelled') }),
]);
export type ExitEvaluationOutcome = z.infer<typeof ExitEvaluationOutcomeSchema>;
export const PROGRESS_SUMMARY_MAX = 2000;
export const COMMAND_PREVIEW_MAX = 160;
export const SCRIPT_PROGRESS_STDERR_MAX = 2000;

export const ProgressItemStatusSchema = z.enum(['ok', 'failed', 'running']);
const ProgressItemCommon = {
  id: z.string().min(1).max(256),
  summary: z.string().max(PROGRESS_SUMMARY_MAX),
};
const ProgressItemStatusField = { status: ProgressItemStatusSchema.optional() };

/** Safe item projection used by inference progress events; provider detail never belongs here. */
export const ProgressItemSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...ProgressItemCommon,
    type: z.literal('command'),
    commandPreview: z.string().max(COMMAND_PREVIEW_MAX).optional(),
    exitCode: z.number().int().optional(),
    status: ProgressItemStatusSchema,
  }),
  z.strictObject({ ...ProgressItemCommon, type: z.literal('message'), ...ProgressItemStatusField }),
  z.strictObject({
    ...ProgressItemCommon,
    type: z.literal('reasoning'),
    ...ProgressItemStatusField,
  }),
  z.strictObject({
    ...ProgressItemCommon,
    type: z.literal('file-change'),
    ...ProgressItemStatusField,
  }),
  z.strictObject({
    ...ProgressItemCommon,
    type: z.literal('tool-call'),
    ...ProgressItemStatusField,
  }),
  z.strictObject({ ...ProgressItemCommon, type: z.literal('search'), ...ProgressItemStatusField }),
  z.strictObject({ ...ProgressItemCommon, type: z.literal('error'), ...ProgressItemStatusField }),
  z.strictObject({ ...ProgressItemCommon, type: z.literal('other'), ...ProgressItemStatusField }),
]);

export const InferenceProgressSchema = z.strictObject({ item: ProgressItemSchema });
export const ScriptProgressSchema = z.strictObject({
  exitCode: z.number().int(),
  stderr: z.string().max(SCRIPT_PROGRESS_STDERR_MAX),
  stdoutBytes: z.number().int().nonnegative(),
});
export const NodeProgressSchema = z.union([InferenceProgressSchema, ScriptProgressSchema]);
export type ProgressItemStatus = z.infer<typeof ProgressItemStatusSchema>;
export type ProgressItem = z.infer<typeof ProgressItemSchema>;
export type NodeProgress = z.infer<typeof NodeProgressSchema>;

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
    /**
     * The published version each `latest` subloop reference resolved to when the run was created,
     * by loop id, covering every loop reachable through subloop references. Every child the run
     * starts uses these, so a version published mid-run never reaches it (docs/03).
     */
    subloopVersions: z.record(UlidSchema, UlidSchema).optional(),
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
    progress: NodeProgressSchema,
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
  DecisionEvidenceSchema.safeExtend({
    ...Base,
    type: z.literal('decision.made'),
    nodeId: SlugSchema,
  }),
  z.strictObject({
    ...Base,
    type: z.literal('exit.evaluated'),
    nodeId: SlugSchema,
    iteration: z.number().int().positive(),
    maxIterations: z.number().int().positive(),
    criteria: z.array(ExitCriterionEvaluationSchema).max(32),
    result: ExitEvaluationOutcomeSchema,
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
