import { z } from 'zod';
import { ChatPairClaimRequestSchema, ChatPairClaimResponseSchema } from '@graphgoblin/contracts';

/** Never share this key with the management application's owner API key. */
export const DEVICE_CREDENTIAL_KEY = 'graphgoblin.goblin.device.v1';
export const GOBLIN_CHAT_STORAGE_KEY = 'graphgoblin.goblin.chat.v1';

const token = ChatPairClaimRequestSchema.shape.deviceToken;
const label = z.string().trim().min(1).max(80);
const pendingSchema = z
  .object({
    kind: z.literal('pending'),
    code: z.string().min(1).max(512),
    claimId: z.uuid(),
    deviceToken: token,
    label,
  })
  .strict();
const deviceSchema = z
  .object({
    kind: z.literal('device'),
    deviceId: ChatPairClaimResponseSchema.shape.deviceId,
    deviceToken: token,
    label,
  })
  .strict();
const recordSchema = z.discriminatedUnion('kind', [pendingSchema, deviceSchema]);

export type PendingPairing = z.infer<typeof pendingSchema>;
export type DeviceCredential = z.infer<typeof deviceSchema>;
export type DeviceRecord = z.infer<typeof recordSchema>;
export type CredentialStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export class CredentialStorageError extends Error {
  constructor() {
    super(
      'This browser can’t save the pairing, so Goblin can’t pair here. Allow site storage or leave private browsing, then try again.',
    );
    this.name = 'CredentialStorageError';
  }
}

export function deviceStorage(): CredentialStorage {
  try {
    return localStorage;
  } catch {
    throw new CredentialStorageError();
  }
}

function draftStorage(): Pick<Storage, 'removeItem'> {
  try {
    return sessionStorage;
  } catch {
    throw new CredentialStorageError();
  }
}

export function readDeviceRecord(
  storage: CredentialStorage = deviceStorage(),
): DeviceRecord | undefined {
  let raw: string | null;
  try {
    raw = storage.getItem(DEVICE_CREDENTIAL_KEY);
  } catch {
    throw new CredentialStorageError();
  }
  if (raw === null) return undefined;
  try {
    const parsed = recordSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function writeRecord(record: DeviceRecord, storage: CredentialStorage): void {
  try {
    // One atomic localStorage write keeps the retry identity and credential together. If this
    // fails, no claim request is allowed to leave the browser.
    storage.setItem(DEVICE_CREDENTIAL_KEY, JSON.stringify(record));
  } catch {
    throw new CredentialStorageError();
  }
}

export function beginPairing(
  code: string,
  deviceLabel: string,
  storage: CredentialStorage = deviceStorage(),
  random: Pick<Crypto, 'getRandomValues' | 'randomUUID'> = crypto,
): PendingPairing {
  const cleanCode = z.string().trim().min(1).max(512).parse(code);
  const cleanLabel = label.parse(deviceLabel);
  const existing = readDeviceRecord(storage);
  if (existing?.kind === 'pending' && existing.code === cleanCode) return existing;
  const bytes = random.getRandomValues(new Uint8Array(32));
  const encoded = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  const record: PendingPairing = {
    kind: 'pending',
    code: cleanCode,
    label: cleanLabel,
    claimId: random.randomUUID(),
    deviceToken: `ggd_${encoded}`,
  };
  writeRecord(record, storage);
  return record;
}

export function completePairing(
  pending: PendingPairing,
  device: { deviceId: string; label: string },
  storage: CredentialStorage = deviceStorage(),
): DeviceCredential {
  const record = deviceSchema.parse({
    kind: 'device',
    ...device,
    deviceToken: pending.deviceToken,
  });
  writeRecord(record, storage);
  return record;
}

/** Sign-out removes only this peripheral's credential and unsent/recovery state. */
export function forgetDevice(
  storage: CredentialStorage = deviceStorage(),
  drafts: Pick<Storage, 'removeItem'> = draftStorage(),
): void {
  try {
    storage.removeItem(DEVICE_CREDENTIAL_KEY);
    drafts.removeItem(GOBLIN_CHAT_STORAGE_KEY);
  } catch {
    throw new CredentialStorageError();
  }
}
