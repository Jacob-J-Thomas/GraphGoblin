import { z } from 'zod';
import { supportBlocked } from '../support-result.js';
import {
  ContextThreadSchema,
  JsonValueSchema,
  ReviewTemplateSettingsSchema,
} from '@graphgoblin/contracts';
import { ClaimRecordSchema } from '../authority.js';
import { TemplateSubjectSchema } from '../subjects.js';
import { SupportIdentitySchema, ShaSchema } from './protocol.js';

export const REVIEW_SUPPORT_VERSION = '1.0.0';
export const ReviewActionSchema = z.enum([
  'poll',
  'claim',
  'prepare',
  'gate',
  'verdict',
  'fix-prepare',
  'fixer-head',
  'summary',
  'human',
  'reminder',
  'merge',
  'close',
  'timeout',
  'block',
]);
export type ReviewAction = z.infer<typeof ReviewActionSchema>;
const WakeFields = {
  nodeId: z.enum(['human-wait', 'human-wait-capped']),
  startedSeq: z.number().int().positive(),
  seq: z.number().int().positive(),
};
export const ReviewWakeSchema = z.discriminatedUnion('reason', [
  z.strictObject({
    ...WakeFields,
    reason: z.literal('input'),
    inputSeq: z.number().int().positive(),
    payload: JsonValueSchema,
  }),
  z.strictObject({ ...WakeFields, reason: z.literal('timeout') }),
]);
export type ReviewWake = z.infer<typeof ReviewWakeSchema>;
export const ReviewEnvelopeSchema = z
  .strictObject({
    settings: ReviewTemplateSettingsSchema,
    input: ContextThreadSchema.nullable(),
    credential: z.string().min(1).max(4096),
    identity: SupportIdentitySchema,
    visit: z.number().int().positive().nullable(),
    subject: TemplateSubjectSchema.nullable(),
    claim: ClaimRecordSchema.nullable(),
    wake: ReviewWakeSchema.nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.identity.kind === 'poll') {
      if (value.subject || value.claim || value.input || value.wake || value.visit)
        ctx.addIssue({ code: 'custom', message: 'Review poll cannot carry run authority.' });
      return;
    }
    if (
      !value.subject ||
      value.subject.role !== 'parent' ||
      value.subject.kind !== 'review' ||
      !value.input ||
      value.input.run.id !== value.identity.runId ||
      !value.visit ||
      value.subject.repository !==
        (value.settings.repository.owner + '/' + value.settings.repository.name).toLowerCase()
    )
      ctx.addIssue({ code: 'custom', message: 'Review requires the exact admitted parent.' });
    if (
      value.claim &&
      (value.claim.repository !== value.subject?.repository ||
        value.claim.issue !== value.subject?.issue ||
        value.claim.attempt !== value.subject?.attempt)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Review claim must match the authenticated subject.',
      });
  });
export type ReviewEnvelope = z.infer<typeof ReviewEnvelopeSchema>;
const Text = z.string().trim().min(1).max(4000);
export const ReviewProposalSchema = z
  .strictObject({
    verdict: z.enum(['approved', 'changes']),
    summary: Text,
    findings: z
      .array(
        z.strictObject({
          id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
          path: z.string().trim().min(1).max(256),
          line: z.number().int().positive().nullable(),
          severity: z.enum(['blocking', 'suggestion']),
          message: Text.max(1000),
        }),
      )
      .max(32),
  })
  .superRefine((value, ctx) => {
    if (
      value.verdict === 'approved' &&
      value.findings.some((finding) => finding.severity === 'blocking')
    )
      ctx.addIssue({ code: 'custom', message: 'Blocking findings cannot grant approval.' });
    if (new Set(value.findings.map((finding) => finding.id)).size !== value.findings.length)
      ctx.addIssue({ code: 'custom', message: 'Finding IDs must be distinct.' });
  });
export type ReviewProposal = z.infer<typeof ReviewProposalSchema>;
export const ReviewFixResultSchema = z.strictObject({ summary: Text });
export const HumanChoiceSchema = z.strictObject({
  decision: z.enum(['merge', 'another-cycle', 'close']),
  note: z.string().max(4000).optional(),
});
export const ReviewIdentitySchema = z.strictObject({
  ownerId: z.string().min(1),
  runId: z.string().min(1),
  repository: z.string().min(1),
  pullRequest: z.number().int().positive(),
  originalHead: ShaSchema,
  issue: z.number().int().positive().nullable(),
  attempt: z.number().int().min(1).max(3).nullable(),
});
export type ReviewIdentity = z.infer<typeof ReviewIdentitySchema>;
export function reviewBlocked(code: string) {
  return supportBlocked(code);
}
