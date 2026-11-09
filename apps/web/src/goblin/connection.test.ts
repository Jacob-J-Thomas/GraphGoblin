import { describe, expect, it, vi } from 'vitest';
import { ChatSessionSchema } from '@graphgoblin/contracts';
import {
  beginPairing,
  CredentialStorageError,
  DEVICE_CREDENTIAL_KEY,
  readDeviceRecord,
} from './credentials.js';
import { capturePairingCode, claimDevice, gatewayDestination, PairingError } from './connection.js';

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const deviceSession = {
  audience: { kind: 'device', deviceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
  label: 'Renamed phone',
  readiness: { text: { ready: true }, audio: { ready: false } },
  limits: { maxTextCharacters: 16000, maxAudioBytes: 10485760 },
};

describe('gateway navigation and pairing fragment', () => {
  it('captures an opaque link code, immediately scrubs all fragment contents, and preserves page state', () => {
    const history = { replaceState: vi.fn(), state: { saved: true } };
    expect(
      capturePairingCode(
        { hash: '#pair=Case%2BSensitive%2Fcode', pathname: '/goblin/', search: '?shell=1' },
        history,
      ),
    ).toBe('Case+Sensitive/code');
    expect(history.replaceState).toHaveBeenCalledWith({ saved: true }, '', '/goblin/?shell=1');
    expect(
      capturePairingCode(
        { hash: '#unrecognised=secret', pathname: '/goblin/', search: '' },
        history,
      ),
    ).toBe('');
    history.replaceState.mockClear();
    expect(capturePairingCode({ hash: '', pathname: '/goblin/', search: '' }, history)).toBe('');
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it('supports the current browser location', () => {
    window.history.replaceState(null, '', '/goblin/#pair=abc');
    expect(capturePairingCode()).toBe('abc');
    expect(window.location.hash).toBe('');
  });

  it.each([
    'https://gateway.example/path?secret=1#code',
    'http://localhost:4747/app/',
    'http://127.0.0.5:4747',
    'http://[::1]:4747',
  ])('navigates to the gateway shell without carrying credentials or path: %s', (url) => {
    expect(gatewayDestination(url)).toBe(`${new URL(url).origin}/goblin/`);
  });

  it.each([
    'bad',
    '/relative',
    'http://gateway.example',
    'http://192.168.1.20:4747',
    'javascript:alert(1)',
    'https://user:pass@gateway.example',
    'ftp://localhost',
  ])('refuses unsafe gateway navigation: %s', (value) => {
    expect(() => gatewayDestination(value)).toThrow();
  });
});

describe('durable explicit pair claim', () => {
  it('sends only the persisted retry identity to the same-origin public claim and persists success', async () => {
    const pending = beginPairing('OpaqueCaseCode', 'Phone');
    const fetcher = vi.fn<typeof fetch>((url, init) => {
      expect(url).toBe('/chat/pairings/claim');
      expect(readDeviceRecord()).toEqual(pending);
      expect(init).toMatchObject({
        method: 'POST',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      });
      expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(JSON.parse(init?.body as string)).toEqual({
        code: pending.code,
        claimId: pending.claimId,
        deviceToken: pending.deviceToken,
        label: 'Phone',
      });
      return Promise.resolve(json({ deviceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', label: 'Phone' }));
    });
    const device = await claimDevice(pending, localStorage, fetcher);
    expect(readDeviceRecord()).toEqual(device);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps exactly the same claim/token after a lost acknowledgement and sends nothing until explicitly retried', async () => {
    const pending = beginPairing('code', 'Phone');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('secret-token'))
      .mockResolvedValueOnce(json({ deviceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', label: 'Phone' }));
    await expect(claimDevice(pending, localStorage, fetcher)).rejects.toThrow(
      'Not sure pairing finished',
    );
    expect(readDeviceRecord()).toEqual(pending);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await claimDevice(pending, localStorage, fetcher);
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(fetcher.mock.calls[1]?.[1]?.body);
  });

  it('recovers a completed claim after enrollment expiry by authenticating its already saved device token', async () => {
    const pending = beginPairing('code', 'Phone');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(
        json({
          audience: { kind: 'device', deviceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
          label: 'Renamed phone',
          readiness: { text: { ready: true }, audio: { ready: false } },
          limits: { maxTextCharacters: 16000, maxAudioBytes: 10485760 },
        }),
      );
    const device = await claimDevice(pending, localStorage, fetcher);
    expect(device).toMatchObject({
      kind: 'device',
      deviceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      deviceToken: pending.deviceToken,
      label: 'Renamed phone',
    });
    expect(fetcher.mock.calls[1]).toEqual([
      '/chat/session',
      expect.objectContaining({
        headers: { Authorization: `Bearer ${pending.deviceToken}` },
        credentials: 'omit',
      }),
    ]);
  });

  it('reports rejection only after both claim and saved credential are refused, retaining pending bytes', async () => {
    const pending = beginPairing('code', 'Phone');
    const stored = localStorage.getItem(DEVICE_CREDENTIAL_KEY);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({}, 401));
    await expect(claimDevice(pending, localStorage, fetcher)).rejects.toMatchObject({
      status: 401,
      outcome: 'rejected',
      message: expect.stringContaining('That code didn’t work.'),
    });
    expect(readDeviceRecord()).toEqual(pending);
    expect(localStorage.getItem(DEVICE_CREDENTIAL_KEY)).toBe(stored);
    expect(write).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/chat/pairings/claim',
      '/chat/session',
    ]);
  });

  it.each([
    {
      name: 'network failure',
      response: () => Promise.reject(new Error('private network detail')),
      status: 0,
    },
    {
      name: 'server failure',
      response: () => Promise.resolve(json({ detail: 'private server detail' }, 500)),
      status: 500,
    },
    {
      name: 'rate limiting',
      response: () => Promise.resolve(json({}, 429)),
      status: 429,
    },
    {
      name: 'unexpected HTTP refusal',
      response: () => Promise.resolve(json({}, 403)),
      status: 403,
    },
    {
      name: 'bad JSON',
      response: () => Promise.resolve(new Response('private malformed acknowledgement')),
      status: 0,
    },
    {
      name: 'invalid device session schema',
      response: () =>
        Promise.resolve(json({ ...deviceSession, audience: { kind: 'device', deviceId: '' } })),
      status: 0,
    },
    {
      name: 'foreign gateway audience',
      response: () => {
        const session = { ...deviceSession, audience: { kind: 'gateway' }, label: 'Owner' };
        expect(ChatSessionSchema.safeParse(session).success).toBe(true);
        return Promise.resolve(json(session));
      },
      status: 0,
    },
  ])('keeps recovery unconfirmed after claim 401 and $name', async ({ response, status }) => {
    const pending = beginPairing('code', 'Phone');
    const stored = localStorage.getItem(DEVICE_CREDENTIAL_KEY);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 401))
      .mockImplementationOnce(response);
    const attempt = claimDevice(pending, localStorage, fetcher);
    await expect(attempt).rejects.toBeInstanceOf(PairingError);
    await expect(attempt).rejects.toMatchObject({ status, outcome: 'unconfirmed' });
    await expect(attempt).rejects.toThrow(
      'Not sure pairing finished. Tap Pair again; it reuses the same request.',
    );
    await expect(attempt).rejects.not.toThrow(/private|expired|already used/);
    expect(localStorage.getItem(DEVICE_CREDENTIAL_KEY)).toBe(stored);
    expect(readDeviceRecord()).toEqual(pending);
    expect(write).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/chat/pairings/claim',
      '/chat/session',
    ]);
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      headers: { Authorization: `Bearer ${pending.deviceToken}` },
      credentials: 'omit',
    });
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('waits for explicit retry after uncertain recovery and reuses the same claim/token to recover', async () => {
    vi.useFakeTimers();
    try {
      const pending = beginPairing('code', 'Phone');
      const stored = localStorage.getItem(DEVICE_CREDENTIAL_KEY);
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json({}, 401))
        .mockResolvedValueOnce(json({}, 500))
        .mockResolvedValueOnce(json({}, 401))
        .mockResolvedValueOnce(json(deviceSession));
      expect(fetcher).not.toHaveBeenCalled();
      await expect(claimDevice(pending, localStorage, fetcher)).rejects.toMatchObject({
        outcome: 'unconfirmed',
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(localStorage.getItem(DEVICE_CREDENTIAL_KEY)).toBe(stored);
      const paired = await claimDevice(pending, localStorage, fetcher);
      expect(fetcher.mock.calls[0]?.[1]?.body).toBe(fetcher.mock.calls[2]?.[1]?.body);
      expect(fetcher.mock.calls[1]?.[1]?.headers).toEqual(fetcher.mock.calls[3]?.[1]?.headers);
      expect(paired).toMatchObject({
        kind: 'device',
        deviceToken: pending.deviceToken,
        deviceId: deviceSession.audience.deviceId,
      });
      expect(readDeviceRecord()).toEqual(paired);
      expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
        '/chat/pairings/claim',
        '/chat/session',
        '/chat/pairings/claim',
        '/chat/session',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry a server failure or leak the server response body into UI errors', async () => {
    const pending = beginPairing('code', 'Phone');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ detail: pending.deviceToken }, 500));
    await expect(claimDevice(pending, localStorage, fetcher)).rejects.toMatchObject({
      status: 500,
      code: 'PAIRING_REJECTED',
      outcome: 'unconfirmed',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([429, 409])('reports a safe pairing refusal for %s without replay', async (status) => {
    const pending = beginPairing('code', 'Phone');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({}, status));
    await expect(claimDevice(pending, localStorage, fetcher)).rejects.toMatchObject({
      status,
      outcome: 'unconfirmed',
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(readDeviceRecord()).toEqual(pending);
  });

  it.each([
    new Response('bad-json'),
    json({ deviceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', label: 'Phone', token: 'unexpected' }),
  ])(
    'preserves the pending identity when acknowledgement cannot be validated',
    async (response) => {
      const pending = beginPairing('code', 'Phone');
      await expect(
        claimDevice(pending, localStorage, vi.fn<typeof fetch>().mockResolvedValue(response)),
      ).rejects.toMatchObject({ outcome: 'unconfirmed' });
      expect(readDeviceRecord()).toEqual(pending);
    },
  );

  it('preserves pending state if durable success storage fails after a valid acknowledgement', async () => {
    const pending = beginPairing('code', 'Phone');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await expect(
      claimDevice(
        pending,
        localStorage,
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(json({ deviceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', label: 'Phone' })),
      ),
    ).rejects.toBeInstanceOf(CredentialStorageError);
    expect(readDeviceRecord()).toEqual(pending);
  });

  it('uses global fetch by default', async () => {
    const pending = beginPairing('code', 'Phone');
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(json({ deviceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', label: 'Phone' }));
    await claimDevice(pending);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
