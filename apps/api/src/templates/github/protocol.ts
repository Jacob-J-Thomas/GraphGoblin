import { z } from 'zod';
import {
  ContextThreadSchema,
  ImplementationTemplateSettingsSchema,
  UlidSchema,
} from '@graphgoblin/contracts';
import { ClaimRecordSchema } from '../authority.js';
import { TemplateSubjectSchema } from '../subjects.js';

export const SUPPORT_VERSION = '1.0.0';
export const SupportActionSchema = z.enum([
  'poll',
  'claim',
  'prepare',
  'plan',
  'task-prepare',
  'task-complete',
  'gate',
  'pr-intent',
  'pr-created',
  'complete',
  'block',
]);
export type SupportAction = z.infer<typeof SupportActionSchema>;
export const SupportIdentitySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('poll'),
    ownerId: z.string(),
    loopId: UlidSchema,
    versionId: UlidSchema,
    nodeId: z.string(),
  }),
  z.strictObject({
    kind: z.literal('node'),
    ownerId: z.string(),
    loopId: UlidSchema,
    versionId: UlidSchema,
    nodeId: z.string(),
    runId: UlidSchema,
    startedSeq: z.number().int().positive(),
  }),
]);
export const SupportEnvelopeSchema = z
  .strictObject({
    settings: ImplementationTemplateSettingsSchema,
    input: ContextThreadSchema.nullable(),
    credential: z.string().min(1).max(4096),
    identity: SupportIdentitySchema,
    visit: z.number().int().positive().nullable(),
    subject: TemplateSubjectSchema.nullable(),
    claim: ClaimRecordSchema.nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.identity.kind === 'poll') {
      if (value.subject || value.claim || value.input)
        ctx.addIssue({ code: 'custom', message: 'Poll cannot carry run authority.' });
      return;
    }
    if (
      !value.subject ||
      !value.input ||
      value.input.run.id !== value.identity.runId ||
      value.subject.kind !== 'implementation' ||
      value.subject.issue === null ||
      value.subject.attempt === null ||
      value.subject.repository !==
        (value.settings.repository.owner + '/' + value.settings.repository.name).toLowerCase()
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Support needs the exact admitted implementation subject.',
      });
    if (
      value.claim &&
      (value.claim.repository !== value.subject?.repository ||
        value.claim.issue !== value.subject?.issue ||
        value.claim.attempt !== value.subject?.attempt)
    )
      ctx.addIssue({ code: 'custom', message: 'The authenticated claim must match the subject.' });
  });
export type SupportEnvelope = z.infer<typeof SupportEnvelopeSchema>;
const Text = z.string().trim().min(1).max(12000);
export const TaskSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  title: Text.max(200),
  instructions: Text,
});
export const ImplementationPlanSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('direct'), instructions: Text }),
  z.strictObject({
    mode: z.literal('split'),
    tasks: z
      .array(TaskSchema)
      .min(2)
      .max(32)
      .refine(
        (tasks) => new Set(tasks.map((task) => task.id)).size === tasks.length,
        'Task IDs must be unique.',
      ),
  }),
]);
export const WorkerResultSchema = z.strictObject({ summary: Text.max(4000) });
export const PrProposalSchema = z.strictObject({
  title: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((value) => !value.startsWith('-') && !/[\r\n\0]/.test(value)),
  summary: Text.max(4000),
  changes: z.array(Text.max(1000)).min(1).max(32),
  tests: z.array(Text.max(1000)).min(1).max(32),
  risks: z.array(Text.max(1000)).min(1).max(32),
});
export const ShaSchema = z.string().regex(/^[a-f0-9]{40}$/);
export class SupportFailure extends Error {
  constructor(readonly code: string) {
    super('Implementation support refused: ' + code);
  }
}
export function fail(code: string): never {
  throw new SupportFailure(code);
}
export function blocked(code: string) {
  return {
    type: 'SupportBlocked' as const,
    code,
    message: 'Implementation stopped safely; inspect the recorded support code.',
  };
}
