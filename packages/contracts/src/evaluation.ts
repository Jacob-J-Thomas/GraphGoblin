import { z } from 'zod';
import { ClassifierModelIdSchema } from './classifiers.js';
import {
  EffortSchema,
  ExpressionSchema,
  HarnessIdSchema,
  ModelNameSchema,
  SlugSchema,
  TemplateSchema,
} from './common.js';
import { field } from './meta.js';
import { MessageSelectionSchema } from './mutations.js';

export const HarnessModelDefaultsSchema = z.strictObject({
  model: ModelNameSchema.optional().meta(field('Default harness model.', { control: 'model' })),
  effort: EffortSchema.optional().meta(field('Default reasoning effort.', { control: 'effort' })),
});
export const HarnessDefaultsSchema = z.strictObject({
  byHarness: z
    .partialRecord(HarnessIdSchema, HarnessModelDefaultsSchema)
    .default({})
    .meta(
      field('Defaults keyed by their harness; omitted fields inherit only within that harness.'),
    ),
});
export type HarnessModelDefaults = z.infer<typeof HarnessModelDefaultsSchema>;
export type HarnessDefaults = z.infer<typeof HarnessDefaultsSchema>;

export const ModelSelectionSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z
      .literal('inherit')
      .meta(
        field(
          'Inherit this value from loop, owner, then process defaults for the selected harness.',
        ),
      ),
  }),
  z.strictObject({
    mode: z
      .literal('explicit')
      .meta(field('Use the explicitly authored value after catalog validation.')),
    value: ModelNameSchema.meta(field('Explicit harness model.', { control: 'model' })),
  }),
]);
export const EffortSelectionSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('inherit').meta(field('Inherit reasoning effort within the selected harness.')),
  }),
  z.strictObject({
    mode: z
      .literal('explicit')
      .meta(field('Use the authored reasoning effort after model-catalog validation.')),
    value: EffortSchema.meta(field('Explicit reasoning effort.', { control: 'effort' })),
  }),
]);
export type ModelSelection = z.infer<typeof ModelSelectionSchema>;
export type EffortSelection = z.infer<typeof EffortSelectionSchema>;

export const LIMIT_REACHED_PORT_ID = 'limit-reached' as const;
export const ChoiceOptionIdSchema = SlugSchema.refine(
  (value) => value !== 'in' && value !== LIMIT_REACHED_PORT_ID,
  'route ids may not be named "in" or "limit-reached"',
);
export const ChoiceOptionSchema = z.strictObject({
  id: ChoiceOptionIdSchema.meta(
    field('Stable provider key and output port; changing display order does not change the route.'),
  ),
  label: z.string().trim().min(1).max(120).meta(field('Unique readable option label.')),
  repeat: z.boolean().optional().meta(field('Mark the one route that repeats through this gate.')),
  criteria: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .meta(field('Authored criterion sent to the selected evaluator.', { multiline: true })),
});
export type ChoiceOption = z.infer<typeof ChoiceOptionSchema>;
export const ChoiceConfigSchema = z
  .strictObject({
    type: z.literal('choice').meta(field('Choose exactly one declared option.')),
    options: z
      .array(ChoiceOptionSchema)
      .min(2)
      .max(64)
      .meta(
        field(
          'Two to sixty-four uniquely labelled options, each with a stable id and a nonblank criterion.',
        ),
      ),
  })
  .superRefine((answer, ctx) => {
    for (const key of ['id', 'label'] as const) {
      const seen = new Set<string>();
      answer.options.forEach((option, index) => {
        if (seen.has(option[key]))
          ctx.addIssue({
            code: 'custom',
            path: ['options', index, key],
            message: `option ${key}s must be unique`,
          });
        seen.add(option[key]);
      });
    }
  });

export type ChoiceConfig = z.infer<typeof ChoiceConfigSchema>;

