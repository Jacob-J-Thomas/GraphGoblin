import { z } from 'zod';
import {
  EffortSchema,
  ExpressionSchema,
  HarnessIdSchema,
  JsonSchemaSchema,
  RepairPolicySchema,
  SlugSchema,
  TemplateSchema,
  TimestampSchema,
  UlidSchema,
} from './common.js';
import {
  CollectionSelectionSchema,
  InjectedMessageSchema,
  MessageSelectionSchema,
  MutationListSchema,
} from './mutations.js';
import { ReturnChannelSchema } from './thread.js';

export const NodeKindSchema = z.enum([
  'trigger',
  'decision',
  'inference',
  'script',
  'mutate',
  'subloop',
  'wait',
  'heartbeat',
  'exit',
]);
export type NodeKind = z.infer<typeof NodeKindSchema>;

/** Which surfaces may start or wake a node. */
export const ExposeToSchema = z
  .array(z.enum(['ui', 'api', 'mcp']))
  .min(1)
  .default(['ui', 'api', 'mcp']);

const RouteLabelSchema = SlugSchema.refine((s) => s !== 'in', 'a route may not be named "in"');

// ---------------------------------------------------------------------------
// Probe: shared by heartbeat nodes and poll triggers.
// ---------------------------------------------------------------------------

export const ProbeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('http'),
    method: z.enum(['GET', 'POST', 'HEAD']).default('GET'),
    url: TemplateSchema,
    headers: z.record(z.string(), TemplateSchema).optional(),
    body: TemplateSchema.optional(),
    timeoutSeconds: z.number().int().positive().max(300).default(30),
  }),
  z.strictObject({
    kind: z.literal('script'),
    command: z.string().min(1),
    args: z.array(TemplateSchema).default([]),
    timeoutSeconds: z.number().int().positive().max(3600).default(60),
  }),
  z.strictObject({ kind: z.literal('signal-count'), name: SlugSchema }),
  z.strictObject({ kind: z.literal('none') }),
]);
export type Probe = z.infer<typeof ProbeSchema>;

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

export const TriggerConfigSchema = z.discriminatedUnion('subtype', [
  z.strictObject({
    subtype: z.literal('manual'),
    inputSchema: JsonSchemaSchema.optional(),
    exposeTo: ExposeToSchema,
  }),
  z.strictObject({
    subtype: z.literal('cron'),
    expression: z.string().min(1).max(256),
    timezone: z.string().min(1).max(64).default('UTC'),
    missedFirePolicy: z.enum(['skip', 'run-once', 'run-each']).default('skip'),
    enabled: z.boolean().default(true),
  }),
  z.strictObject({
    subtype: z.literal('webhook'),
    signature: z.strictObject({
      scheme: z.literal('hmac-sha256'),
      header: z.string().min(1).max(128).default('x-graphgoblin-signature'),
      secretRef: z.string().min(1).max(128),
    }),
    replayWindowSeconds: z.number().int().positive().max(86_400).default(300),
    dedupeKey: ExpressionSchema.optional(),
    filter: ExpressionSchema.optional(),
  }),
  z.strictObject({
    subtype: z.literal('event'),
    eventType: SlugSchema,
    filter: ExpressionSchema.optional(),
    dedupeKey: ExpressionSchema.optional(),
  }),
  z.strictObject({
    subtype: z.literal('poll'),
    intervalSeconds: z.number().int().min(5).max(86_400),
    probe: ProbeSchema,
    fireWhen: ExpressionSchema,
    dedupeKey: ExpressionSchema.optional(),
    enabled: z.boolean().default(true),
  }),
]);
export type TriggerConfig = z.infer<typeof TriggerConfigSchema>;

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export const DecisionStrategySchema = z.enum(['jev', 'codex', 'expression']);
export type DecisionStrategy = z.infer<typeof DecisionStrategySchema>;

