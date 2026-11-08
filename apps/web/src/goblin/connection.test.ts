import { describe, expect, it, vi } from 'vitest';
import { beginPairing, CredentialStorageError, readDeviceRecord } from './credentials.js';
import { capturePairingCode, claimDevice, gatewayDestination, PairingError } from './connection.js';

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

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

  it.each([
    json({}, 401),
    json({ audience: { kind: 'gateway' }, label: 'Owner' }),
    json({ audience: { kind: 'device', deviceId: '' }, label: 'Phone' }),
  ])('refuses rejected/foreign recovery and keeps pending state', async (response) => {
    const pending = beginPairing('code', 'Phone');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(response);
    await expect(claimDevice(pending, localStorage, fetcher)).rejects.toMatchObject({
      status: 401,
    });
    expect(readDeviceRecord()).toEqual(pending);
  });

  it('does not retry a server failure or leak the server response body into UI errors', async () => {
    const pending = beginPairing('code', 'Phone');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ detail: pending.deviceToken }, 500));
    await expect(claimDevice(pending, localStorage, fetcher)).rejects.toMatchObject({
      status: 500,
      code: 'PAIRING_REJECTED',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([429, 409])('reports a safe pairing refusal for %s without replay', async (status) => {
    const pending = beginPairing('code', 'Phone');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({}, status));
    await expect(claimDevice(pending, localStorage, fetcher)).rejects.toMatchObject({ status });
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
      ).rejects.toBeInstanceOf(PairingError);
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
