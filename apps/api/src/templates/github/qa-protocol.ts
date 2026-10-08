import { z } from 'zod';
import { createHash } from 'node:crypto';
import { stableStringify } from '@graphgoblin/domain';
import { ContextThreadSchema, QaTemplateSettingsSchema, UlidSchema } from '@graphgoblin/contracts';
import {
  ClaimRecordSchema,
  IssueReopenedSchema,
  QaOutcomeSchema,
  QaReworkRequestSchema,
} from '../authority.js';
import { SubjectSourceSchema } from '../subjects.js';
import { ShaSchema } from './protocol.js';

export function qaDigest(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

const Text = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0);
const Id = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
export const QaActionSchema = z.enum([
  'poll',
  'claim',
  'prerequisites',
  'prepare',
  'criteria-check',
  'proof-check',
  'evidence-prepare',
  'adversary-check',
  'rework-status',
  'qa-rework',
  'issue-reopened',
  'relabel',
  'rerun-prepare',
  'human',
  'qa-outcome',
  'block',
]);
export type QaAction = z.infer<typeof QaActionSchema>;
export const QaIdentitySchema = z
  .strictObject({
    ownerId: Text.max(200),
    runId: UlidSchema,
    repository: z.string().regex(/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/),
    issue: z.number().int().positive(),
    attempt: z.number().int().min(1).max(3),
    pullRequest: z.number().int().positive(),
    mergeSha: ShaSchema,
    source: SubjectSourceSchema,
  })
  .refine(
    (value) => value.source.kind !== 'external' || value.attempt === 1,
    'External originals start at attempt one.',
  );
export type QaIdentity = z.infer<typeof QaIdentitySchema>;
/** Only the private API decorator may construct this envelope from immutable binding/events. */
export const QaEnvelopeSchema = z
  .strictObject({
    settings: QaTemplateSettingsSchema,
    identity: QaIdentitySchema,
    nodeId: Text.max(200),
    startedSeq: z.number().int().positive(),
    visit: z.number().int().positive(),
    input: ContextThreadSchema,
    claim: ClaimRecordSchema.nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.settings.proofBranch === value.settings.repository.baseBranch)
      ctx.addIssue({ code: 'custom', message: 'Proofs require a dedicated branch.' });
    const identity = value.identity;
    if (
      value.input.run.id !== identity.runId ||
      identity.repository !==
        (value.settings.repository.owner + '/' + value.settings.repository.name).toLowerCase() ||
      (value.claim &&
        (value.claim.repository !== identity.repository ||
          value.claim.issue !== identity.issue ||
          value.claim.attempt !== identity.attempt))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'QA needs the exact admitted subject and authenticated claim.',
      });
  });
export type QaEnvelope = z.infer<typeof QaEnvelopeSchema>;
export const QaCriterionSchema = z.strictObject({
  id: Id,
  system: Text.max(120),
  source: z.enum(['issue', 'touched', 'application']),
  scenario: Text.max(1000),
  polarity: z.enum(['positive', 'negative']),
  steps: z.array(Text.max(1000)).min(1).max(12),
  expected: Text.max(2000),
});
export const QaCriteriaSchema = z.strictObject({
  depth: z.enum(['standard', 'full-regression']),
  touchedSystems: z.array(Text.max(120)).min(1).max(32),
  applicationSystems: z.array(Text.max(120)).max(32),
  criteria: z.array(QaCriterionSchema).min(2).max(64),
});
export type QaCriteria = z.infer<typeof QaCriteriaSchema>;
export const QaRelativePathSchema = z
  .string()
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)
  .refine(
    (value) =>
      value
        .split('/')
        .every(
          (part) =>
            part &&
            part !== '.' &&
            part !== '..' &&
            !part.endsWith('.') &&
            !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
        ),
    'Portable regular-file paths only.',
  );
export const QaResultsSchema = z.strictObject({
  summary: Text.max(4000),
  results: z
    .array(
      z.strictObject({
        criterionId: Id,
        status: z.enum(['passed', 'failed']),
        observed: Text.max(2000),
        evidence: z
          .array(z.strictObject({ path: QaRelativePathSchema, description: Text.max(1000) }))
          .min(1)
          .max(8),
      }),
    )
    .min(1)
    .max(64),
});
export type QaResults = z.infer<typeof QaResultsSchema>;
export const QaAdversarySchema = z
  .strictObject({
    sound: z.boolean(),
    summary: Text.max(4000),
    gaps: z.array(z.strictObject({ criterionId: Id.nullable(), message: Text.max(2000) })).max(32),
  })
  .refine(
    (value) => !value.sound || value.gaps.length === 0,
    'A sound verdict cannot report gaps.',
  );