export const DecisionConfigSchema = z
  .strictObject({
    routes: z
      .array(z.strictObject({ label: RouteLabelSchema, description: z.string().max(2000) }))
      .min(2)
      .max(64),
    question: TemplateSchema,
    context: z
      .strictObject({
        messages: MessageSelectionSchema.default('last'),
        vars: z.array(SlugSchema).optional(),
        includeLastOutput: z.boolean().default(true),
      })
      .prefault({}),
    strategy: z.array(DecisionStrategySchema).min(1).max(3),
    jev: z
      .strictObject({
        primitive: z.literal('choice').default('choice'),
        minConfidence: z.number().min(0).max(1).optional(),
      })
      .optional(),
    codex: z
      .strictObject({ model: z.string().min(1).optional(), effort: EffortSchema.optional() })
      .optional(),
    expression: z.strictObject({ jsonata: ExpressionSchema }).optional(),
    recordAlternatives: z.boolean().default(true),
  })
  .superRefine((cfg, ctx) => {
    const labels = cfg.routes.map((r) => r.label);
    if (new Set(labels).size !== labels.length) {
      ctx.addIssue({ code: 'custom', message: 'route labels must be unique', path: ['routes'] });
    }
    if (new Set(cfg.strategy).size !== cfg.strategy.length) {
      ctx.addIssue({ code: 'custom', message: 'strategies must be unique', path: ['strategy'] });
    }
    if (cfg.strategy.includes('expression') && !cfg.expression) {
      ctx.addIssue({
        code: 'custom',
        message: 'expression strategy requires an expression block',
        path: ['expression'],
      });
    }
  });
export type DecisionConfig = z.infer<typeof DecisionConfigSchema>;

// ---------------------------------------------------------------------------
// Inference
// ---------------------------------------------------------------------------

export const SessionPolicySchema = z.discriminatedUnion('policy', [
  z.strictObject({ policy: z.literal('fresh') }),
  z.strictObject({ policy: z.literal('resume-previous') }),
  z.strictObject({ policy: z.literal('resume-named'), key: SlugSchema }),
]);
export type SessionPolicy = z.infer<typeof SessionPolicySchema>;

export const HarnessOptionsSchema = z.strictObject({
  sandbox: z
    .enum(['read-only', 'workspace-write', 'danger-full-access'])
    .default('workspace-write'),
  approval: z.enum(['never', 'on-request']).default('never'),
  networkAccess: z.boolean().optional(),
  webSearch: z.boolean().optional(),
  configOverrides: z.record(z.string(), z.unknown()).optional(),
});
export type HarnessOptions = z.infer<typeof HarnessOptionsSchema>;

export const CapabilitiesSchema = z.strictObject({
  mcpServers: z.array(SlugSchema).optional(),
  plugins: z.array(SlugSchema).optional(),
  skills: z.array(SlugSchema).optional(),
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

export const InferenceConfigSchema = z.strictObject({
  harness: HarnessIdSchema.default('codex'),
  model: z.string().min(1).optional(),
  effort: EffortSchema.optional(),
  session: SessionPolicySchema.default({ policy: 'fresh' }),
  prompt: z.strictObject({ template: TemplateSchema }),
  input: MutationListSchema.default([]),
  contextFiles: z
    .array(z.strictObject({ path: z.string().min(1).max(1024), template: TemplateSchema }))
    .max(32)
    .optional(),
  harnessOptions: HarnessOptionsSchema.prefault({}),
  capabilities: CapabilitiesSchema.optional(),
  output: z
    .strictObject({
      captureTranscript: z.enum(['artifact', 'none']).default('artifact'),
      toMessages: z.enum(['final', 'final-and-notes', 'none']).default('final'),
      transforms: MutationListSchema.default([]),
      schema: z
        .strictObject({
          jsonSchema: JsonSchemaSchema,
          native: z.boolean().default(true),
          repair: RepairPolicySchema.prefault({}),
        })
        .optional(),
    })
    .prefault({}),
  timeoutSeconds: z.number().int().positive().max(86_400).optional(),
});
export type InferenceConfig = z.infer<typeof InferenceConfigSchema>;

// ---------------------------------------------------------------------------
// Script
// ---------------------------------------------------------------------------

export const ScriptConfigSchema = z
  .strictObject({
    command: z.string().min(1).max(4096),
    args: z.array(TemplateSchema).max(256).default([]),
    cwd: z.string().min(1).max(4096).default('workspace'),
    env: z.record(z.string(), z.string().max(8192)).optional(),
    stdin: z.enum(['thread', 'last-output', 'none']).default('thread'),
    stdout: z.enum(['patch', 'last-output', 'ignore']).default('last-output'),
    exitCodeRoutes: z.record(z.string().regex(/^\d{1,3}$/), RouteLabelSchema).optional(),
    timeoutSeconds: z.number().int().positive().max(86_400).optional(),
  })
  .superRefine((cfg, ctx) => {
    const labels = Object.values(cfg.exitCodeRoutes ?? {});
    if (labels.includes('out')) {
      // allowed: mapping a code explicitly to the default port
      return;
    }
    if (new Set(labels).size !== labels.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'exit code routes should map to distinct labels',
        path: ['exitCodeRoutes'],
      });
    }
  });
