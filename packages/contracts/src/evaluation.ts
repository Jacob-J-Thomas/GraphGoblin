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

export const ChoiceOptionIdSchema = SlugSchema.refine(
  (value) => value !== 'in',
  'an option id may not be named "in"',
);
export const ChoiceOptionSchema = z.strictObject({
  id: ChoiceOptionIdSchema.meta(
    field('Stable provider key and output port; changing display order does not change the route.'),
  ),
  label: z.string().trim().min(1).max(120).meta(field('Unique readable option label.')),
  criteria: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .meta(field('Authored criterion sent to the selected evaluator.')),
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

export const DecisionContextSchema = z.strictObject({
  messages: MessageSelectionSchema.default('last').meta(
    field('Selected messages; this selector does not restrict question-template exposure.'),
  ),
  vars: z
    .array(SlugSchema)
    .optional()
    .meta(
      field(
        'Variable names included in provider state; omission includes all variables and does not restrict the question template.',
      ),
    ),
  includeLastOutput: z
    .boolean()
    .default(true)
    .meta(field('Include the latest output value in provider state when one exists.')),
});
export type DecisionContext = z.infer<typeof DecisionContextSchema>;
const QuestionFields = {
  question: TemplateSchema.meta(field('Liquid question rendered against the full context thread.')),
  context: DecisionContextSchema.prefault({}).meta(
    field('Selected provider state, separate from the full-thread question-template context.'),
  ),
};
export const DecisionEvaluationSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z
      .literal('expression')
      .meta(field('Evaluate JSONata locally without invoking a provider.')),
    jsonata: ExpressionSchema.meta(
      field('JSONata must return a declared string option id; no coercion or provider fallback.'),
    ),
  }),
  z.strictObject({
    kind: z.literal('classifier').meta(field('Use one explicitly selected Choice classifier.')),
    model: ClassifierModelIdSchema.meta(
      field('Explicit Choice-capable classifier catalog id.', { control: 'classifier' }),
    ),
    ...QuestionFields,
    minConfidence: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .meta(
        field(
          'Reject a classifier answer below this confidence; rejection never selects another evaluator.',
          { advanced: true, group: 'Acceptance' },
        ),
      ),
  }),
  z.strictObject({
    kind: z
      .literal('llm')
      .meta(field('Use one structured Choice completion from the selected LLM harness.')),
    harness: z.literal('codex').meta(field('Harness implementing this LLM evaluation.')),
    model: ModelSelectionSchema.meta(
      field('Explicit model selection or harness-scoped inheritance.'),
    ),
    effort: EffortSelectionSchema.meta(
      field('Explicit reasoning effort or harness-scoped inheritance.'),
    ),
    ...QuestionFields,
  }),
]);
export type DecisionEvaluation = z.infer<typeof DecisionEvaluationSchema>;
export const DecisionConfigSchema = z.strictObject({
  answer: ChoiceConfigSchema.meta(field('Declared Choice options and stable route identifiers.')),
  evaluation: DecisionEvaluationSchema.meta(field('Exactly one evaluation method.')),
  recordAlternatives: z
    .boolean()
    .default(true)
    .meta(
      field('Retain classifier probabilities in execution evidence.', {
        advanced: true,
        group: 'Recording',
      }),
    ),
});
export type DecisionConfig = z.infer<typeof DecisionConfigSchema>;

export const ChoiceAnswerSchema = z.strictObject({
  type: z.literal('choice'),
  optionId: ChoiceOptionIdSchema,
  confidence: z.number().min(0).max(1).nullable(),
  probabilities: z.record(ChoiceOptionIdSchema, z.number().min(0).max(1)).nullable(),
});
export type ChoiceAnswer = z.infer<typeof ChoiceAnswerSchema>;
export const EvaluationProvenanceSchema = z.strictObject({
  kind: z.enum(['expression', 'classifier', 'llm']),
  provider: z.string().min(1).max(64).nullable(),
  classifierId: ClassifierModelIdSchema.nullable(),
  model: ModelNameSchema.nullable(),
  effort: EffortSchema.nullable(),
});
export type EvaluationProvenance = z.infer<typeof EvaluationProvenanceSchema>;
export const DecisionPayloadSchema = z
  .strictObject({
    answer: ChoiceAnswerSchema,
    portId: ChoiceOptionIdSchema,
    provenance: EvaluationProvenanceSchema,
  })
  .superRefine((payload, ctx) => {
    if (payload.portId !== payload.answer.optionId)
      ctx.addIssue({
        code: 'custom',
        path: ['portId'],
        message: 'selected port must equal the Choice option id',
      });
  });
export type DecisionPayload = z.infer<typeof DecisionPayloadSchema>;

/** Universal canonical evidence, including honest unknowns in offline-converted history. */
export const EvaluationDiagnosticSchema = z.strictObject({
  provenance: EvaluationProvenanceSchema,
  code: z.string().min(1).max(64),
  message: z.string().min(1).max(256),
});
export const DecisionEvidenceSchema = z
  .strictObject({
    ...DecisionPayloadSchema.shape,
    diagnostics: z.array(EvaluationDiagnosticSchema).max(3),
  })
  .superRefine((payload, ctx) => {
    if (payload.portId !== payload.answer.optionId)
      ctx.addIssue({
        code: 'custom',
        path: ['portId'],
        message: 'selected port must equal the Choice option id',
      });
  });
export type DecisionEvidence = z.infer<typeof DecisionEvidenceSchema>;

/** Enforced at fresh emission, never applied to offline-converted factual history. */
export const DecisionEmissionSchema = DecisionEvidenceSchema.superRefine((payload, ctx) => {
  const { answer, provenance } = payload;
  const require = (condition: boolean, path: string[], message: string) => {
    if (!condition) ctx.addIssue({ code: 'custom', path, message });
  };
  require(payload.diagnostics.length === 0, [
    'diagnostics',
  ], 'fresh single-evaluator evidence has no strategy skips');
  if (provenance.kind === 'expression') {
    for (const key of ['provider', 'classifierId', 'model', 'effort'] as const)
      require(provenance[key] === null, [
        'provenance',
        key,
      ], 'expression provenance is inapplicable');
    require(answer.confidence === null && answer.probabilities === null, [
      'answer',
    ], 'expression answers have no confidence or probabilities');
  } else {
    require(provenance.provider !== null && provenance.model !== null, [
      'provenance',
    ], 'provider and resolved model are required for fresh provider evidence');
    require(answer.confidence !== null, [
      'answer',
      'confidence',
    ], 'provider confidence is required');
    if (provenance.kind === 'classifier') {
      require(provenance.classifierId !== null && provenance.effort === null, [
        'provenance',
      ], 'classifier id is required and reasoning effort is inapplicable');
    } else {
      require(provenance.provider === 'codex' &&
        provenance.classifierId === null &&
        provenance.effort !== null, [
        'provenance',
      ], 'LLM evidence requires its implemented harness and resolved effort');
      require(answer.probabilities === null, [
        'answer',
        'probabilities',
      ], 'LLM confidence does not establish classifier probabilities');
    }
  }
});