export type QaAdversary = z.infer<typeof QaAdversarySchema>;
export const QaOriginalIssueSchema = z.strictObject({
  number: z.number().int().positive(),
  title: Text.max(4000),
  body: Text.max(32000),
});
export const QaScopeSchema = z.strictObject({
  depth: z.enum(['standard', 'full-regression']),
  touchedSystems: z.array(Text.max(120)).min(1).max(32),
  applicationSystems: z.array(Text.max(120)).max(32),
});
export type QaScope = z.infer<typeof QaScopeSchema>;
export const QaArtifactSchema = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  relativePath: QaRelativePathSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  encoding: z.enum(['utf8', 'base64']),
  content: z.string().max(350000),
});
export const QaPacketSchema = z.strictObject({
  originalIssue: QaOriginalIssueSchema,
  criteria: QaCriteriaSchema,
  results: QaResultsSchema,
  artifacts: z.array(QaArtifactSchema).min(1).max(512),
});
export type QaPacket = z.infer<typeof QaPacketSchema>;
export const QaProofSnapshotSchema = z.strictObject({
  identity: QaIdentitySchema,
  packet: QaPacketSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type QaProofSnapshot = z.infer<typeof QaProofSnapshotSchema>;
export const QaOutputSchema = z.union([
  ClaimRecordSchema,
  QaReworkRequestSchema,
  IssueReopenedSchema,
  QaOutcomeSchema,
  z.strictObject({
    type: z.literal('QaPrerequisites'),
    available: z.boolean(),
    code: Text.max(80),
    remediation: Text.max(1000),
  }),
  z.strictObject({
    type: z.literal('QaWorkspace'),
    repository: Text,
    issue: z.number().int().positive(),
    attempt: z.number().int().min(1).max(3),
    pullRequest: z.number().int().positive(),
    mergeSha: ShaSchema,
    cwd: Text.max(4096),
    originalIssue: QaOriginalIssueSchema,
    depth: QaScopeSchema.shape.depth,
    diff: z.string().max(64000),
    prBody: z.string().max(32000),
  }),
  z.strictObject({ type: z.literal('QaCriteria'), value: QaCriteriaSchema }),
  z.strictObject({
    type: z.literal('QaProof'),
    passed: z.boolean(),
    runId: UlidSchema,
    mergeSha: ShaSchema,
    proofCommit: ShaSchema,
    links: z.array(z.string().url()).min(1).max(512),
  }),
  z.strictObject({
    type: z.literal('QaEvidence'),
    evidence: z.strictObject({ workspace: Text.max(4096), packet: QaPacketSchema }),
  }),
  z.strictObject({
    type: z.literal('QaNext'),
    route: z.enum(['passed', 'rework', 'rerun', 'human']),
  }),
  z.strictObject({
    type: z.literal('QaReworkEligibility'),
    eligible: z.boolean(),
    requiresReopen: z.boolean(),
  }),
  z.strictObject({ type: z.literal('QaRelabeled') }),
  z.strictObject({ type: z.literal('QaRerun'), gaps: QaAdversarySchema.shape.gaps }),
  z.strictObject({
    type: z.literal('QaHumanRequired'),
    code: Text.max(80),
    message: Text.max(1000),
  }),
  z.strictObject({ type: z.literal('QaBlocked'), code: Text.max(80), message: Text.max(1000) }),
  z.strictObject({
    type: z.literal('SupportBlocked'),
    code: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/),
    message: z.literal('Support stopped safely; inspect the recorded support code.'),
  }),
]);
export type QaOutput = z.infer<typeof QaOutputSchema>;
export class QaFailure extends Error {
  constructor(readonly code: string) {
    super('QA support refused: ' + code);
  }
}
export function qaFail(code: string): never {
  throw new QaFailure(code);
}
export function qaBlocked(code: string): QaOutput {
  return {
    type: 'SupportBlocked',
    code,
    message: 'Support stopped safely; inspect the recorded support code.',
  };
}
export function qaScan(value: unknown, secrets: readonly string[]): void {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (Buffer.byteLength(text) > 4 * 1048576) qaFail('QA_OUTPUT_BOUND');
  if (secrets.some((secret) => secret.length > 0 && text.includes(secret)))
    qaFail('QA_SECRET_REFUSED');
}
export function validateQaCriteria(input: unknown, scope: QaScope): QaCriteria {
  const criteria = QaCriteriaSchema.parse(input),
    checked = QaScopeSchema.parse(scope);
  const same = (a: readonly string[], b: readonly string[]) =>
    new Set(a).size === a.length &&
    new Set(b).size === b.length &&
    a.length === b.length &&
    a.every((item) => b.includes(item));
  if (
    criteria.depth !== checked.depth ||
    !same(criteria.touchedSystems, checked.touchedSystems) ||
    !same(criteria.applicationSystems, checked.applicationSystems) ||
    new Set(criteria.criteria.map((item) => item.id)).size !== criteria.criteria.length
  )
    qaFail('QA_CRITERIA_SCOPE');
  const covers = (source: 'issue' | 'touched' | 'application', system?: string) =>
    ['positive', 'negative'].every((polarity) =>
      criteria.criteria.some(
        (item) =>
          item.source === source &&
          item.polarity === polarity &&
          (system === undefined || item.system === system),
      ),
    );
  if (
    !covers('issue') ||
    checked.touchedSystems.some((system) => !covers('touched', system)) ||
    (checked.depth === 'full-regression' &&
      (!checked.applicationSystems.length ||
        checked.applicationSystems.some((system) => !covers('application', system))))
  )
    qaFail('QA_CRITERIA_COVERAGE');
  if (
    criteria.criteria.some((item) =>
      item.source === 'touched'
        ? !checked.touchedSystems.includes(item.system)
        : item.source === 'application'
          ? !checked.applicationSystems.includes(item.system)
          : false,
    )
  )
    qaFail('QA_CRITERIA_SCOPE');
  return criteria;
}
