import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { ClockPort, SecretsPort } from '@graphgoblin/engine';
import { and, eq } from 'drizzle-orm';
import type { Database } from './db.js';
import { secrets } from './schema.js';

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** AES-256-GCM with a 32-byte master key. Output is base64(iv || tag || ciphertext). */
export function encryptSecret(masterKey: Buffer, plaintext: string): string {
  if (masterKey.length !== 32) throw new Error('master key must be 32 bytes');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, body]).toString('base64');
}

export function decryptSecret(masterKey: Buffer, encoded: string): string {
  if (masterKey.length !== 32) throw new Error('master key must be 32 bytes');
  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.length < IV_BYTES + TAG_BYTES) throw new Error('ciphertext too short');
  const iv = buffer.subarray(0, IV_BYTES);
  const tag = buffer.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const body = buffer.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

export interface SecretSummary {
  name: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Secrets are scoped to an owner. The engine resolves by name only, so one store instance is
 * bound to one owner (the API composes a store per request owner; 1.0 has a single owner).
 */
export class SqliteSecrets implements SecretsPort {
  constructor(
    private readonly db: Database,
    private readonly clock: ClockPort,
    private readonly masterKey: Buffer,
    private readonly ownerId: string,
  ) {}

  async resolve(name: string): Promise<string | undefined> {
    const row = await this.db.query.secrets.findFirst({
      where: and(eq(secrets.ownerId, this.ownerId), eq(secrets.name, name)),
    });
    return row ? decryptSecret(this.masterKey, row.ciphertext) : undefined;
  }

  async set(name: string, value: string): Promise<SecretSummary> {
    const now = this.clock.now().toISOString();
    const ciphertext = encryptSecret(this.masterKey, value);
    await this.db
      .insert(secrets)
      .values({ ownerId: this.ownerId, name, ciphertext, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [secrets.ownerId, secrets.name],
        set: { ciphertext, updatedAt: now },
      });
    const row = await this.db.query.secrets.findFirst({
      where: and(eq(secrets.ownerId, this.ownerId), eq(secrets.name, name)),
    });
    return { name, createdAt: row?.createdAt ?? now, updatedAt: now };
  }

  async delete(name: string): Promise<boolean> {
    const deleted = await this.db
      .delete(secrets)
      .where(and(eq(secrets.ownerId, this.ownerId), eq(secrets.name, name)))
      .returning({ name: secrets.name });
    return deleted.length > 0;
  }

  async list(): Promise<SecretSummary[]> {
    const rows = await this.db
      .select({ name: secrets.name, createdAt: secrets.createdAt, updatedAt: secrets.updatedAt })
      .from(secrets)
      .where(eq(secrets.ownerId, this.ownerId))
      .orderBy(secrets.name);
    return rows;
  }
}
