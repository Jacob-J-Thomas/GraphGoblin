import { z } from 'zod';
import { SlugSchema } from './common.js';
import { LoopRecordSchema, LoopVersionRecordSchema } from './loop.js';
import { LoopIssueSchema } from './issues.js';

export const TemplateVersionSchema = z
  .string()
  .max(64)
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  );
export const TemplateRelativePathSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)
  .refine(
    (value) => !value.split('/').some((part) => !part || part === '.' || part === '..'),
    'must be a portable relative path without traversal',
  );
export const TemplateManifestSchema = z.strictObject({
  id: SlugSchema,
  version: TemplateVersionSchema,
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(4000),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  /** Independent ordinary loop copied by POST /templates/:id/draft. */
  draftFile: TemplateRelativePathSchema.refine(
    (value) => value.endsWith('.json'),
    'must name a JSON export',
  ),
});
export type TemplateManifest = z.infer<typeof TemplateManifestSchema>;
export const TemplateCatalogEntrySchema = z.strictObject({ manifest: TemplateManifestSchema });
export type TemplateCatalogEntry = z.infer<typeof TemplateCatalogEntrySchema>;
export const TemplateListResponseSchema = z.strictObject({
  items: z.array(TemplateCatalogEntrySchema).max(100),
});
export type TemplateListResponse = z.infer<typeof TemplateListResponseSchema>;
export const TemplateDraftRequestSchema = z.strictObject({
  name: z
    .string()
    .min(1)
    .max(120)
    .refine((value) => value.trim().length > 0, 'must not be blank')
    .optional(),
});
export type TemplateDraftRequest = z.infer<typeof TemplateDraftRequestSchema>;
/** An ordinary editable loop draft, without template execution authority. */
export const TemplateDraftResponseSchema = z.strictObject({
  loop: LoopRecordSchema,
  draft: LoopVersionRecordSchema,
  issues: z.array(LoopIssueSchema),
});
export type TemplateDraftResponse = z.infer<typeof TemplateDraftResponseSchema>;