const NoulSideSchema = ChoiceOptionSchema.omit({ id: true });
const NoulFields = {
  type: z.literal('noul').meta(field('Answer a two-sided boolean question.')),
  true: NoulSideSchema.meta(field('Label and authored criterion for the true side.')),
  false: NoulSideSchema.meta(field('Label and authored criterion for the false side.')),
};
export const NoulSpecSchema = z.strictObject(NoulFields);
export type NoulSpec = z.infer<typeof NoulSpecSchema>;
export const NoulConfigSchema = z
  .strictObject({ ...NoulFields, true: ChoiceOptionSchema, false: ChoiceOptionSchema })
  .superRefine((answer, ctx) => {
    for (const key of ['id', 'label'] as const) {
      if (answer.true[key] === answer.false[key])
        ctx.addIssue({
          code: 'custom',
          path: ['false', key],
          message: `side ${key}s must be unique`,
        });
    }
  });
export type NoulConfig = z.infer<typeof NoulConfigSchema>;

const ScoreFields = {
  type: z.literal('score').meta(field('Return a fractional index on an ordered rubric.')),
  anchors: z
    .array(z.string().trim().min(1).max(2000).meta({ multiline: true }))
    .min(2)
    .meta(field('Ordered nonblank descriptions indexed from zero; no rounding or rescaling.')),
};
export const ScoreSpecSchema = z.strictObject(ScoreFields);
export type ScoreSpec = z.infer<typeof ScoreSpecSchema>;
export const ScoreBandSchema = z.strictObject({
  id: ChoiceOptionIdSchema.meta(field('Stable output port for this score band.')),
  label: z.string().trim().min(1).max(120).meta(field('Unique readable score band label.')),
  repeat: z.boolean().optional().meta(field('Mark the one route that repeats through this gate.')),
  min: z.number().min(0).meta(field('Inclusive lower boundary on the rubric index scale.')),
  max: z.number().min(0).meta(field('Exclusive upper boundary; the rubric endpoint is inclusive.')),
});
export type ScoreBand = z.infer<typeof ScoreBandSchema>;
export const ScoreConfigSchema = z
  .strictObject({
    ...ScoreFields,
    bands: z
      .array(ScoreBandSchema)
      .min(1)
      .max(64)
      .meta(field('Stable bands covering the entire rubric.')),
  })
  .superRefine((answer, ctx) => {
    for (const key of ['id', 'label'] as const) {
      const seen = new Set<string>();
      answer.bands.forEach((band, index) => {
        if (seen.has(band[key]))
          ctx.addIssue({
            code: 'custom',
            path: ['bands', index, key],
            message: `band ${key}s must be unique`,
          });
        seen.add(band[key]);
      });
    }
    const bands = answer.bands
      .map((band, index) => ({ ...band, index }))
      .sort((a, b) => a.min - b.min);
    let boundary = 0;
    const endpoint = answer.anchors.length - 1;
    for (const band of bands) {
      if (band.min !== boundary || band.max <= band.min || band.max > endpoint)
        ctx.addIssue({
          code: 'custom',
          path: ['bands', band.index],
          message: 'bands must form nonempty contiguous intervals over the rubric',
        });
      boundary = band.max;
    }
    if (boundary !== endpoint)
      ctx.addIssue({
        code: 'custom',
        path: ['bands'],
        message: 'bands must cover the full rubric through its final endpoint',
      });
  });
export type ScoreConfig = z.infer<typeof ScoreConfigSchema>;

export const ClassifierAnswerSpecSchema = z.discriminatedUnion('type', [
  ChoiceConfigSchema,
  NoulSpecSchema,
  ScoreSpecSchema,
]);
export type ClassifierAnswerSpec = z.infer<typeof ClassifierAnswerSpecSchema>;
export const ClassifierAnswerConfigSchema = z.discriminatedUnion('type', [
  ChoiceConfigSchema,
  NoulConfigSchema,
  ScoreConfigSchema,
]);
export type ClassifierAnswerConfig = z.infer<typeof ClassifierAnswerConfigSchema>;

