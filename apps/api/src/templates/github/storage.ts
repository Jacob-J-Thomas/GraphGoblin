import { lstat, mkdir, open, readFile, realpath, rename } from 'node:fs/promises';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { z } from 'zod';
import { TaskSchema, ShaSchema, fail } from './protocol.js';

export const JournalSchema = z.strictObject({
  version: z.literal(1),
  runId: z.string(),
  repository: z.string(),
  issue: z.number().int().positive(),
  attempt: z.number().int().min(1).max(3),
  branch: z.string(),
  cwd: z.string(),
  base: ShaSchema,
  title: z.string(),
  body: z.string(),
  taskIndex: z.number().int().min(0),
  mode: z.enum(['direct', 'split']).optional(),
  tasks: z.array(TaskSchema).max(32).default([]),
  task: z
    .strictObject({
      index: z.number().int().min(0),
      id: z.string(),
      branch: z.string(),
      cwd: z.string(),
      start: ShaSchema,
    })
    .optional(),
  commit: z
    .strictObject({ cwd: z.string(), parent: ShaSchema, tree: ShaSchema, message: z.string() })
    .optional(),
  merge: z.strictObject({ parent: ShaSchema, source: ShaSchema }).optional(),
  gate: z
    .strictObject({
      calls: z.number().int().min(0).max(11),
      passed: z.boolean(),
      head: ShaSchema,
      summary: z.string(),
    })
    .optional(),
  intent: z
    .strictObject({
      head: ShaSchema,
      branch: z.string(),
      title: z.string(),
      body: z.string(),
      pushed: z.boolean(),
      pullRequest: z.number().int().positive().optional(),
    })
    .optional(),
  blocked: z.boolean().default(false),
  quarantined: z.boolean().default(false),
  results: z.record(z.string(), z.unknown()).default({}),
});
export type Journal = z.infer<typeof JournalSchema>;
export const JournalIdentitySchema = z.strictObject({
  ownerId: z.string().min(1),
  runId: z.string().min(1),
  repository: z.string().min(1),
  issue: z.number().int().positive(),
  attempt: z.number().int().min(1).max(3),
});
export type JournalIdentity = z.infer<typeof JournalIdentitySchema>;
const journalDomain = 'graphgoblin.implementation-journal.v1';
const SignedJournalSchema = z.strictObject({
  domain: z.literal(journalDomain),
  identity: JournalIdentitySchema,
  payload: z.string().max(1048576),
  mac: z.string().regex(/^[a-f0-9]{64}$/),
});
function authenticatedBytes(identity: JournalIdentity, payload: string): string {
  return journalDomain + '\0' + JSON.stringify({ identity, payload });
}
export interface SupportStorage {
  canonical(path: string): Promise<string>;
  directory(root: string, path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  load(path: string): Promise<Journal | undefined>;
  save(path: string, state: Journal): Promise<void>;
  text(root: string, path: string, content: string): Promise<void>;
}
export function contained(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!isAbsolute(rel) && !rel.startsWith('..'));
}
async function noLinks(path: string): Promise<void> {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of relative(current, absolute).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) fail('PATH_LINK_REFUSED');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
  }
}
/** Only canonical, non-link paths are writable. No cleanup while a child may still write. */
export class DiskSupportStorage implements SupportStorage {
  constructor(
    private readonly credential?: string,
    private readonly identity?: JournalIdentity,
  ) {}
  private journalIdentity(): JournalIdentity {
    if (!this.credential || !this.identity) fail('JOURNAL_CREDENTIAL_REQUIRED');
    return JournalIdentitySchema.parse(this.identity);
  }
  private checkIdentity(state: Journal, identity: JournalIdentity): void {
    if (
      state.runId !== identity.runId ||
      state.repository !== identity.repository ||
      state.issue !== identity.issue ||
      state.attempt !== identity.attempt
    )
      fail('JOURNAL_IDENTITY_CONFLICT');
  }
  async canonical(path: string): Promise<string> {
    await noLinks(path);
    const result = await realpath(path);
    if (!(await lstat(result)).isDirectory()) fail('REPOSITORY_ROOT_INVALID');
    return result;
  }
  async directory(root: string, path: string): Promise<void> {
    if (!contained(root, path)) fail('PATH_OUTSIDE_ROOT');
    await noLinks(root);
    await noLinks(path);
    await mkdir(path, { recursive: true });
    await noLinks(path);
  }
  async exists(path: string): Promise<boolean> {
    await noLinks(path);
    try {
      await lstat(path);
      return true;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
      throw error;
    }
  }
  async load(path: string): Promise<Journal | undefined> {
    if (!(await this.exists(path))) return undefined;
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > 1048576) fail('JOURNAL_INVALID');
    const identity = this.journalIdentity();
    const input: unknown = JSON.parse(await readFile(path, 'utf8'));
    const signed = SignedJournalSchema.parse(input);
    if (JSON.stringify(identity) !== JSON.stringify(signed.identity))
      fail('JOURNAL_IDENTITY_CONFLICT');
    const expected = createHmac('sha256', this.credential!)
      .update(authenticatedBytes(identity, signed.payload))
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(signed.mac, 'hex')))
      fail('JOURNAL_AUTHENTICATION_REFUSED');
    const state = JournalSchema.parse(JSON.parse(signed.payload));
    this.checkIdentity(state, identity);
    return state;
  }
  private async atomic(root: string, path: string, content: string): Promise<void> {
    if (!contained(root, path) || Buffer.byteLength(content) > 1048576) fail('JOURNAL_INVALID');
    await this.directory(root, dirname(path));
    await noLinks(path);
    const temporary = path + '.' + process.pid + '.tmp';
    await noLinks(temporary);
    const file = await open(temporary, 'wx');
    try {
      await file.writeFile(content, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  }
  async save(path: string, state: Journal): Promise<void> {
    const identity = this.journalIdentity(),
      parsed = JournalSchema.parse(state);
    this.checkIdentity(parsed, identity);
    const payload = JSON.stringify(parsed);
    if (payload.includes(this.credential!)) fail('JOURNAL_SECRET_REFUSED');
    const content = JSON.stringify({
      domain: journalDomain,
      identity,
      payload,
      mac: createHmac('sha256', this.credential!)
        .update(authenticatedBytes(identity, payload))
        .digest('hex'),
    });
    await this.atomic(dirname(path), path, content);
  }
  async text(root: string, path: string, content: string): Promise<void> {
    if (this.credential && content.includes(this.credential)) fail('JOURNAL_SECRET_REFUSED');
    await this.atomic(root, path, content);
  }
}
