import { z } from 'zod';
import { ContextThreadSchema, QaTemplateSettingsSchema } from '@graphgoblin/contracts';
import { ClaimRecordSchema } from '../authority.js';
import { TemplateSubjectSchema } from '../subjects.js';
import { SupportIdentitySchema } from './protocol.js';
import { QaIdentitySchema } from './qa-protocol.js';

export const QaHistorySnapshotSchema = z.strictObject({
  identity: QaIdentitySchema,
  requests: z.number().int().min(0).max(2),
  reopenings: z.number().int().min(0).max(2),
  attempts: z.number().int().min(1).max(3),
});
export type QaHistorySnapshot = z.infer<typeof QaHistorySnapshotSchema>;
export const QaPrivateEnvelopeSchema = z
  .strictObject({
    settings: QaTemplateSettingsSchema,
    credential: z.string().min(1).max(4096),
    identity: SupportIdentitySchema,
    input: ContextThreadSchema.nullable(),
    subject: TemplateSubjectSchema.nullable(),
    claim: ClaimRecordSchema.nullable(),
    visit: z.number().int().positive().nullable(),
    history: QaHistorySnapshotSchema.nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.identity.kind === 'poll') {
      if (value.input || value.subject || value.claim || value.visit || value.history)
        ctx.addIssue({ code: 'custom', message: 'QA poll cannot carry run authority.' });
      return;
    }
    const subject = value.subject,
      run = value.input?.run,
      identity = value.identity;
    if (
      !subject ||
      subject.kind !== 'qa' ||
      subject.role !== 'parent' ||
      !run ||
      !value.visit ||
      !value.history ||
      run.id !== identity.runId ||
      run.loopId !== identity.loopId ||
      run.versionId !== identity.versionId ||
      subject.repository !==
        (value.settings.repository.owner + '/' + value.settings.repository.name).toLowerCase() ||
      value.history.identity.ownerId !== identity.ownerId ||
      value.history.identity.runId !== identity.runId ||
      value.history.identity.repository !== subject.repository ||
      value.history.identity.issue !== subject.issue ||
      value.history.identity.attempt !== subject.attempt ||
      value.history.identity.pullRequest !== subject.pullRequest ||
      value.history.identity.mergeSha !== subject.mergeSha ||
      JSON.stringify(value.history.identity.source) !== JSON.stringify(subject.source) ||
      (value.claim &&
        (value.claim.repository !== subject.repository ||
          value.claim.issue !== subject.issue ||
          value.claim.attempt !== subject.attempt))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'QA needs its immutable admitted parent and authenticated history.',
      });
  });
export type QaPrivateEnvelope = z.infer<typeof QaPrivateEnvelopeSchema>;
