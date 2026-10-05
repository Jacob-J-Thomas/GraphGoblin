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
import { field } from './meta.js';
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

const DedupeKeySchema = ExpressionSchema.optional().meta(
  field('JSONata producing a key; a repeated key does not start another run.'),
);
const PayloadFilterSchema = ExpressionSchema.optional().meta(
  field('JSONata predicate; payloads that fail it are recorded and ignored.'),
);

export const TriggerConfigSchema = z.discriminatedUnion('subtype', [
  z.strictObject({
    subtype: z.literal('manual'),
    inputSchema: JsonSchemaSchema.optional().meta(
      field('JSON Schema the manual input must satisfy.'),
    ),
    exposeTo: ExposeToSchema.meta(
      field('Surfaces that may start the run: the web app, the REST API, MCP.'),
    ),
  }),
  z.strictObject({
    subtype: z.literal('cron'),
    expression: z.string().min(1).max(256).meta(field('Cron expression, five or six fields.')),
    timezone: z
      .string()
      .min(1)
      .max(64)
      .default('UTC')
      .meta(field('IANA time zone the expression is evaluated in.')),
    missedFirePolicy: z
      .enum(['skip', 'run-once', 'run-each'])
      .default('skip')
      .meta(field('What to do with fires missed while the server was down.')),
    enabled: z.boolean().default(true).meta(field('Whether the schedule is armed.')),
  }),
  z.strictObject({
    subtype: z.literal('webhook'),
    signature: z
      .strictObject({
        scheme: z.literal('hmac-sha256'),
        header: z.string().min(1).max(128).default('x-graphgoblin-signature'),
        secretRef: z.string().min(1).max(128),
      })
      .meta(
        field(
          'HMAC signing: scheme, the header carrying the signature, and the secret holding the key.',
        ),
      ),
    replayWindowSeconds: z
      .number()
      .int()
      .positive()
      .max(86_400)
      .default(300)
      .meta(field('How far the signed timestamp may be from the server clock.')),
    dedupeKey: DedupeKeySchema,
    filter: PayloadFilterSchema,
  }),
  z.strictObject({
    subtype: z.literal('event'),
    eventType: SlugSchema.meta(field('Inbound event type that fires the trigger.')),
    filter: PayloadFilterSchema,
    dedupeKey: DedupeKeySchema,
  }),
  z.strictObject({
    subtype: z.literal('poll'),
    intervalSeconds: z.number().int().min(5).max(86_400).meta(field('Seconds between probes.')),
    probe: ProbeSchema.meta(
      field('What to call on each poll: HTTP, a script, a signal count, or nothing.'),
    ),
    fireWhen: ExpressionSchema.meta(
      field('JSONata over the probe result; a run starts when it is true.'),
    ),
    dedupeKey: DedupeKeySchema,
    enabled: z.boolean().default(true).meta(field('Whether the poller is armed.')),
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
      .max(64)
      .meta(field('At least two labelled routes, each with a description the decider reads.')),
    question: TemplateSchema.meta(
      field('Liquid template rendered against the thread; the question the decider answers.'),
    ),
    context: z
      .strictObject({
        messages: MessageSelectionSchema.default('last').meta(
          field('Which messages the decider reads: none, the last, a number of them, or all.', {
            advanced: true,
          }),
        ),
        vars: z
          .array(SlugSchema)
          .optional()
          .meta(field('Variables the decider reads.', { advanced: true })),
        includeLastOutput: z
          .boolean()
          .default(true)
          .meta(field('Show the decider the last output.', { advanced: true })),
      })
      .prefault({})
      .meta(
        field('How much of the thread the decider sees: messages, vars, the last output.', {
          advanced: true,
          group: 'Context',
        }),
      ),
    strategy: z
      .array(DecisionStrategySchema)
      .min(1)
      .max(3)
      .meta(field('Ordered fallback chain of strategies.')),
    jev: z
      .strictObject({
        primitive: z.literal('choice').default('choice'),
        minConfidence: z.number().min(0).max(1).optional(),
      })
      .optional()
      .meta(
        field('Jev options; a choice below `minConfidence` falls through to the next strategy.'),
      ),
    codex: z
      .strictObject({ model: z.string().min(1).optional(), effort: EffortSchema.optional() })
      .optional()
      .meta(field('Model and effort for the Codex decider.')),
    expression: z
      .strictObject({ jsonata: ExpressionSchema })
      .optional()
      .meta(field('JSONata that must evaluate to a route label.')),
    recordAlternatives: z
      .boolean()
      .default(true)
      .meta(
        field('Record the routes not taken, with confidences, on `decision.made`.', {
          advanced: true,
          group: 'Recording',
        }),
      ),
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
    .default('workspace-write')
    .meta(field('What the session may change: nothing, the working directory, or anything.')),
  approval: z
    .enum(['never', 'on-request'])
    .default('never')
    .meta(field('Whether the harness may stop to ask before acting.', { advanced: true })),
  networkAccess: z
    .boolean()
    .optional()
    .meta(field('Let commands in the sandbox reach the network.', { advanced: true })),
  webSearch: z
    .boolean()
    .optional()
    .meta(field('Let the model search the web.', { advanced: true })),
  configOverrides: z
    .record(z.string(), z.unknown())
    .optional()
    .meta(field('Raw harness configuration, passed through as is.', { advanced: true })),
});
export type HarnessOptions = z.infer<typeof HarnessOptionsSchema>;

export const CapabilitiesSchema = z.strictObject({
  mcpServers: z.array(SlugSchema).optional(),
  plugins: z.array(SlugSchema).optional(),
  skills: z.array(SlugSchema).optional(),
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

export const InferenceConfigSchema = z.strictObject({
  harness: HarnessIdSchema.default('codex').meta(field('Harness that runs the session.')),
  model: z
    .string()
    .min(1)
    .optional()
    .meta(
      field('Model; falls back to the loop default, then to the owner setting.', {
        control: 'model',
      }),
    ),
  effort: EffortSchema.optional().meta(field('Reasoning effort; falls back like the model.')),
  session: SessionPolicySchema.default({ policy: 'fresh' }).meta(
    field('Start fresh, resume the previous session, or resume a named session.'),
  ),
  prompt: z
    .strictObject({ template: TemplateSchema })
    .meta(field('Liquid template rendered against the thread.')),
  input: MutationListSchema.default([]).meta(
    field('Mutations applied to the thread view the template sees.', {
      advanced: true,
      group: 'Context',
    }),
  ),
  contextFiles: z
    .array(z.strictObject({ path: z.string().min(1).max(1024), template: TemplateSchema }))
    .max(32)
    .optional()
    .meta(
      field('Files written under the working directory before the session starts.', {
        advanced: true,
        group: 'Context',
      }),
    ),
  harnessOptions: HarnessOptionsSchema.prefault({}).meta(
    field('Sandbox, approval, network, web search, and raw config overrides.', {
      group: 'Harness options',
    }),
  ),
  capabilities: CapabilitiesSchema.optional().meta(
    field('MCP servers, plugins, and skills, resolved by the adapter.', {
      advanced: true,
      group: 'Harness options',
    }),
  ),
  output: z
    .strictObject({
      captureTranscript: z
        .enum(['artifact', 'none'])
        .default('artifact')
        .meta(field('Keep the session transcript as an artifact, or not.', { advanced: true })),
      toMessages: z
        .enum(['final', 'final-and-notes', 'none'])
        .default('final')
        .meta(field("What the answer adds to the thread's messages.", { advanced: true })),
      transforms: MutationListSchema.default([]).meta(
        field('Mutations applied to the answer before it lands.', { advanced: true }),
      ),
      schema: z
        .strictObject({
          jsonSchema: JsonSchemaSchema,
          native: z.boolean().default(true),
          repair: RepairPolicySchema.prefault({}),
        })
        .optional()
        .meta(
          field('JSON Schema the answer must satisfy, with repair turns when it does not.', {
            advanced: true,
          }),
        ),
    })
    .prefault({})
    .meta(
      field(
        'Transcript capture, how the answer lands in messages, transforms, and an optional output schema with repair.',
        { advanced: true, group: 'Output' },
      ),
    ),
  timeoutSeconds: z
    .number()
    .int()
    .positive()
    .max(86_400)
    .optional()
    .meta(
      field('Optional watchdog; a timeout fails the run.', { advanced: true, group: 'Limits' }),
    ),
});
export type InferenceConfig = z.infer<typeof InferenceConfigSchema>;

// ---------------------------------------------------------------------------
// Script
// ---------------------------------------------------------------------------

export const ScriptConfigSchema = z
  .strictObject({
    command: z.string().min(1).max(4096).meta(field('Program to run.')),
    args: z
      .array(TemplateSchema)
      .max(256)
      .default([])
      .meta(field('Arguments; each may be a Liquid template.')),
    cwd: z
      .string()
      .min(1)
      .max(4096)
      .default('workspace')
      .meta(field('`workspace` for the run working directory, or a path.')),
    env: z
      .record(z.string(), z.string().max(8192))
      .optional()
      .meta(
        field('Extra environment; values may be `secret:<name>`.', {
          advanced: true,
          group: 'Process',
        }),
      ),
    stdin: z
      .enum(['thread', 'last-output', 'none'])
      .default('thread')
      .meta(
        field('What the program reads on standard input.', {
          advanced: true,
          group: 'Input and output',
        }),
      ),
    stdout: z
      .enum(['patch', 'last-output', 'ignore'])
      .default('last-output')
      .meta(
        field('How standard output is used: a JSON Patch, the last output, or ignored.', {
          advanced: true,
          group: 'Input and output',
        }),
      ),
    exitCodeRoutes: z
      .record(z.string().regex(/^\d{1,3}$/), RouteLabelSchema)
      .optional()
      .meta(
        field('Exit code to route label; an unmapped non-zero code fails the run.', {
          advanced: true,
          group: 'Input and output',
        }),
      ),
    timeoutSeconds: z
      .number()
      .int()
      .positive()
      .max(86_400)
      .optional()
      .meta(
        field('Optional watchdog; a timeout fails the run.', { advanced: true, group: 'Process' }),
      ),
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
  operations: MutationListSchema.min(1).meta(
    field(
      'Operations applied in order: set, delete, append-message, inject, truncate, drop, replace, redact, coerce.',
    ),
  ),
});
export type MutateConfig = z.infer<typeof MutateConfigSchema>;

// ---------------------------------------------------------------------------
// Subloop
// ---------------------------------------------------------------------------

export const SubloopInputMappingSchema = z.strictObject({
  mode: z
    .enum(['inherit', 'project', 'fresh'])
    .default('inherit')
    .meta(
      field("Inherit the parent's thread, project parts of it, or start the child fresh.", {
        title: 'Input mode',
      }),
    ),
  exclude: z
    .array(z.enum(['messages', 'artifacts', 'vars', 'lastOutput', 'outputs']))
    .optional()
    .meta(field("Parts of the parent's thread the child does not inherit.", { advanced: true })),
  vars: z
    .record(SlugSchema, ExpressionSchema)
    .optional()
    .meta(field("Child variables, each a JSONata over the parent's thread.", { advanced: true })),
  messages: MessageSelectionSchema.optional().meta(
    field("Which of the parent's messages the child gets.", { advanced: true }),
  ),
  artifacts: CollectionSelectionSchema.optional().meta(
    field("Which of the parent's artifacts the child gets.", { advanced: true }),
  ),
  inject: z
    .array(InjectedMessageSchema)
    .max(64)
    .optional()
    .meta(field("Messages added to the child's thread.", { advanced: true })),
  trigger: z
    .strictObject({ payload: ExpressionSchema })
    .optional()
    .meta(field("JSONata building the child's trigger payload.", { advanced: true })),
});
export type SubloopInputMapping = z.infer<typeof SubloopInputMappingSchema>;

export const SubloopOutputMappingSchema = z.strictObject({
  mode: z
    .enum(['result-only', 'merge', 'custom'])
    .default('result-only')
    .meta(
      field("Return only the child's result, merge its thread, or apply a custom patch.", {
        title: 'Output mode',
      }),
    ),
  resultTo: z
    .strictObject({ lastOutput: z.boolean().default(true), var: SlugSchema.optional() })
    .prefault({})
    .meta(
      field("Where the child's return payload lands: the last output, a variable, or both.", {
        advanced: true,
      }),
    ),
  vars: z
    .strictObject({
      strategy: z.enum(['child-wins', 'parent-wins', 'explicit']).default('child-wins'),
      map: z.record(SlugSchema, ExpressionSchema).optional(),
    })
    .optional()
    .meta(field("How the child's variables merge into the parent's.", { advanced: true })),
  messages: MessageSelectionSchema.optional().meta(
    field("Which of the child's messages the parent gets.", { advanced: true }),
  ),
  artifacts: CollectionSelectionSchema.optional().meta(
    field("Which of the child's artifacts the parent gets.", { advanced: true }),
  ),
  custom: z
    .strictObject({ patch: ExpressionSchema })
    .optional()
    .meta(field('JSONata producing a JSON Patch for the parent thread.', { advanced: true })),
  usage: z
    .enum(['roll-up', 'separate'])
    .default('roll-up')
    .meta(
      field("Add the child's token usage to the parent's, or keep it separate.", {
        advanced: true,
      }),
    ),
});
export type SubloopOutputMapping = z.infer<typeof SubloopOutputMappingSchema>;

export const SubloopConfigSchema = z.strictObject({
  loopRef: z
    .strictObject({
      loopId: UlidSchema,
      version: z.union([z.literal('latest'), z.number().int().positive()]).default('latest'),
    })
    .meta(field('The child loop and the version to pin (`latest` or a number).')),
  input: SubloopInputMappingSchema.prefault({}).meta(
    field('How the child thread is built from the parent: inherit, project, or fresh.', {
      group: 'Input mapping',
    }),
  ),
  output: SubloopOutputMappingSchema.prefault({}).meta(
    field('How the child result flows back into the parent thread.', {
      group: 'Output mapping',
    }),
  ),
  depthLimitOverride: z
    .number()
    .int()
    .positive()
    .max(64)
    .optional()
    .meta(
      field('Raise or lower the nesting limit for this node.', { advanced: true, group: 'Limits' }),
    ),
});
export type SubloopConfig = z.infer<typeof SubloopConfigSchema>;

// ---------------------------------------------------------------------------
// Wait
// ---------------------------------------------------------------------------

const WaitCommon = {
  timeoutSeconds: z
    .number()
    .int()
    .positive()
    .max(31_536_000)
    .optional()
    .meta(field('Give up after this long.')),
  onTimeout: z
    .enum(['continue', 'fail-run'])
    .default('continue')
    .meta(field('Continue with `lastOutput = { timedOut: true }`, or fail the run.')),
};

export const WaitConfigSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('input'),
    prompt: TemplateSchema.meta(field('Liquid template shown to whoever provides the input.')),
    inputSchema: JsonSchemaSchema.optional().meta(field('JSON Schema the input must satisfy.')),
    exposeTo: ExposeToSchema.meta(field('Surfaces that may provide the input.')),
    ...WaitCommon,
  }),
  z.strictObject({
    mode: z.literal('duration'),
    seconds: z.number().int().positive().max(31_536_000).meta(field('How long to wait.')),
    ...WaitCommon,
  }),
  z.strictObject({
    mode: z.literal('until'),
    timestamp: TemplateSchema.meta(
      field('When to resume; Liquid or JSONata producing an ISO timestamp.'),
    ),
    ...WaitCommon,
  }),
  z.strictObject({
    mode: z.literal('signal'),
    name: SlugSchema.meta(field('Signal name to wait for.')),
    filter: ExpressionSchema.optional().meta(field('JSONata predicate over the signal payload.')),
    ...WaitCommon,
  }),
]);
export type WaitConfig = z.infer<typeof WaitConfigSchema>;

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