export type ScriptConfig = z.infer<typeof ScriptConfigSchema>;

// ---------------------------------------------------------------------------
// Mutate
// ---------------------------------------------------------------------------

export const MutateConfigSchema = z.strictObject({
  operations: MutationListSchema.min(1),
});
export type MutateConfig = z.infer<typeof MutateConfigSchema>;

// ---------------------------------------------------------------------------
// Subloop
// ---------------------------------------------------------------------------

export const SubloopInputMappingSchema = z.strictObject({
  mode: z.enum(['inherit', 'project', 'fresh']).default('inherit'),
  exclude: z.array(z.enum(['messages', 'artifacts', 'vars', 'lastOutput', 'outputs'])).optional(),
  vars: z.record(SlugSchema, ExpressionSchema).optional(),
  messages: MessageSelectionSchema.optional(),
  artifacts: CollectionSelectionSchema.optional(),
  inject: z.array(InjectedMessageSchema).max(64).optional(),
  trigger: z.strictObject({ payload: ExpressionSchema }).optional(),
});
export type SubloopInputMapping = z.infer<typeof SubloopInputMappingSchema>;

export const SubloopOutputMappingSchema = z.strictObject({
  mode: z.enum(['result-only', 'merge', 'custom']).default('result-only'),
  resultTo: z
    .strictObject({ lastOutput: z.boolean().default(true), var: SlugSchema.optional() })
    .prefault({}),
  vars: z
    .strictObject({
      strategy: z.enum(['child-wins', 'parent-wins', 'explicit']).default('child-wins'),
      map: z.record(SlugSchema, ExpressionSchema).optional(),
    })
    .optional(),
  messages: MessageSelectionSchema.optional(),
  artifacts: CollectionSelectionSchema.optional(),
  custom: z.strictObject({ patch: ExpressionSchema }).optional(),
  usage: z.enum(['roll-up', 'separate']).default('roll-up'),
});
export type SubloopOutputMapping = z.infer<typeof SubloopOutputMappingSchema>;

export const SubloopConfigSchema = z.strictObject({
  loopRef: z.strictObject({
    loopId: UlidSchema,
    version: z.union([z.literal('latest'), z.number().int().positive()]).default('latest'),
  }),
  input: SubloopInputMappingSchema.prefault({}),
  output: SubloopOutputMappingSchema.prefault({}),
  depthLimitOverride: z.number().int().positive().max(64).optional(),
});
export type SubloopConfig = z.infer<typeof SubloopConfigSchema>;

// ---------------------------------------------------------------------------
// Wait
// ---------------------------------------------------------------------------

const WaitCommon = {
  timeoutSeconds: z.number().int().positive().max(31_536_000).optional(),
  onTimeout: z.enum(['continue', 'fail-run']).default('continue'),
};

export const WaitConfigSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('input'),
    prompt: TemplateSchema,
    inputSchema: JsonSchemaSchema.optional(),
    exposeTo: ExposeToSchema,
    ...WaitCommon,
  }),
  z.strictObject({
    mode: z.literal('duration'),
    seconds: z.number().int().positive().max(31_536_000),
    ...WaitCommon,
  }),
  z.strictObject({
    mode: z.literal('until'),
    timestamp: TemplateSchema,
    ...WaitCommon,
  }),
  z.strictObject({
    mode: z.literal('signal'),
    name: SlugSchema,
    filter: ExpressionSchema.optional(),
    ...WaitCommon,
  }),
]);
export type WaitConfig = z.infer<typeof WaitConfigSchema>;

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

export const HeartbeatConfigSchema = z
  .strictObject({
    intervalSeconds: z.number().int().min(1).max(86_400),
    probe: ProbeSchema.default({ kind: 'none' }),
    until: ExpressionSchema.optional(),
    maxBeats: z.number().int().positive().max(100_000).optional(),
    deadline: TemplateSchema.optional(),
    onExhausted: z.enum(['continue', 'fail-run']).default('continue'),
    record: z.enum(['summary', 'full']).default('summary'),
  })
  .refine(
    (c) => c.until !== undefined || c.maxBeats !== undefined || c.deadline !== undefined,
    'heartbeat needs at least one of until, maxBeats, or deadline',
  );
export type HeartbeatConfig = z.infer<typeof HeartbeatConfigSchema>;

// ---------------------------------------------------------------------------
// Exit
// ---------------------------------------------------------------------------

export const OutcomeSchema = z.enum(['success', 'failure', 'exhausted']);
export type Outcome = z.infer<typeof OutcomeSchema>;

