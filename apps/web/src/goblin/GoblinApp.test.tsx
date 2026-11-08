import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatSurfaceProps } from '../chat/ChatSurface.js';
const surfaces = vi.hoisted(() => vi.fn());
vi.mock('../chat/ChatSurface.js', () => ({
  ChatSurface: (props: ChatSurfaceProps) => {
    surfaces(props);
    return (
      <div>
        Shared chat
        <ButtonForAuth onClick={props.onAuthenticationError} />
      </div>
    );
  },
}));
function ButtonForAuth({ onClick }: { onClick?: (() => void) | undefined }) {
  return <button onClick={onClick}>Simulate lost access</button>;
}
import { GoblinApp } from './GoblinApp.js';
import {
  beginPairing,
  completePairing,
  DEVICE_CREDENTIAL_KEY,
  GOBLIN_CHAT_STORAGE_KEY,
  readDeviceRecord,
} from './credentials.js';

const deviceId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
function pair() {
  return completePairing(beginPairing('CaseCode', 'Phone'), { deviceId, label: 'Phone' });
}
function session(kind: 'device' | 'gateway' = 'device') {
  return new Response(
    JSON.stringify({
      audience: kind === 'device' ? { kind, deviceId } : { kind },
      label: 'Kitchen tablet',
      readiness: { text: { ready: true }, audio: { ready: false } },
      limits: { maxTextCharacters: 16000, maxAudioBytes: 10485760 },
    }),
  );
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('standalone Goblin shell', () => {
  it('shows pairing without making an unauthenticated session request', () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    render(<GoblinApp initialCode="" />);
    expect(screen.getByRole('heading')).toHaveTextContent('Pair this device');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('embeds the shared surface using only the separate device token and exact draft key', async () => {
    const device = pair();
    localStorage.setItem('graphgoblin-api-key', 'owner-secret');
    const get = vi.spyOn(Storage.prototype, 'getItem');
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(session()));
    render(<GoblinApp initialCode="" />);
    await screen.findByText('Connected');
    expect(screen.getByText('Shared chat')).toBeVisible();
    expect(surfaces).toHaveBeenCalledWith(
      expect.objectContaining({ storageKey: GOBLIN_CHAT_STORAGE_KEY }),
    );
    expect(surfaces.mock.lastCall?.[0]).not.toHaveProperty('owner');
    expect(fetcher).toHaveBeenCalledWith(
      '/chat/session',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      `Bearer ${device.deviceToken}`,
    );
    expect(get.mock.calls.every(([key]) => key === DEVICE_CREDENTIAL_KEY)).toBe(true);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Gateway' }));
    expect(screen.getByRole('dialog', { name: 'Gateway' })).toBeVisible();
    expect(screen.getByText('Kitchen tablet')).toBeVisible();
    expect(screen.getByText(window.location.origin)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Check connection' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('dialog', { hidden: true })).not.toHaveAttribute('open');
  });

  it('signs out locally after confirmation, clears its own unsent state, and makes no revoke request', async () => {
    pair();
    sessionStorage.setItem(GOBLIN_CHAT_STORAGE_KEY, 'draft');
    localStorage.setItem('owner-key', 'owner-secret');
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(session()));
    render(<GoblinApp initialCode="" />);
    await screen.findByText('Connected');
    fireEvent.click(screen.getByRole('button', { name: 'Gateway' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out on this device' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(readDeviceRecord()?.kind).toBe('device');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out on this device' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading')).toHaveTextContent('Pair this device');
    expect(screen.getByText(/Signed out on this device/)).toBeVisible();
    expect(readDeviceRecord()).toBeUndefined();
    expect(sessionStorage.getItem(GOBLIN_CHAT_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('owner-key')).toBe('owner-secret');
    expect(
      fetcher.mock.calls.every(([url, init]) => url === '/chat/session' && init?.method === 'GET'),
    ).toBe(true);
  });

  it('clears local access and recovery state after a generic 401', async () => {
    pair();
    sessionStorage.setItem(GOBLIN_CHAT_STORAGE_KEY, 'uncertain');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
    render(<GoblinApp initialCode="" />);
    expect(
      await screen.findByRole('heading', { name: 'This device no longer has access' }),
    ).toBeVisible();
    expect(readDeviceRecord()).toBeUndefined();
    expect(sessionStorage.getItem(GOBLIN_CHAT_STORAGE_KEY)).toBeNull();
    expect(screen.queryByText('Shared chat')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pair again' }));
    expect(screen.getByRole('heading')).toHaveTextContent('Pair this device');
  });

  it('rejects a gateway audience and receives shared surface authentication errors', async () => {
    pair();
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(session('gateway')));
    render(<GoblinApp initialCode="" />);
    expect(
      await screen.findByRole('heading', { name: 'This device no longer has access' }),
    ).toBeVisible();
  });

  it('handles shared surface authentication failure independently of shell status', async () => {
    pair();
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(session()));
    render(<GoblinApp initialCode="" />);
    await screen.findByText('Connected');
    fireEvent.click(screen.getByRole('button', { name: 'Simulate lost access' }));
    expect(screen.getByRole('heading')).toHaveTextContent('This device no longer has access');
  });

  it('preserves credentials through network failure and rechecks only GET on visibility recovery', async () => {
    pair();
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('network'))
      .mockImplementation(() => Promise.resolve(session()));
    render(<GoblinApp initialCode="" />);
    await waitFor(() =>
      expect(screen.getByTestId('goblin-status')).toHaveTextContent('Can’t reach gateway'),
    );
    expect(readDeviceRecord()?.kind).toBe('device');
    fireEvent(document, new Event('visibilitychange'));
    await screen.findByText('Connected');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });

  it('does not probe while offline and resumes reads after reconnect', async () => {
    pair();
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(session()));
    render(<GoblinApp initialCode="" />);
    expect(screen.getAllByText('Offline')[0]).toBeVisible();
    expect(fetcher).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    fireEvent(window, new Event('online'));
    await screen.findByText('Connected');
    online.mockReturnValue(false);
    fireEvent(window, new Event('offline'));
    expect(screen.getAllByText('Offline')[0]).toBeVisible();
  });

  it('follows device credential changes and clears this tab’s draft on another tab’s sign-out', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(session()));
    render(<GoblinApp initialCode="" />);
    fireEvent(window, new StorageEvent('storage', { key: 'unrelated' }));
    expect(fetcher).not.toHaveBeenCalled();
    pair();
    fireEvent(window, new StorageEvent('storage', { key: DEVICE_CREDENTIAL_KEY }));
    await screen.findByText('Connected');
    sessionStorage.setItem(GOBLIN_CHAT_STORAGE_KEY, 'draft');
    localStorage.removeItem(DEVICE_CREDENTIAL_KEY);
    fireEvent(window, new StorageEvent('storage', { key: null }));
    expect(screen.getByRole('heading')).toHaveTextContent('Pair this device');
    expect(sessionStorage.getItem(GOBLIN_CHAT_STORAGE_KEY)).toBeNull();
  });

  it('stops using a credential removed in another tab even if this tab cannot clear its draft', async () => {
    pair();
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(session()));
    render(<GoblinApp initialCode="" />);
    await screen.findByText('Connected');
    localStorage.removeItem(DEVICE_CREDENTIAL_KEY);
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    fireEvent(window, new StorageEvent('storage', { key: DEVICE_CREDENTIAL_KEY }));
    expect(screen.getByRole('heading')).toHaveTextContent('Pair this device');
    expect(screen.getByText(/Allow site storage/)).toBeVisible();
    remove.mockRestore();
  });

  it('permits a new pairing link to replace an existing connection only after a tap', async () => {
    const existing = pair();
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((url) =>
        Promise.resolve(
          url === '/chat/pairings/claim'
            ? new Response(JSON.stringify({ deviceId, label: 'New phone' }))
            : session(),
        ),
      );
    render(<GoblinApp initialCode={'B'.repeat(42) + 'A'} />);
    expect(screen.getByRole('heading')).toHaveTextContent('This device is already paired');
    expect(readDeviceRecord()).toEqual(existing);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out and pair' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Pair this browser instead' }));
    await screen.findByLabelText('Device name');
    fireEvent.change(screen.getByLabelText('Device name'), { target: { value: 'New phone' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pair this browser' }));
    await screen.findByText('Shared chat');
    expect(readDeviceRecord()).toMatchObject({ kind: 'device', label: 'New phone' });
    expect(fetcher.mock.calls.some(([url]) => url === '/chat/pairings/claim')).toBe(true);
  });

  it('restores an uncertain enrollment without automatically claiming it', () => {
    beginPairing('CaseCode', 'Phone');
    const fetcher = vi.spyOn(globalThis, 'fetch');
    render(<GoblinApp initialCode="" />);
    expect(screen.getByRole('button', { name: 'Retry pairing' })).toBeVisible();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('offers only real browser installation prompts and explains a failed prompt', async () => {
    pair();
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(session()));
    render(<GoblinApp initialCode="" />);
    await screen.findByText('Connected');
    const prompt = vi.fn(() => Promise.reject(new Error('browser refused')));
    fireEvent(
      window,
      Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    expect(
      await screen.findByText('Use your browser’s install option to install Goblin.'),
    ).toBeVisible();
    fireEvent(
      window,
      Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Gateway' }));
    fireEvent.click(screen.getByRole('button', { name: 'Install Goblin' }));
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(2));
  });

  it('shows an actionable storage error without using owner credentials', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    render(<GoblinApp initialCode="" />);
    expect(screen.getByText(/Allow site storage/)).toBeVisible();
  });

  it('retains the connection if sign-out cannot remove browser storage', async () => {
    pair();
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(session()));
    render(<GoblinApp initialCode="" />);
    await screen.findByText('Connected');
    fireEvent.click(screen.getByRole('button', { name: 'Gateway' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out on this device' }));
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.getByText(/Allow site storage/)).toBeInTheDocument();
    expect(readDeviceRecord()?.kind).toBe('device');
    remove.mockRestore();
  });

  it('removes the surface on lost access even if local credential removal fails', async () => {
    pair();
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(session()));
    render(<GoblinApp initialCode="" />);
    await screen.findByText('Connected');
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Simulate lost access' }));
    expect(screen.getByRole('heading')).toHaveTextContent('This device no longer has access');
    expect(screen.getByText(/Allow site storage/)).toBeVisible();
    remove.mockRestore();
  });

  it('stops pending session updates when unmounted and schedules bounded read retries', async () => {
    vi.useFakeTimers();
    pair();
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(session()));
    const { unmount } = render(<GoblinApp initialCode="" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('copies the gateway address with an accessible result and a manual fallback', async () => {
    pair();
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(session()));
    render(<GoblinApp initialCode="" />);
    await screen.findByText('Connected');
    fireEvent.click(screen.getByRole('button', { name: 'Gateway' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));
    expect(
      screen.getByText('Couldn’t copy the address. Select it and copy it yourself.'),
    ).toBeVisible();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));
    expect(await screen.findByText('Address copied.')).toBeVisible();
    expect(writeText).toHaveBeenCalledWith(window.location.origin);
    writeText.mockRejectedValue(new Error('denied'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));
    expect(
      await screen.findByText('Couldn’t copy the address. Select it and copy it yourself.'),
    ).toBeVisible();
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('keeps the current pairing when a new link is declined', async () => {
    const existing = pair();
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(session()));
    render(<GoblinApp initialCode={'A'.repeat(43)} />);
    expect(screen.getByRole('heading')).toHaveTextContent('This device is already paired');
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep current pairing' }));
    await screen.findByText('Shared chat');
    expect(readDeviceRecord()).toEqual(existing);
    expect(fetcher.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });

  it('an already paired installed app opens chat and ignores a new pairing fragment', async () => {
    const existing = pair();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(session()));
    render(<GoblinApp initialCode={'A'.repeat(43)} />);
    await screen.findByText('Shared chat');
    expect(screen.queryByText('This device is already paired')).not.toBeInTheDocument();
    expect(readDeviceRecord()).toEqual(existing);
    expect(fetcher.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });

  it('ignores a session acknowledgement after the shell is unmounted', async () => {
    pair();
    let acknowledge!: (value: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    const { unmount } = render(<GoblinApp initialCode="" />);
    unmount();
    await act(async () => {
      acknowledge(session());
      await Promise.resolve();
    });
    expect(screen.queryByText('Shared chat')).not.toBeInTheDocument();
  });
});
