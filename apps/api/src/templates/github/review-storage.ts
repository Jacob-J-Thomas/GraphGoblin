import { createHmac, timingSafeEqual } from 'node:crypto';
import { dirname } from 'node:path';
import { z } from 'zod';
import { JsonValueSchema } from '@graphgoblin/contracts';
import type { DiskSupportStorage } from './storage.js';
import { ShaSchema, fail } from './protocol.js';
import {
  ReviewIdentitySchema,
  ReviewProposalSchema,
  type ReviewIdentity,
} from './review-protocol.js';

const Commit = z.strictObject({
  cwd: z.string(),
  parent: ShaSchema,
  tree: ShaSchema,
  message: z.string(),
});
export const ReviewJournalSchema = z.strictObject({
  version: z.literal(1),
  head: ShaSchema,
  cwd: z.string(),
  branch: z.string(),
  ref: z.string(),
  humanRequired: z.boolean(),
  automaticCycles: z.number().int().min(0).max(3).default(0),
  extraCycles: z.number().int().min(0).max(3).default(0),
  reminders: z.number().int().min(0).max(3).default(0),
  inputSeq: z.number().int().min(0).default(0),
  timeoutSeq: z.number().int().min(0).default(0),
  extraPending: z.boolean().default(false),
  fixPending: z.boolean().default(false),
  quarantined: z.boolean().default(false),
  gateCalls: z.number().int().min(0).max(6).default(0),
  pendingGate: z.strictObject({ head: ShaSchema, visit: z.number().int().positive() }).optional(),
  gate: z
    .strictObject({
      head: ShaSchema,
      passed: z.boolean(),
      checks: z.boolean(),
      summary: z.string(),
    })
    .optional(),
  verdict: z.strictObject({ head: ShaSchema, proposal: ReviewProposalSchema }).optional(),
  commit: Commit.optional(),
  push: z
    .strictObject({
      parent: ShaSchema,
      head: ShaSchema,
      ref: z.string(),
      visit: z.number().int().positive(),
    })
    .optional(),
  authorization: z
    .strictObject({
      kind: z.enum(['automatic', 'human', 'close']),
      head: ShaSchema,
      inputSeq: z.number().int().positive().optional(),
    })
    .optional(),
  merge: z
    .strictObject({ head: ShaSchema, method: z.enum(['merge', 'squash', 'rebase']) })
    .optional(),
  close: z.strictObject({ head: ShaSchema }).optional(),
  results: z.record(z.string(), JsonValueSchema).default({}),
  notices: z
    .record(
      z.string(),
      z.strictObject({
        body: z.string().max(65536),
        issue: z.boolean(),
        prDone: z.boolean().default(false),
        issueDone: z.boolean().default(false),
      }),
    )
    .default({}),
});
export type ReviewJournal = z.infer<typeof ReviewJournalSchema>;
export type ArtifactFiles = Pick<
  DiskSupportStorage,
  'canonical' | 'directory' | 'exists' | 'read' | 'text'
>;
export interface ReviewJournalPort {
  load(path: string): Promise<ReviewJournal | undefined>;
  save(path: string, state: ReviewJournal): Promise<void>;
}
const domain = 'graphgoblin.review-journal.v1';
const Envelope = z.strictObject({
  domain: z.literal(domain),
  identity: ReviewIdentitySchema,
  payload: z.string().max(1048576),
  mac: z.string().regex(/^[a-f0-9]{64}$/),
});
export class SignedReviewJournal implements ReviewJournalPort {
  constructor(
    private readonly files: ArtifactFiles,
    private readonly credential: string,
    private readonly identity: ReviewIdentity,
  ) {}
  private bytes(payload: string) {
    return (
      domain +
      '\0' +
      JSON.stringify({ identity: ReviewIdentitySchema.parse(this.identity), payload })
    );
  }
  async load(path: string) {
    const content = await this.files.read(path);
    if (content === undefined) return undefined;
    if (!this.credential) fail('JOURNAL_CREDENTIAL_REQUIRED');
    const envelope = Envelope.parse(JSON.parse(content));
    if (
      JSON.stringify(envelope.identity) !==
      JSON.stringify(ReviewIdentitySchema.parse(this.identity))
    )
      fail('JOURNAL_IDENTITY_CONFLICT');
    const mac = createHmac('sha256', this.credential).update(this.bytes(envelope.payload)).digest();
    if (!timingSafeEqual(mac, Buffer.from(envelope.mac, 'hex')))
      fail('JOURNAL_AUTHENTICATION_REFUSED');
    return ReviewJournalSchema.parse(JSON.parse(envelope.payload));
  }
  async save(path: string, state: ReviewJournal) {
    if (!this.credential) fail('JOURNAL_CREDENTIAL_REQUIRED');
    const payload = JSON.stringify(ReviewJournalSchema.parse(state));
    if (payload.includes(this.credential)) fail('JOURNAL_SECRET_REFUSED');
    await this.files.text(
      dirname(path),
      path,
      JSON.stringify({
        domain,
        identity: ReviewIdentitySchema.parse(this.identity),
        payload,
        mac: createHmac('sha256', this.credential).update(this.bytes(payload)).digest('hex'),
      }),
    );
  }
}
