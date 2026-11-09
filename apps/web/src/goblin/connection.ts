import { ChatPairClaimResponseSchema, ChatSessionSchema } from '@graphgoblin/contracts';
import {
  completePairing,
  deviceStorage,
  type CredentialStorage,
  type DeviceCredential,
  type PendingPairing,
} from './credentials.js';

export type PairingOutcome = 'rejected' | 'unconfirmed';

const pairingUnconfirmedMessage =
  'Not sure pairing finished. Tap Pair again; it reuses the same request.';

export class PairingError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly outcome: PairingOutcome = 'unconfirmed',
  ) {
    super(message);
    this.name = 'PairingError';
  }
}

/** Capture and scrub before React mounts, before any authenticated call or outgoing navigation. */
export function capturePairingCode(
  location: Pick<Location, 'hash' | 'pathname' | 'search'> = window.location,
  history: Pick<History, 'replaceState' | 'state'> = window.history,
): string {
  const fragment = location.hash;
  if (fragment) history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  return new URLSearchParams(fragment.replace(/^#/, '')).get('pair')?.trim() ?? '';
}

/** A gateway switch is navigation to its own shell, never cross-origin authenticated fetch. */
export function gatewayDestination(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(
      'Enter an https:// address, like https://gateway.example.net. Plain http:// works only for localhost.',
    );
  }
  const loopback =
    url.hostname === 'localhost' ||
    url.hostname === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (
    url.username ||
    url.password ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
  )
    throw new Error(
      'Enter an https:// address, like https://gateway.example.net. Plain http:// works only for localhost.',
    );
  return `${url.origin}/goblin/`;
}

async function request(fetcher: typeof fetch, path: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(path, {
      ...init,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new PairingError(0, 'NETWORK', pairingUnconfirmedMessage);
  }
  if (!response.ok) {
    const message =
      response.status === 401
        ? 'That code didn’t work. It may be mistyped, expired or already used. Create a new pairing link on the gateway and try again.'
        : response.status === 429
          ? 'Too many pairing attempts. Wait a little, then try again.'
          : response.status >= 500
            ? pairingUnconfirmedMessage
            : 'Can’t pair right now. Check with the gateway owner and try again.';
    throw new PairingError(response.status, 'PAIRING_REJECTED', message);
  }
  try {
    return await response.json();
  } catch {
    throw new PairingError(0, 'ACKNOWLEDGEMENT_INVALID', pairingUnconfirmedMessage);
  }
}

/** Explicit user action only: the pending record already exists durably before this is called. */
export async function claimDevice(
  pending: PendingPairing,
  storage: CredentialStorage = deviceStorage(),
  fetcher: typeof fetch = fetch,
): Promise<DeviceCredential> {
  let value: unknown;
  try {
    value = await request(fetcher, '/chat/pairings/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: pending.code,
        claimId: pending.claimId,
        deviceToken: pending.deviceToken,
        label: pending.label,
      }),
    });
  } catch (error) {
    if (!(error instanceof PairingError) || error.status !== 401) throw error;
    // A completed claim can outlive its enrollment code. Authenticate the credential already
    // saved before that claim; this recovery check cannot create a second device or loop.
    let session: unknown;
    try {
      session = await request(fetcher, '/chat/session', {
        headers: { Authorization: `Bearer ${pending.deviceToken}` },
      });
    } catch (recoveryError) {
      // Only two authoritative refusals establish current rejection. An unavailable or
      // unreadable recovery response cannot prove the saved credential is unusable.
      if (recoveryError instanceof PairingError && recoveryError.status === 401)
        throw new PairingError(error.status, error.code, error.message, 'rejected');
      throw new PairingError(
        recoveryError instanceof PairingError ? recoveryError.status : 0,
        recoveryError instanceof PairingError ? recoveryError.code : 'ACKNOWLEDGEMENT_INVALID',
        pairingUnconfirmedMessage,
      );
    }
    const parsed = ChatSessionSchema.safeParse(session);
    if (!parsed.success || parsed.data.audience.kind !== 'device')
      throw new PairingError(0, 'ACKNOWLEDGEMENT_INVALID', pairingUnconfirmedMessage);
    value = { deviceId: parsed.data.audience.deviceId, label: parsed.data.label };
  }
  const parsed = ChatPairClaimResponseSchema.safeParse(value);
  if (!parsed.success)
    throw new PairingError(0, 'ACKNOWLEDGEMENT_INVALID', pairingUnconfirmedMessage);
  return completePairing(pending, parsed.data, storage);
}