export const DecisionContextSchema = z.strictObject({
  messages: MessageSelectionSchema.default('last').meta(
    field('Selected messages; this selector does not restrict question-template exposure.'),
  ),
  vars: z
    .array(SlugSchema.meta({ control: 'variable' }))
    .optional()
    .meta(
      field(
        'Variable names included in provider state; omission includes all variables and does not restrict the question template.',
        { advanced: true, group: 'Provider context' },
      ),
    ),
  includeLastOutput: z
    .boolean()
    .default(true)
    .meta(field('Include the latest output value in provider state when one exists.')),
});
export type DecisionContext = z.infer<typeof DecisionContextSchema>;
export const RouteIdSchema = ChoiceOptionIdSchema;
export type RouteId = z.infer<typeof RouteIdSchema>;
export const RouteDeclarationSchema = z.strictObject({
  id: RouteIdSchema,
  label: z.string().trim().min(1).max(120),
  repeat: z.boolean().optional().meta(field('Mark the one route that repeats through this gate.')),
});
export type RouteDeclaration = z.infer<typeof RouteDeclarationSchema>;
export const RouteDeclarationsSchema = z
  .array(RouteDeclarationSchema)
  .min(2)
  .max(64)
  .superRefine((routes, ctx) => {
    for (const key of ['id', 'label'] as const) {
      const seen = new Set<string>();
      routes.forEach((route, index) => {
        if (seen.has(route[key]))
          ctx.addIssue({
            code: 'custom',
            path: [index, key],
            message: `route ${key}s must be unique`,
          });
        seen.add(route[key]);
      });
    }
  });
const ExpressionSourceSchema = z
  .strictObject({
    kind: z.literal('expression').meta(field('Evaluate JSONata locally.')),
    jsonata: ExpressionSchema.meta(
      field('JSONata source; return a declared route id for decisions.'),
    ),
  })
  .superRefine((config, ctx) => {
    if (!config.jsonata.trim())
      ctx.addIssue({
        code: 'custom',
        path: ['jsonata'],
        message: 'expression must contain source',
      });
  });
type GateConfig = { maxPasses?: number | undefined; maxRunTimeSeconds?: number | undefined } & (
  { routes: RouteDeclaration[] } | { answer: ClassifierAnswerConfig }
);
function gateLimitsIssues(config: GateConfig, ctx: z.RefinementCtx): void {
  const routes =
    'routes' in config
      ? config.routes
      : config.answer.type === 'choice'
        ? config.answer.options
        : config.answer.type === 'noul'
          ? [config.answer.true, config.answer.false]
          : config.answer.bands;
  const repeats = routes.filter((route) => route.repeat);
  if (repeats.length > 1) {
    let seen = false;
    routes.forEach((route, index) => {
      if (!route.repeat) return;
      const path =
        'routes' in config
          ? ['routes', index, 'repeat']
          : config.answer.type === 'choice'
            ? ['answer', 'options', index, 'repeat']
            : config.answer.type === 'score'
              ? ['answer', 'bands', index, 'repeat']
              : ['answer', index === 0 ? 'true' : 'false', 'repeat'];
      if (seen) ctx.addIssue({ code: 'custom', path, message: 'at most one route may repeat' });
      seen = true;
    });
  }
  if (repeats.length && config.maxPasses === undefined)
    ctx.addIssue({
      code: 'custom',
      path: ['maxPasses'],
      message: 'a repeat route requires maxPasses',
    });
  if (!repeats.length)
    for (const key of ['maxPasses', 'maxRunTimeSeconds'] as const)
      if (config[key] !== undefined)
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'gate limits require a repeat route',
        });
}
const GateLimits = {
  maxPasses: z
    .number()
    .int()
    .positive()
    .max(10_000)
    .optional()
    .meta(
      field(
        'Required with a repeat route. One-based passes; a non-repeat choice wins on the last pass.',
      ),
    ),
  maxRunTimeSeconds: z
    .number()
    .int()
    .positive()
    .max(31_536_000)
    .optional()
    .meta(
      field(
        'Optional maximum elapsed seconds from run start, including waits and pauses. Checked after evaluation, only on a repeat.',
      ),
    ),
};
export const ExpressionDecisionConfigSchema = ExpressionSourceSchema.safeExtend({
  ...GateLimits,
  routes: RouteDeclarationsSchema.meta(
    field('Two to sixty-four stable readable routes.', { jsonEditor: true }),
  ),
}).superRefine(gateLimitsIssues);
const LlmSourceSchema = z.strictObject({
  kind: z.literal('llm').meta(field('Use a structured Codex evaluation.')),
  instructions: TemplateSchema.meta(field('Liquid instructions rendered against the full thread.')),
  harness: z.literal('codex').meta(field('Implemented structured evaluator harness.')),
  model: ModelSelectionSchema.meta(field('Inherit or explicitly select the model.')),
  effort: EffortSelectionSchema.meta(field('Inherit or explicitly select reasoning effort.')),
});
export const LlmDecisionConfigSchema = LlmSourceSchema.extend({
  ...GateLimits,
  routes: RouteDeclarationsSchema.meta(
    field('Declared stable route ids and readable labels.', { jsonEditor: true }),
  ),
  context: DecisionContextSchema.prefault({}).meta(
    field('Selected provider context.', { context: true, jsonEditor: true }),
  ),
}).superRefine(gateLimitsIssues);
export const ClassifierEvaluationConfigSchema = z.strictObject({
  kind: z.literal('classifier').meta(field('Evaluate one classifier primitive.')),
  model: ClassifierModelIdSchema.meta(
    field('Explicit classifier catalog id.', { control: 'classifier' }),
  ),
  question: TemplateSchema.meta(field('Liquid classifier question.')),
  minConfidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .meta(field('Classifier confidence minimum.', { advanced: true, group: 'Acceptance' })),
  truthThreshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .meta(
      field('Noul true probability threshold; omission means 0.5.', {
        advanced: true,
        group: 'Acceptance',
      }),
    ),
});
const classifierThreshold = (
  config: { answer: { type: string }; truthThreshold?: number | undefined },
  ctx: z.RefinementCtx,
) => {
  if (config.truthThreshold !== undefined && config.answer.type !== 'noul')
    ctx.addIssue({
      code: 'custom',
      path: ['truthThreshold'],
      message: 'truthThreshold applies only to classifier Noul',
    });
};
export const ClassifierDecisionConfigSchema = ClassifierEvaluationConfigSchema.extend({
  ...GateLimits,
  answer: ClassifierAnswerConfigSchema.meta(
    field('Classifier answer and stable ports.', { jsonEditor: true }),
  ),
  context: DecisionContextSchema.prefault({}).meta(
    field('Selected provider context.', { context: true, jsonEditor: true }),
  ),
  recordAlternatives: z
    .boolean()
    .default(true)
    .meta(
      field('Record classifier probability alternatives.', { advanced: true, group: 'Recording' }),
    ),
})
  .superRefine(classifierThreshold)
  .superRefine(gateLimitsIssues);
