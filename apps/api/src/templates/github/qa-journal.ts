import { createHmac, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { qaDigest } from './qa-protocol.js';
import { ShaSchema } from './protocol.js';
import {
  QaIdentitySchema,
  QaScopeSchema,
  QaOriginalIssueSchema,
  QaCriteriaSchema,
  QaProofSnapshotSchema,
  QaAdversarySchema,
  QaOutputSchema,
  qaFail,
  qaScan,
  type QaIdentity,
} from './qa-protocol.js';

export const QaStateSchema = z.strictObject({
  identity: QaIdentitySchema,
  preparedVisit: z.string().optional(),
  criteriaVisit: z.string().optional(),
  prepared: z
    .strictObject({
      cwd: z.string().max(4096),
      artifactRoot: z.string().max(4096),
      scope: QaScopeSchema,
      originalIssue: QaOriginalIssueSchema,
      diff: z.string().max(64000),
      prBody: z.string().max(32000),
    })
    .optional(),
  criteria: QaCriteriaSchema.optional(),
  snapshot: QaProofSnapshotSchema.optional(),
  proof: z
    .strictObject({
      key: z.string(),
      parent: ShaSchema.nullable(),
      commit: ShaSchema.nullable(),
      pushes: z.number().int().min(0).max(3),
      pushStarted: z.boolean(),
      published: z.boolean(),
      uncertain: z.boolean(),
    })
    .optional(),
  adversary: QaAdversarySchema.optional(),
  reruns: z.number().int().min(0).max(1).default(0),
  reservation: z
    .strictObject({
      key: z.string(),
      request: z.number().int().min(1).max(2).nullable(),
      requiresReopen: z.boolean().nullable(),
      reopen: z.enum(['none', 'intent', 'complete']),
      relabel: z.enum(['none', 'intent', 'complete']),
    })
    .optional(),
  report: z
    .strictObject({ key: z.string(), started: z.boolean(), complete: z.boolean() })
    .optional(),
  outcome: z.enum(['passed', 'rework', 'blocked']).optional(),
  results: z
    .record(z.string(), QaOutputSchema)
    .refine((value) => Object.keys(value).length <= 128)
    .default({}),
});
export type QaState = z.infer<typeof QaStateSchema>;
export interface QaJournal {
  load(identity: QaIdentity): Promise<QaState | undefined>;
  save(identity: QaIdentity, state: QaState): Promise<void>;
}
/** The same structural bounded text/atomic-write boundary as DiskSupportStorage. */
export interface QaJournalFiles {
  canonical(path: string): Promise<string>;
  read(path: string): Promise<string | undefined>;
  text(root: string, path: string, value: string): Promise<void>;
}
const domain = 'graphgoblin.qa-journal.v1';
const Signed = z.strictObject({
  domain: z.literal(domain),
  identity: QaIdentitySchema,
  payload: z.string().max(1048576),
  mac: z.string().regex(/^[a-f0-9]{64}$/),
});
export function qaIdentityKey(identity: QaIdentity): string {
  return qaDigest(QaIdentitySchema.parse(identity));
}
export function encodeQaState(
  identity: QaIdentity,
  state: QaState,
  credential: string,
  secrets: readonly string[] = [],
): string {
  if (!credential) qaFail('QA_JOURNAL_CREDENTIAL');
  const checked = QaStateSchema.parse(state);
  if (qaIdentityKey(checked.identity) !== qaIdentityKey(identity)) qaFail('QA_JOURNAL_IDENTITY');
  qaScan(checked, [credential, ...secrets]);
  const payload = JSON.stringify(checked);
  const mac = createHmac('sha256', credential)
    .update(domain + '\0' + JSON.stringify({ identity: QaIdentitySchema.parse(identity), payload }))
    .digest('hex');
  const result = JSON.stringify({ domain, identity, payload, mac });
  if (Buffer.byteLength(result) > 1048576) qaFail('QA_JOURNAL_BOUND');
  return result;
}
export function decodeQaState(identity: QaIdentity, text: string, credential: string): QaState {
  if (!credential || Buffer.byteLength(text) > 1048576) qaFail('QA_JOURNAL_BOUND');
  const signed = Signed.parse(JSON.parse(text));
  if (qaIdentityKey(signed.identity) !== qaIdentityKey(identity)) qaFail('QA_JOURNAL_IDENTITY');
  const expected = createHmac('sha256', credential)
    .update(
      domain +
        '\0' +
        JSON.stringify({ identity: QaIdentitySchema.parse(identity), payload: signed.payload }),
    )
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(signed.mac, 'hex')))
    qaFail('QA_JOURNAL_AUTHENTICATION');
  const state = QaStateSchema.parse(JSON.parse(signed.payload));
  if (qaIdentityKey(state.identity) !== qaIdentityKey(identity)) qaFail('QA_JOURNAL_IDENTITY');
  return state;
}
/** Journal roots/credential are injected trusted composition data, never thread paths. */
export class SignedQaJournal implements QaJournal {
  constructor(
    private readonly files: QaJournalFiles,
    private readonly root: string,
    private readonly credential: string,
    private readonly secrets: readonly string[] = [],
  ) {}
  private async path(identity: QaIdentity) {
    const root = await this.files.canonical(this.root);
    return { root, path: join(root, qaIdentityKey(identity) + '.qa.json') };
  }
  async load(identity: QaIdentity) {
    const { path } = await this.path(identity),
      text = await this.files.read(path);
    return text === undefined ? undefined : decodeQaState(identity, text, this.credential);
  }
  async save(identity: QaIdentity, state: QaState) {
    const { root, path } = await this.path(identity);
    await this.files.text(
      root,
      path,
      encodeQaState(identity, state, this.credential, this.secrets),
    );
  }
}