export const ExitCriterionSchema = z.discriminatedUnion('when', [
  z.strictObject({
    when: z.literal('max-iterations'),
    value: z.number().int().positive(),
    outcome: z.literal('exhausted').default('exhausted'),
  }),
  z.strictObject({
    when: z.literal('max-duration'),
    seconds: z.number().int().positive(),
    outcome: z.literal('exhausted').default('exhausted'),
  }),
  z.strictObject({
    when: z.literal('predicate'),
    strategy: DecisionStrategySchema,
    question: TemplateSchema.optional(),
    jsonata: ExpressionSchema.optional(),
    minConfidence: z.number().min(0).max(1).optional(),
    outcome: z.enum(['success', 'failure']),
  }),
  z.strictObject({
    when: z.literal('last-output-matches'),
    jsonSchema: JsonSchemaSchema,
    outcome: z.literal('success').default('success'),
  }),
]);
export type ExitCriterion = z.infer<typeof ExitCriterionSchema>;

export const ExitConfigSchema = z
  .strictObject({
    criteria: z.array(ExitCriterionSchema).max(32).default([]),
    default: z.enum(['success', 'loop-back']).default('success'),
    loopBack: z.strictObject({ targetNodeId: SlugSchema }).optional(),
    return: z
      .strictObject({
        mapping: z.union([z.literal('none'), ExpressionSchema]).default('none'),
        channels: z
          .array(ReturnChannelSchema)
          .max(16)
          .default([{ kind: 'caller' }]),
      })
      .prefault({}),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.default === 'loop-back' && !cfg.loopBack) {
      ctx.addIssue({
        code: 'custom',
        message: 'default "loop-back" requires a loopBack target',
        path: ['loopBack'],
      });
    }
    for (const [i, c] of cfg.criteria.entries()) {
      if (c.when === 'predicate') {
        if (c.strategy === 'expression' && !c.jsonata) {
          ctx.addIssue({
            code: 'custom',
            message: 'expression predicate requires jsonata',
            path: ['criteria', i, 'jsonata'],
          });
        }
        if (c.strategy !== 'expression' && !c.question) {
          ctx.addIssue({
            code: 'custom',
            message: `${c.strategy} predicate requires a question`,
            path: ['criteria', i, 'question'],
          });
        }
      }
    }
  });
export type ExitConfig = z.infer<typeof ExitConfigSchema>;

// ---------------------------------------------------------------------------
// Node envelope
// ---------------------------------------------------------------------------

const NodeBase = {
  id: SlugSchema,
  label: z.string().min(1).max(120),
  ui: z.strictObject({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
};

export const NodeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...NodeBase, kind: z.literal('trigger'), config: TriggerConfigSchema }),
  z.strictObject({ ...NodeBase, kind: z.literal('decision'), config: DecisionConfigSchema }),
  z.strictObject({ ...NodeBase, kind: z.literal('inference'), config: InferenceConfigSchema }),
  z.strictObject({ ...NodeBase, kind: z.literal('script'), config: ScriptConfigSchema }),
  z.strictObject({ ...NodeBase, kind: z.literal('mutate'), config: MutateConfigSchema }),
  z.strictObject({ ...NodeBase, kind: z.literal('subloop'), config: SubloopConfigSchema }),
  z.strictObject({ ...NodeBase, kind: z.literal('wait'), config: WaitConfigSchema }),
  z.strictObject({ ...NodeBase, kind: z.literal('heartbeat'), config: HeartbeatConfigSchema }),
  z.strictObject({ ...NodeBase, kind: z.literal('exit'), config: ExitConfigSchema }),
]);
export type Node = z.infer<typeof NodeSchema>;
export type NodeInput = z.input<typeof NodeSchema>;
export type NodeOfKind<K extends NodeKind> = Extract<Node, { kind: K }>;

/** Zod schema for each node kind's config, keyed by kind. Used by editors and validators. */
export const NodeConfigSchemas = {
  trigger: TriggerConfigSchema,
  decision: DecisionConfigSchema,
  inference: InferenceConfigSchema,
  script: ScriptConfigSchema,
  mutate: MutateConfigSchema,
  subloop: SubloopConfigSchema,
  wait: WaitConfigSchema,
  heartbeat: HeartbeatConfigSchema,
  exit: ExitConfigSchema,
} as const;

/** Unused in schemas but exported for completeness of the wait spec vocabulary. */
export const WaitKindSchema = z.enum(['input', 'timer', 'signal', 'heartbeat', 'child']);
export type WaitKind = z.infer<typeof WaitKindSchema>;

export const TimestampLike = TimestampSchema;
