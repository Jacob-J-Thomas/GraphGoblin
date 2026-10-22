import { z } from 'zod';
import { field } from './meta.js';
import { SlugSchema, TemplateSchema, TimestampSchema, UlidSchema } from './common.js';
import { NodeSchema } from './nodes.js';
import { HarnessDefaultsSchema } from './evaluation.js';
import { VariableDeclarationsSchema } from './thread.js';

/** The one current definition/export/storage format; frozen conversion stages keep their literals. */
export const CURRENT_DEFINITION_FORMAT = 4 as const;

/** Where a run works. Fixed path, templated from the trigger, or a fresh temporary directory. */
export const WorkingDirectorySpecSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('fixed'), path: z.string().min(1).max(4096) }),
  z.strictObject({ kind: z.literal('template'), template: TemplateSchema }),
  z.strictObject({ kind: z.literal('temp') }),
]);
export type WorkingDirectorySpec = z.infer<typeof WorkingDirectorySpecSchema>;

export const ExecutionLimitsSchema = z.strictObject({
  maxNodeVisits: z
    .number()
    .int()
    .positive()
    .max(10_000)
    .nullable()
    .default(10)
    .meta(
      field('Fresh entries per node. Default 10; unlimited removes this cutoff.', {
        control: 'execution-limit',
      }),
    ),
  // Long waits and heartbeats have no deadline unless their author sets one.
  runDeadlineSeconds: z
    .number()
    .int()
    .positive()
    .max(31_536_000)
    .nullable()
    .default(null)
    .meta(
      field(
        'Elapsed seconds including waits, pauses and restart downtime. No deadline by default; set seconds to add one.',
        { control: 'execution-limit' },
      ),
    ),
});
export type ExecutionLimits = z.infer<typeof ExecutionLimitsSchema>;

export const LoopSettingsSchema = z.strictObject({
  workingDirectory: WorkingDirectorySpecSchema.default({ kind: 'temp' }),
  defaults: HarnessDefaultsSchema.prefault({}),
  ...ExecutionLimitsSchema.shape,
  subloopDepthLimit: z.number().int().positive().max(64).default(8),
});
export type LoopSettings = z.infer<typeof LoopSettingsSchema>;

/**
 * An edge's manual route on the canvas (#44): the positions of the route's inner segments in
 * canvas coordinates, alternating the x of a vertical segment and the y of a horizontal one
 * (x, y, x, ..., x). The first and last segments are horizontal and run from the ports' own
 * heights, so the route stays attached to both ports when a card moves. Layout only, like a node's
 * `ui`: the engine ignores it.
 */
export const EdgeRouteSchema = z
  .array(z.number())
  .min(1)
  .max(63)
  .refine((route) => route.length % 2 === 1, {
    message: 'A route alternates x and y and starts and ends with an x: it has an odd length',
  })
  .describe(
    'Manual route: inner segment positions, alternating the x of a vertical segment and the y of a horizontal one (x, y, ..., x). The end segments follow the ports. Editor layout only; runs ignore it.',
  );

export const EdgeSchema = z.strictObject({
  id: SlugSchema,
  from: z.strictObject({ node: SlugSchema, port: SlugSchema }),
  to: z.strictObject({ node: SlugSchema, port: z.literal('in').default('in') }),
  /** Canvas layout of the edge. Without it the editor routes the edge automatically. */
  ui: z.strictObject({ route: EdgeRouteSchema }).optional(),
});
export type Edge = z.infer<typeof EdgeSchema>;

export const LoopDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(CURRENT_DEFINITION_FORMAT),
  name: z.string().min(1).max(120),
  description: z.string().max(4000).optional(),
  settings: LoopSettingsSchema.prefault({}),
  variables: VariableDeclarationsSchema.prefault({}),
  nodes: z.array(NodeSchema).min(1).max(500),
  edges: z.array(EdgeSchema).max(2000),
});
export type LoopDefinition = z.infer<typeof LoopDefinitionSchema>;
export type LoopDefinitionInput = z.input<typeof LoopDefinitionSchema>;

/** Portable file format for committing loops to a repository. */
export const LoopExportSchema = z.strictObject({
  format: z.literal('graphgoblin-loop'),
  formatVersion: z.literal(CURRENT_DEFINITION_FORMAT),
  exportedAt: TimestampSchema,
  loop: LoopDefinitionSchema,
});
export type LoopExport = z.infer<typeof LoopExportSchema>;

export const LoopRecordSchema = z.strictObject({
  id: UlidSchema,
  ownerId: z.string().min(1).max(128),
  name: z.string().min(1).max(120),
  description: z.string().max(4000).optional(),
  currentVersionId: UlidSchema.optional(),
  draftVersionId: UlidSchema.optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type LoopRecord = z.infer<typeof LoopRecordSchema>;

/**
 * `draft`: the loop's one editable definition. `published`: an immutable released version.
 * `snapshot`: an immutable copy of the draft frozen when a draft run started, carrying the draft's
 * number; runs pin it, it is never published, listed in the version history, or edited (ADR-0041).
 */
export const LoopVersionStatusSchema = z.enum(['draft', 'published', 'snapshot']);
export type LoopVersionStatus = z.infer<typeof LoopVersionStatusSchema>;

export const LoopVersionRecordSchema = z.strictObject({
  id: UlidSchema,
  loopId: UlidSchema,
  version: z.number().int().positive(),
  status: LoopVersionStatusSchema,
  definition: LoopDefinitionSchema,
  createdAt: TimestampSchema,
  publishedAt: TimestampSchema.optional(),
});
export type LoopVersionRecord = z.infer<typeof LoopVersionRecordSchema>;
