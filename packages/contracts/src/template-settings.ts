import { z } from 'zod';
import { EffortSchema, HarnessIdSchema, ModelNameSchema, SlugSchema } from './common.js';

const Nonblank = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'must not be blank');
const NoControls = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[^\p{Cc}]+$/u);

export const TemplateKindSchema = z.enum(['starter', 'implementation', 'review', 'qa']);
export type TemplateKind = z.infer<typeof TemplateKindSchema>;
export const TemplateRoleIdSchema = z.enum([
  'assistant',
  'implementer',
  'reviewer',
  'fixer',
  'qa',
  'adversary',
]);
export type TemplateRoleId = z.infer<typeof TemplateRoleIdSchema>;
/** Models and efforts are resolved against the current catalog by the API, never hardcoded here. */
export const TemplateRoleSelectionSchema = z.strictObject({
  harness: HarnessIdSchema,
  model: ModelNameSchema.refine((value) => value.trim().length > 0, 'must not be blank'),
  effort: EffortSchema,
});
export type TemplateRoleSelection = z.infer<typeof TemplateRoleSelectionSchema>;

export const TemplateLabelSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[^\s,\p{Cc}-][^,\p{Cc}]*$/u);
/** Lexical validation only; canonical path/origin and git check-ref-format are API prerequisites. */
export const TemplateBranchSchema = NoControls.max(255).refine(
  (value) =>
    !value.startsWith('-') &&
    !/[\s~^:?*[\\]/.test(value) &&
    !value.includes('..') &&
    !value.includes('@{') &&
    !value.endsWith('/') &&
    !value.endsWith('.') &&
    !value.startsWith('/') &&
    !value.split('/').some((part) => !part || part.startsWith('.') || part.endsWith('.lock')),
  'invalid branch name',
);
export const TemplateRepositorySchema = z.strictObject({
  path: NoControls.refine(
    (value) =>
      /^(?:[A-Za-z]:[\\/]|\/|\\\\[^\\]+\\[^\\]+)/.test(value) &&
      !value.split(/[\\/]/).includes('..'),
    'must be an absolute path without parent traversal',
  ),
  owner: z.string().regex(/^[A-Za-z0-9-]{1,39}$/),
  name: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,100}$/)
    .refine((value) => value !== '.' && value !== '..', 'invalid repository name'),
  baseBranch: TemplateBranchSchema,
});
export type TemplateRepository = z.infer<typeof TemplateRepositorySchema>;
export const TemplateGateSchema = z.strictObject({
  program: NoControls.refine(
    (value) => !/\.(cmd|bat)$/i.test(value),
    'use a native program or the packaged Node pnpm launcher',
  ).default('pnpm'),
  args: z
    .array(
      z
        .string()
        .max(4096)
        .refine((value) => !value.includes('\0'), 'NUL is not an argument'),
    )
    .max(64)
    .default(['check']),
  timeoutSeconds: z.number().int().min(1).max(86_400).default(600),
});
export type TemplateGate = z.infer<typeof TemplateGateSchema>;

export const StarterTemplateSettingsSchema = z.strictObject({
  kind: z.literal('starter'),
  instruction: Nonblank.max(4000).default('Summarize the input and suggest a next step.'),
  roles: z.strictObject({ assistant: TemplateRoleSelectionSchema }),
  maxIterations: z.number().int().min(1).max(10_000).default(10),
});
const RepositorySettings = {
  repository: TemplateRepositorySchema,
  supportReadKey: SlugSchema,
  gate: TemplateGateSchema.prefault({}),
};
export const ImplementationTemplateSettingsSchema = z.strictObject({
  kind: z.literal('implementation'),
  ...RepositorySettings,
  roles: z.strictObject({ implementer: TemplateRoleSelectionSchema }),
  labels: z
    .strictObject({
      trigger: TemplateLabelSchema.default('ready-for-implementation'),
      inProgress: TemplateLabelSchema.default('in-progress'),
      prOpen: TemplateLabelSchema.default('pr-open'),
      blocked: TemplateLabelSchema.default('blocked'),
    })
    .prefault({}),
  limits: z
    .strictObject({
      maxTasks: z.number().int().min(2).max(32).default(8),
      gateFixes: z.number().int().min(0).max(10).default(2),
      maxIterations: z.number().int().min(1).max(10_000).default(100),
    })
    .prefault({}),
});
export const ReviewTemplateSettingsSchema = z.strictObject({
  kind: z.literal('review'),
  ...RepositorySettings,
  roles: z.strictObject({
    reviewer: TemplateRoleSelectionSchema,
    fixer: TemplateRoleSelectionSchema,
  }),
  requireHumanBeforeMerge: z.boolean().default(false),
  humanReviewLabels: z.array(TemplateLabelSchema).max(32).default([]),
  needsHumanLabel: TemplateLabelSchema.default('needs-human'),
  trustedAuthors: z
    .array(z.string().regex(/^[A-Za-z0-9-]{1,39}$/))
    .max(100)
    .default([]),
  requiredChecks: z
    .discriminatedUnion('source', [
      z.strictObject({ source: z.literal('protection') }),
      z.strictObject({ source: z.literal('explicit'), names: z.array(Nonblank.max(200)).max(100) }),
    ])
    .default({ source: 'protection' }),
  mergeMethod: z.enum(['merge', 'squash', 'rebase']).default('squash'),
  limits: z
    .strictObject({
      automaticCycles: z.number().int().min(1).max(3).default(3),
      extraCycles: z.number().int().min(0).max(3).default(3),
      reminders: z.number().int().min(0).max(3).default(3),
      waitHours: z.number().int().min(1).max(168).default(24),
      ciWaitMinutes: z.number().int().min(1).max(120).default(30),
    })
    .prefault({}),
});
export const QaTemplateSettingsSchema = z.strictObject({
  kind: z.literal('qa'),
  ...RepositorySettings,
  roles: z.strictObject({
    qa: TemplateRoleSelectionSchema,
    adversary: TemplateRoleSelectionSchema,
  }),
  depth: z.enum(['standard', 'full-regression']).default('standard'),
  fullRegressionLabel: TemplateLabelSchema.optional(),
  triggerLabel: TemplateLabelSchema.default('ready-for-implementation'),
  proofBranch: TemplateBranchSchema.default('graphgoblin-proof'),
  limits: z
    .strictObject({
      unsoundReruns: z.number().int().min(0).max(1).default(1),
      reworkRequests: z.number().int().min(0).max(2).default(2),
      reopenings: z.number().int().min(0).max(2).default(2),
      proofPushRetries: z.number().int().min(0).max(3).default(3),
    })
    .prefault({}),
});
export const TemplateSettingsSchemas = {
  starter: StarterTemplateSettingsSchema,
  implementation: ImplementationTemplateSettingsSchema,
  review: ReviewTemplateSettingsSchema,
  qa: QaTemplateSettingsSchema,
} as const;
export const TemplateSettingsSchema = z.discriminatedUnion('kind', [
  StarterTemplateSettingsSchema,
  ImplementationTemplateSettingsSchema,
  ReviewTemplateSettingsSchema,
  QaTemplateSettingsSchema,
]);
export type TemplateSettings = z.infer<typeof TemplateSettingsSchema>;
export type StarterTemplateSettings = z.infer<typeof StarterTemplateSettingsSchema>;
export type ImplementationTemplateSettings = z.infer<typeof ImplementationTemplateSettingsSchema>;
export type ReviewTemplateSettings = z.infer<typeof ReviewTemplateSettingsSchema>;
export type QaTemplateSettings = z.infer<typeof QaTemplateSettingsSchema>;
