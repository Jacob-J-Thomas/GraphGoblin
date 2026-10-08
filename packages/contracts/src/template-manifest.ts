import { z } from 'zod';
import { JsonSchemaSchema, SlugSchema, TimestampSchema, UlidSchema } from './common.js';
import { LoopDefinitionSchema } from './loop.js';
import {
  TemplateKindSchema,
  TemplateRoleIdSchema,
  TemplateSettingsSchema,
} from './template-settings.js';

export const TemplateVersionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/);
export const TemplateRelativePathSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)
  .refine(
    (value) => !value.split('/').some((part) => !part || part === '.' || part === '..'),
    'must be a portable relative path without traversal',
  );
export const TemplatePrerequisiteDeclarationSchema = z.strictObject({
  id: SlugSchema,
  label: z.string().min(1).max(120),
  kind: z.enum(['repository', 'github', 'secret', 'role', 'isolation', 'support']),
  blocking: z.enum(['authoring', 'runtime']),
  role: TemplateRoleIdSchema.optional(),
  secretKey: SlugSchema.optional(),
});
export type TemplatePrerequisiteDeclaration = z.infer<typeof TemplatePrerequisiteDeclarationSchema>;
export const TemplateLoopManifestSchema = z.strictObject({
  key: SlugSchema,
  file: TemplateRelativePathSchema.refine(
    (value) => value.endsWith('.json'),
    'must name a JSON export',
  ),
  dependsOn: z.array(SlugSchema).max(32).default([]),
  roleNodes: z
    .array(z.strictObject({ role: TemplateRoleIdSchema, nodeId: SlugSchema }))
    .max(64)
    .default([]),
  /** Existing literal mutations only; never rewrite executable or templated source strings. */
  settingsNodes: z.array(SlugSchema).max(32).default([]),
  subloops: z
    .array(z.strictObject({ nodeId: SlugSchema, loopKey: SlugSchema }))
    .max(32)
    .default([]),
});
export type TemplateLoopManifest = z.infer<typeof TemplateLoopManifestSchema>;
export const TemplateManifestSchema = z.strictObject({
  id: SlugSchema,
  version: TemplateVersionSchema,
  kind: TemplateKindSchema,
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(4000),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  roles: z
    .array(
      z.strictObject({
        id: TemplateRoleIdSchema,
        label: z.string().min(1).max(120),
        access: z.enum(['read-only', 'write']),
      }),
    )
    .max(8),
  prerequisites: z.array(TemplatePrerequisiteDeclarationSchema).max(32).default([]),
  requiredSecrets: z
    .array(
      z.strictObject({
        key: SlugSchema,
        scopes: z
          .array(z.string().regex(/^[a-z-]+:(read|write)$/))
          .min(1)
          .max(8),
      }),
    )
    .max(8)
    .default([]),
  parentKey: SlugSchema,
  loops: z.array(TemplateLoopManifestSchema).min(1).max(32),
  supportEntry: TemplateRelativePathSchema.optional(),
});
export type TemplateManifest = z.infer<typeof TemplateManifestSchema>;
export const TemplateBundleSchema = z.strictObject({
  manifest: TemplateManifestSchema,
  loops: z.record(SlugSchema, LoopDefinitionSchema),
});
export type TemplateBundle = z.infer<typeof TemplateBundleSchema>;

export const TemplatePrerequisiteCheckSchema = z
  .strictObject({
    id: SlugSchema,
    label: z.string().min(1).max(120),
    status: z.enum(['ok', 'missing', 'unavailable']),
    blocking: z.enum(['authoring', 'runtime']),
    message: z.string().min(1).max(1000),
    remediation: z.string().min(1).max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status !== 'ok' && !value.remediation?.trim())
      ctx.addIssue({
        code: 'custom',
        path: ['remediation'],
        message: 'a failed prerequisite needs actionable remediation',
      });
  });