export const DecisionConfigSchema = z.discriminatedUnion('kind', [
  ExpressionDecisionConfigSchema,
  LlmDecisionConfigSchema,
  ClassifierDecisionConfigSchema,
]);
export type ExpressionDecisionConfig = z.infer<typeof ExpressionDecisionConfigSchema>;
export type LlmDecisionConfig = z.infer<typeof LlmDecisionConfigSchema>;
export type ClassifierDecisionConfig = z.infer<typeof ClassifierDecisionConfigSchema>;
export type DecisionConfig = z.infer<typeof DecisionConfigSchema>;
export const ChoiceAnswerSchema = z.strictObject({
  type: z.literal('choice'),
  optionId: ChoiceOptionIdSchema,
  confidence: z.number().min(0).max(1).nullable(),
  probabilities: z.record(ChoiceOptionIdSchema, z.number().min(0).max(1)).nullable(),
});
export type ChoiceAnswer = z.infer<typeof ChoiceAnswerSchema>;
const ProbabilitySchema = z.number().min(0).max(1);
export const NoulAnswerSchema = z.strictObject({
  type: z.literal('noul'),
  holds: z.boolean().nullable(),
  trueProbability: ProbabilitySchema.nullable(),
  confidence: ProbabilitySchema.nullable(),
});
export type NoulAnswer = z.infer<typeof NoulAnswerSchema>;
export const ScoreAnswerSchema = z.strictObject({
  type: z.literal('score'),
  score: z.number().min(0),
  confidence: ProbabilitySchema.nullable(),
  legend: z.record(z.string(), z.string()),
  probabilities: z.record(z.string(), ProbabilitySchema).nullable(),
});
export type ScoreAnswer = z.infer<typeof ScoreAnswerSchema>;
export const ClassifierAnswerSchema = z.discriminatedUnion('type', [
  ChoiceAnswerSchema,
  NoulAnswerSchema,
  ScoreAnswerSchema,
]);
export type ClassifierAnswer = z.infer<typeof ClassifierAnswerSchema>;
/** Historical unknowns remain readable, but fresh classifiers require complete boolean facts. */
export const ClassifierAnswerEmissionSchema = ClassifierAnswerSchema.superRefine((answer, ctx) => {
  if (answer.type === 'noul') {
    for (const key of ['holds', 'trueProbability', 'confidence'] as const)
      if (answer[key] === null)
        ctx.addIssue({ code: 'custom', path: [key], message: `fresh Noul requires ${key}` });
  }
});
export const EvaluationProvenanceSchema = z.strictObject({
  kind: z.enum(['expression', 'classifier', 'llm']),
  provider: z.string().min(1).max(64).nullable(),
  classifierId: ClassifierModelIdSchema.nullable(),
  model: ModelNameSchema.nullable(),
  effort: EffortSchema.nullable(),
});
export type EvaluationProvenance = z.infer<typeof EvaluationProvenanceSchema>;
export const EvaluationAcceptanceSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('accepted') }),
  z.strictObject({
    status: z.literal('rejected'),
    code: z.literal('EVALUATION_RESULT_REJECTED'),
    minConfidence: ProbabilitySchema,
  }),
]);
export type EvaluationAcceptance = z.infer<typeof EvaluationAcceptanceSchema>;
export const ClassifierEvaluationSchema = z.strictObject({
  answer: ClassifierAnswerSchema,
  provenance: EvaluationProvenanceSchema.extend({ kind: z.literal('classifier') }),
  acceptance: EvaluationAcceptanceSchema,
});
export type ClassifierEvaluation = z.infer<typeof ClassifierEvaluationSchema>;
export const EvaluationObservationSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('route'),
    routeId: RouteIdSchema,
    confidence: ProbabilitySchema.nullable(),
    reasoning: z.string().max(2048).nullable(),
  }),
  z.strictObject({
    kind: z.literal('boolean'),
    holds: z.boolean().nullable(),
    confidence: ProbabilitySchema.nullable(),
    reasoning: z.string().max(2048).nullable(),
  }),
  z.strictObject({ kind: z.literal('classifier'), answer: ClassifierAnswerSchema }),
]);
export type EvaluationObservation = z.infer<typeof EvaluationObservationSchema>;
export const EvaluationFactSchema = z.strictObject({
  provenance: EvaluationProvenanceSchema,
  observation: EvaluationObservationSchema,
});
/** Fresh facts are checked independently of decision routing, including predicates. */
export const EvaluationEmissionSchema = EvaluationFactSchema.superRefine(
  ({ provenance, observation }, ctx) => {
    const require = (condition: boolean, path: string[], message: string) => {
      if (!condition) ctx.addIssue({ code: 'custom', path, message });
    };
    if (provenance.kind === 'classifier') {
      require(observation.kind === 'classifier', [
        'observation',
        'kind',
      ], 'classifier evidence requires a classifier answer');
      require(provenance.provider !== null &&
        provenance.model !== null &&
        provenance.classifierId !== null &&
        provenance.effort === null, [
        'provenance',
      ], 'classifier evidence requires resolved provider, model and id');
      if (observation.kind === 'classifier') {
        const fresh = ClassifierAnswerEmissionSchema.safeParse(observation.answer);
        if (!fresh.success)
          for (const issue of fresh.error.issues)
            ctx.addIssue({ ...issue, path: ['observation', 'answer', ...issue.path] });
        require(observation.answer.type !== 'choice' || observation.answer.confidence !== null, [
          'observation',
          'answer',
          'confidence',
        ], 'fresh Choice requires confidence');
      }
    } else {
      require(observation.kind !== 'classifier', [
        'observation',
        'kind',
      ], 'route or boolean evidence required');
      if (provenance.kind === 'expression') {
        for (const key of ['provider', 'classifierId', 'model', 'effort'] as const)
          require(provenance[key] === null, [
            'provenance',
            key,
          ], 'expression provenance is inapplicable');
        if (observation.kind !== 'classifier')
          require(observation.confidence === null && observation.reasoning === null, [
            'observation',
          ], 'expression facts have no confidence or reasoning');
      } else {
        require(provenance.provider === 'codex' &&
          provenance.classifierId === null &&
          provenance.model !== null &&
          provenance.effort !== null, [
          'provenance',
        ], 'LLM facts require resolved Codex model and effort');
        if (observation.kind !== 'classifier')
          require(observation.confidence !== null && observation.reasoning !== null, [
            'observation',
          ], 'LLM facts require confidence and reasoning');
      }
      if (observation.kind === 'boolean')
        require(observation.holds !== null, [
          'observation',
          'holds',
        ], 'fresh predicates require a boolean');
    }
  },
);
/** One-based current pass. Only an actual repeat advances it; a refused repeat retains it. */
export const GateEvidenceSchema = z.strictObject({
  previousPasses: z.number().int().positive(),
  passes: z.number().int().positive(),
  repeatRouteId: RouteIdSchema,
  maxPasses: z.number().int().positive().max(10_000),
  maxRunTimeSeconds: z
    .number()
    .int()
    .positive()
    .max(31_536_000)
    .optional()
    .meta(
      field(
        'Optional maximum elapsed seconds from run start, including waits and pauses. Checked after evaluation, only on a repeat.',
      ),
    ),
  elapsedSeconds: z.number().nonnegative(),
  limit: z.enum(['max-passes', 'max-run-time']).nullable(),
});
export type GateEvidence = z.infer<typeof GateEvidenceSchema>;
export const DecisionPayloadSchema = EvaluationFactSchema.extend({
  portId: z.union([RouteIdSchema, z.literal(LIMIT_REACHED_PORT_ID)]),
  gate: GateEvidenceSchema.optional(),
}).superRefine((payload, ctx) => {
  const { observation, gate } = payload;
  if (gate) {
    const repeat = payload.portId === gate.repeatRouteId;
    const limit =
      repeat || payload.portId === LIMIT_REACHED_PORT_ID
        ? gate.previousPasses >= gate.maxPasses
          ? 'max-passes'
          : gate.maxRunTimeSeconds !== undefined && gate.elapsedSeconds >= gate.maxRunTimeSeconds
            ? 'max-run-time'
            : null
        : null;
    if (
      gate.previousPasses > gate.maxPasses ||
      gate.passes > gate.maxPasses ||
      gate.limit !== limit ||
      (payload.portId === LIMIT_REACHED_PORT_ID) !== (limit !== null) ||
      gate.passes !== gate.previousPasses + (repeat && !limit ? 1 : 0)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['gate'],
        message: 'gate evidence must agree with the selected route, limit and pass count',
      });
  } else if (payload.portId === LIMIT_REACHED_PORT_ID)
    ctx.addIssue({
      code: 'custom',
      path: ['portId'],
      message: 'Limit reached requires gate evidence',
    });
  if (
    (observation.kind === 'route' &&
      observation.routeId !==
        (payload.gate?.limit ? payload.gate.repeatRouteId : payload.portId)) ||
    (observation.kind === 'classifier' &&
      observation.answer.type === 'choice' &&
      observation.answer.optionId !==
        (payload.gate?.limit ? payload.gate.repeatRouteId : payload.portId))
  )
    ctx.addIssue({
      code: 'custom',
      path: ['portId'],
      message: 'selected port must equal the observed route',
    });
});
export type DecisionPayload = z.infer<typeof DecisionPayloadSchema>;
export const EvaluationDiagnosticSchema = z.strictObject({
  provenance: EvaluationProvenanceSchema,
  code: z.string().min(1).max(64),
  message: z.string().min(1).max(256),
});
export const DecisionEvidenceSchema = DecisionPayloadSchema.safeExtend({
  diagnostics: z.array(EvaluationDiagnosticSchema).max(3),
});
export type DecisionEvidence = z.infer<typeof DecisionEvidenceSchema>;
export const DecisionEmissionSchema = DecisionEvidenceSchema.superRefine((payload, ctx) => {
  const fresh = EvaluationEmissionSchema.safeParse({
    provenance: payload.provenance,
    observation: payload.observation,
  });
  if (!fresh.success) for (const issue of fresh.error.issues) ctx.addIssue({ ...issue });
  if (payload.observation.kind === 'boolean')
    ctx.addIssue({
      code: 'custom',
      path: ['observation', 'kind'],
      message: 'fresh decisions require a route or classifier observation',
    });
  if (payload.diagnostics.length !== 0)
    ctx.addIssue({
      code: 'custom',
      path: ['diagnostics'],
      message: 'fresh evaluations have no strategy skips',
    });
});