export const HeartbeatConfigSchema = z
  .strictObject({
    intervalSeconds: z
      .number()
      .int()
      .min(1)
      .max(86_400)
      .meta(field('Seconds between beats; the run is parked in between.')),
    probe: ProbeSchema.default({ kind: 'none' }).meta(
      field('What to do on each beat: HTTP, a script, a signal count, or nothing.'),
    ),
    until: ExpressionSchema.optional().meta(
      field('JSONata over `{ probe, thread, beat }`; stops when true.'),
    ),
    maxBeats: z
      .number()
      .int()
      .positive()
      .max(100_000)
      .optional()
      .meta(field('Stop after this many beats.')),
    deadline: TemplateSchema.optional().meta(field('Stop at this time.')),
    onExhausted: z
      .enum(['continue', 'fail-run'])
      .default('continue')
      .meta(field('Continue with `lastOutput = { exhausted: true }`, or fail the run.')),
    record: z
      .enum(['summary', 'full'])
      .default('summary')
      .meta(field('Record a summary or the full probe result on each `heartbeat.beat`.')),
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
    criteria: z
      .array(ExitCriterionSchema)
      .max(32)
      .default([])
      .meta(field('Evaluated in order; the first that matches decides the outcome.')),
    default: z
      .enum(['success', 'loop-back'])
      .default('success')
      .meta(field('What happens when no criterion matches.')),
    loopBack: z
      .strictObject({ targetNodeId: SlugSchema })
      .optional()
      .meta(field('The node a loop-back returns to.')),
    return: z
      .strictObject({
        mapping: z.union([z.literal('none'), ExpressionSchema]).default('none'),
        channels: z
          .array(ReturnChannelSchema)
          .max(16)
          .default([{ kind: 'caller' }]),
      })
      .prefault({})
      .meta(field('JSONata mapping for the return payload and the channels it is delivered to.')),
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