export type TemplatePrerequisiteCheck = z.infer<typeof TemplatePrerequisiteCheckSchema>;
export const TemplatePrerequisiteReportSchema = z
  .strictObject({
    checks: z.array(TemplatePrerequisiteCheckSchema).max(64),
    canInstantiate: z.boolean(),
    canRun: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.checks.map((check) => check.id)).size !== value.checks.length)
      ctx.addIssue({
        code: 'custom',
        path: ['checks'],
        message: 'prerequisite ids must be unique',
      });
    if (
      value.canInstantiate !==
      !value.checks.some((check) => check.blocking === 'authoring' && check.status !== 'ok')
    )
      ctx.addIssue({
        code: 'custom',
        path: ['canInstantiate'],
        message: 'must reflect the authoring prerequisites',
      });
    if (value.canRun !== value.checks.every((check) => check.status === 'ok'))
      ctx.addIssue({
        code: 'custom',
        path: ['canRun'],
        message: 'must reflect every prerequisite',
      });
  });
export type TemplatePrerequisiteReport = z.infer<typeof TemplatePrerequisiteReportSchema>;
export const TemplateInstanceLoopSchema = z.strictObject({
  key: SlugSchema,
  loopId: UlidSchema,
  versionId: UlidSchema,
  version: z.number().int().positive(),
  status: z.enum(['draft', 'published']),
});
export const TemplateInstanceSchema = z
  .strictObject({
    id: UlidSchema,
    ownerId: z.string().min(1).max(128),
    templateId: SlugSchema,
    templateVersion: TemplateVersionSchema,
    createdAt: TimestampSchema,
    parentLoopId: UlidSchema,
    loops: z.array(TemplateInstanceLoopSchema).min(1).max(32),
    settings: TemplateSettingsSchema,
  })
  .superRefine((value, ctx) => {
    const parents = value.loops.filter((loop) => loop.loopId === value.parentLoopId);
    if (
      parents.length !== 1 ||
      parents[0]?.status !== 'draft' ||
      value.loops.some((loop) => loop.loopId !== value.parentLoopId && loop.status !== 'published')
    )
      ctx.addIssue({
        code: 'custom',
        path: ['loops'],
        message: 'exactly one draft parent and published children are required',
      });
    if (
      new Set(value.loops.map((loop) => loop.key)).size !== value.loops.length ||
      new Set(value.loops.map((loop) => loop.loopId)).size !== value.loops.length ||
      new Set(value.loops.map((loop) => loop.versionId)).size !== value.loops.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['loops'],
        message: 'loop keys and allocated ids must be unique',
      });
  });
export type TemplateInstance = z.infer<typeof TemplateInstanceSchema>;
export const TemplateCatalogEntrySchema = z
  .strictObject({
    manifest: TemplateManifestSchema,
    settingsSchema: JsonSchemaSchema,
    defaultSettings: TemplateSettingsSchema.nullable(),
    prerequisites: TemplatePrerequisiteReportSchema,
  })
  .superRefine((value, ctx) => {
    if (value.defaultSettings !== null && value.defaultSettings.kind !== value.manifest.kind)
      ctx.addIssue({
        code: 'custom',
        path: ['defaultSettings'],
        message: 'default settings kind must match the manifest',
      });
  });
export type TemplateCatalogEntry = z.infer<typeof TemplateCatalogEntrySchema>;
export const TemplateListResponseSchema = z.strictObject({
  items: z.array(TemplateCatalogEntrySchema).max(100),
});
export type TemplateListResponse = z.infer<typeof TemplateListResponseSchema>;
export const TemplatePrerequisiteRequestSchema = z.strictObject({
  settings: TemplateSettingsSchema,
});
export type TemplatePrerequisiteRequest = z.infer<typeof TemplatePrerequisiteRequestSchema>;
export const TemplateInstantiateRequestSchema = z.strictObject({
  settings: TemplateSettingsSchema,
  name: z.string().min(1).max(120).optional(),
});
export type TemplateInstantiateRequest = z.infer<typeof TemplateInstantiateRequestSchema>;
export const TemplateInstantiateResponseSchema = z.strictObject({
  instance: TemplateInstanceSchema,
  prerequisites: TemplatePrerequisiteReportSchema,
});
export type TemplateInstantiateResponse = z.infer<typeof TemplateInstantiateResponseSchema>;
