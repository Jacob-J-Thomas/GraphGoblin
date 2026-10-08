import { z } from 'zod';
import { JsonValueSchema, UlidSchema } from '@graphgoblin/contracts';
import { TemplateError } from './errors.js';
const Sha = z.string().regex(/^[a-f0-9]{40}$/);
export const SubjectSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('implementation'), runId: UlidSchema }),
  z.strictObject({ kind: z.literal('external') }),
]);
const SubjectFields = {
  kind: z.enum(['implementation', 'review', 'qa']),
  instanceId: UlidSchema,
  templateVersion: z.string(),
  repository: z.string().regex(/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/),
  issue: z.number().int().positive().nullable(),
  attempt: z.number().int().min(1).max(3).nullable(),
  source: SubjectSourceSchema,
  pullRequest: z.number().int().positive().optional(),
  head: Sha.optional(),
  mergeSha: Sha.optional(),
};
function subjectIssues(subject: z.infer<typeof _SubjectShape>, ctx: z.RefinementCtx) {
  if ((subject.issue === null) !== (subject.attempt === null))
    ctx.addIssue({
      code: 'custom',
      message: 'Issue and attempt must either both exist or both be null.',
    });
  if (
    subject.kind === 'implementation' &&
    (subject.issue === null || subject.source.kind !== 'implementation')
  )
    ctx.addIssue({
      code: 'custom',
      message: 'Implementation requires its own authenticated issue attempt.',
    });
  if (subject.source.kind === 'implementation' && subject.issue === null)
    ctx.addIssue({
      code: 'custom',
      message: 'An implementation source requires its authenticated issue attempt.',
    });
  if (subject.source.kind === 'external' && subject.attempt !== null && subject.attempt !== 1)
    ctx.addIssue({
      code: 'custom',
      message: 'A trusted external original has baseline attempt one.',
    });
  if (subject.kind === 'review' && (!subject.pullRequest || !subject.head))
    ctx.addIssue({ code: 'custom', message: 'Review requires the trusted PR and head.' });
  if (
    subject.kind === 'qa' &&
    (!subject.pullRequest || !subject.mergeSha || subject.issue === null)
  )
    ctx.addIssue({
      code: 'custom',
      message: 'QA requires the trusted PR, merge SHA, and one original issue.',
    });
}
const _SubjectShape = z.strictObject(SubjectFields);
export const ParentSubjectSchema = z
  .strictObject({ ...SubjectFields, role: z.literal('parent') })
  .superRefine(subjectIssues);
export type ParentSubject = z.infer<typeof ParentSubjectSchema>;
export const WorkerSubjectSchema = z
  .strictObject({
    ...SubjectFields,
    role: z.literal('worker'),
    parentRunId: UlidSchema,
    nodeId: z.string().min(1),
    visit: z.number().int().positive(),
  })
  .superRefine(subjectIssues);
export const TemplateSubjectSchema = z.union([ParentSubjectSchema, WorkerSubjectSchema]);
export type TemplateSubject = z.infer<typeof TemplateSubjectSchema>;
export function parseSubject(value: unknown): TemplateSubject {
  const parsed = TemplateSubjectSchema.safeParse(value);
  if (!parsed.success)
    throw new TemplateError(
      'AUTHORITY_CONFLICT',
      'The selected subject has corrupt or conflicting authority history.',
    );
  return parsed.data;
}
export function subjectJson(value: TemplateSubject) {
  return JsonValueSchema.parse(value);
}
export function sameSubject(a: TemplateSubject, b: TemplateSubject): boolean {
  return (
    a.repository === b.repository &&
    a.issue === b.issue &&
    a.attempt === b.attempt &&
    a.pullRequest === b.pullRequest &&
    a.head === b.head &&
    a.mergeSha === b.mergeSha &&
    a.source.kind === b.source.kind &&
    (a.source.kind !== 'implementation' ||
      (b.source.kind === 'implementation' && a.source.runId === b.source.runId))
  );
}
