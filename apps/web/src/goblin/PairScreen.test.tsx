import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginPairing, DEVICE_CREDENTIAL_KEY, readDeviceRecord } from './credentials.js';
import { PairScreen } from './PairScreen.js';

const CODE = 'A'.repeat(42) + 'w';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const pairedResponse = () => json({ deviceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', label: 'Phone' });
const gatewaySession = {
  audience: { kind: 'gateway' },
  label: 'Owner',
  readiness: { text: { ready: true }, audio: { ready: false } },
  limits: { maxTextCharacters: 16000, maxAudioBytes: 10485760 },
};
function errorContainer() {
  return screen.getByRole('alert').closest('#goblin-pairing-error');
}
function showBrowserForm() {
  const choice = screen.queryByRole('button', { name: 'Pair this browser instead' });
  if (choice) fireEvent.click(choice);
}
function fill(code = CODE, label = 'Phone') {
  showBrowserForm();
  fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: code } });
  showBrowserForm();
  fireEvent.change(screen.getByLabelText('Device name'), { target: { value: label } });
}
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('peripheral pair screen', () => {
  it('requires code and device name and never posts on load', () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    render(<PairScreen initialCode="" online onPaired={vi.fn()} />);
    expect(screen.getByRole('heading')).toHaveFocus();
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Pair this browser' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a name');
    fill('', 'Phone');
    fireEvent.click(screen.getByRole('button', { name: 'Pair this browser' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Paste the pairing code');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('prefills a link without claiming, preserves exact case, and allows editing', () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    render(<PairScreen initialCode="Case_Sensitive-123" online onPaired={vi.fn()} />);
    expect(screen.getByRole('heading')).toHaveTextContent('Install Goblin, then pair in the app');
    showBrowserForm();
    expect(screen.getByText('Pairing code: from the link')).toBeVisible();
    expect(screen.queryByLabelText('Pairing code')).not.toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Paste a different code' }));
    expect(screen.getByLabelText('Pairing code')).not.toHaveAttribute('readonly');
    expect(screen.getByLabelText('Pairing code')).toHaveFocus();
  });

  it('saves enrollment before the network request and completes on explicit pairing', async () => {
    const paired = vi.fn();
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      expect(readDeviceRecord()).toMatchObject({ kind: 'pending', code: CODE, label: 'Phone' });
      return Promise.resolve(
        new Response(JSON.stringify({ deviceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', label: 'Phone' })),
      );
    });
    render(<PairScreen initialCode={CODE} online onPaired={paired} />);
    showBrowserForm();
    fireEvent.change(screen.getByLabelText('Device name'), { target: { value: 'Phone' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pair this browser' }));
    await waitFor(() =>
      expect(paired).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'device', deviceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }),
      ),
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('blocks offline pairing and keeps the code', () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    render(
      <PairScreen initialCode="CaseCode" online={false} onPaired={vi.fn()} notice="Saved notice" />,
    );
    expect(screen.getByText('Saved notice')).toBeVisible();
    showBrowserForm();
    expect(screen.getByRole('button', { name: 'Pair this browser' })).toBeDisabled();
    fireEvent.submit(screen.getByLabelText('Device name').closest('form')!);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps an uncertain claim for explicit retry and does not duplicate a pending request', async () => {
    let reject!: (reason: unknown) => void;
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    render(<PairScreen initialCode="" online onPaired={vi.fn()} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Pair this browser' }));
    expect(screen.getByRole('button', { name: 'Pairing…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Use a new code' })).toBeDisabled();
    fireEvent.submit(screen.getByLabelText('Device name').closest('form')!);
    fireEvent.keyDown(screen.getByLabelText('Pairing code'), { key: 'Enter' });
    expect(fetcher).toHaveBeenCalledOnce();
    reject(new Error('offline'));
    await screen.findByText(/Not sure pairing finished/);
    expect(screen.getByRole('button', { name: 'Retry pairing' })).toBeVisible();
    expect(screen.getByLabelText('Pairing code')).toHaveAttribute('readonly');
    const pending = readDeviceRecord();
    fetcher.mockResolvedValue(
      new Response(JSON.stringify({ deviceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', label: 'Phone' })),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry pairing' }));
    await waitFor(() => expect(readDeviceRecord()?.kind).toBe('device'));
    expect(JSON.parse(fetcher.mock.calls[1]?.[1]?.body as string).claimId).toBe(
      pending?.kind === 'pending' ? pending.claimId : undefined,
    );
  });

  it('restores a pending claim without posting and permits explicitly replacing its code', () => {
    const pending = beginPairing('CaseCode', 'Phone');
    const fetcher = vi.spyOn(globalThis, 'fetch');
    render(<PairScreen initialCode="" pending={pending} online onPaired={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Retry pairing' })).toBeVisible();
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use a new code' }));
    expect(readDeviceRecord()).toBeUndefined();
    expect(screen.getByLabelText('Pairing code')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Pair this browser' })).toBeVisible();
  });

  it('new links replace a different pending code only after an explicit tap', () => {
    const pending = beginPairing('OldCaseCode', 'Phone');
    render(<PairScreen initialCode="NewCode" pending={pending} online onPaired={vi.fn()} />);
    showBrowserForm();
    expect(screen.getByLabelText('Device name')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Pair this browser' })).toBeVisible();
    expect(readDeviceRecord()).toEqual(pending);
  });

  it('reports unavailable credential storage before making a claim', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    render(<PairScreen initialCode="" online onPaired={vi.fn()} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Pair this browser' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Allow site storage');
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Pair this browser' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Retry pairing' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Device name')).not.toHaveAttribute('readonly');
    expect(screen.getByLabelText('Pairing code')).not.toHaveAttribute('readonly');
    expect(errorContainer()).toHaveFocus();
  });

  it('reports failed pending-state removal', () => {
    const pending = beginPairing('code', 'Phone');
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<PairScreen initialCode="" pending={pending} online onPaired={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use a new code' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Allow site storage');
    remove.mockRestore();
  });

  it('navigates to another gateway shell without passing a credential', () => {
    const navigate = vi.fn();
    render(<PairScreen initialCode="" online onPaired={vi.fn()} navigate={navigate} />);
    fireEvent.click(screen.getByText('Pairing with a different gateway?'));
    const address = screen.getByLabelText('Gateway address');
    fireEvent.change(address, { target: { value: 'http://remote.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an https:// address');
    fireEvent.change(address, { target: { value: 'https://remote.example/path#code' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(navigate).toHaveBeenCalledWith('https://remote.example/goblin/');
  });

  it('offers install-first instructions and copies an unused link code without claiming', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const install = vi.fn(() => Promise.resolve());
    render(<PairScreen initialCode="CaseCode" online onPaired={vi.fn()} install={install} />);
    expect(screen.getByText(/The installed app may keep its storage apart/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(await screen.findByText(/Code copied/)).toBeVisible();
    expect(writeText).toHaveBeenCalledWith('CaseCode');
    fireEvent.click(screen.getByRole('button', { name: 'Install Goblin' }));
    expect(install).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
    expect(readDeviceRecord()).toBeUndefined();
  });

  it('explains clipboard and install failures without submitting a pairing claim', async () => {
    const install = vi.fn(() => Promise.reject(new Error('no install')));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('no clipboard')) },
    });
    render(<PairScreen initialCode="CaseCode" online onPaired={vi.fn()} install={install} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(
      await screen.findByText('Couldn’t copy. Select the code and copy it yourself.'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Install Goblin' }));
    expect(await screen.findByText(/Use your browser’s install option if available/)).toBeVisible();
  });

  it('provides manual copy instructions when clipboard access is absent', async () => {
    render(<PairScreen initialCode="CaseCode" online onPaired={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(
      await screen.findByText('Couldn’t copy. Select the code and copy it yourself.'),
    ).toBeVisible();
  });

  it('an installed app accepts pasted code with explicit Pair and does not present browser pairing', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    const paired = vi.fn();
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ deviceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', label: 'Home Screen' }),
        ),
      );
    render(<PairScreen initialCode="" online onPaired={paired} />);
    expect(screen.queryByText('Install, then pair in the app')).not.toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
    fill(CODE, 'Home Screen');
    fireEvent.click(screen.getByRole('button', { name: 'Pair' }));
    await waitFor(() =>
      expect(paired).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }),
      ),
    );
  });

  it('validates the complete opaque code and device-name bound, focusing the first invalid field', () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    render(<PairScreen initialCode="" online onPaired={vi.fn()} />);
    fill(CODE, 'x'.repeat(81));
    fireEvent.click(screen.getByRole('button', { name: 'Pair this browser' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Use 80 characters or fewer.');
    expect(screen.getByLabelText('Device name')).toHaveFocus();
    fill('not-a-whole-code', 'Phone');
    fireEvent.click(screen.getByRole('button', { name: 'Pair this browser' }));
    expect(screen.getByRole('alert')).toHaveTextContent('That isn’t a whole pairing code.');
    expect(screen.getByLabelText('Pairing code')).toHaveFocus();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'keeps rejected link=%s implicit submission inert and explicit keyboard actions available',
    async (link) => {
      const user = userEvent.setup();
      const fetcher = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(() => Promise.resolve(new Response('{}', { status: 401 })));
      render(<PairScreen initialCode={link ? CODE : ''} online onPaired={vi.fn()} />);
      if (link) {
        showBrowserForm();
        fireEvent.change(screen.getByLabelText('Device name'), { target: { value: 'Phone' } });
      } else fill();
      fireEvent.click(screen.getByRole('button', { name: 'Pair this browser' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Pairing was refused');
      expect(screen.getByRole('alert')).toHaveTextContent(
        'currently refuses this code and the saved credential',
      );
      expect(readDeviceRecord()?.kind).toBe('pending');
      const stored = localStorage.getItem(DEVICE_CREDENTIAL_KEY);
      expect(errorContainer()).toHaveFocus();
      expect(screen.getByRole('button', { name: 'Use a new code' })).toHaveAttribute(
        'type',
        'button',
      );
      expect(screen.getByRole('button', { name: 'Retry pairing' })).toHaveAttribute(
        'type',
        'button',
      );
      fireEvent.submit(screen.getByLabelText('Device name').closest('form')!);
      fireEvent.keyDown(screen.getByLabelText('Device name'), { key: 'Enter' });
      if (!link) fireEvent.keyDown(screen.getByLabelText('Pairing code'), { key: 'Enter' });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(localStorage.getItem(DEVICE_CREDENTIAL_KEY)).toBe(stored);

      screen.getByRole('button', { name: 'Retry pairing' }).focus();
      await user.keyboard('{Enter}');
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
      await waitFor(() => expect(errorContainer()).toHaveFocus());
      expect(fetcher.mock.calls[0]?.[1]?.body).toBe(fetcher.mock.calls[2]?.[1]?.body);
      expect(localStorage.getItem(DEVICE_CREDENTIAL_KEY)).toBe(stored);

      await user.tab();
      expect(screen.getByRole('button', { name: 'Use a new code' })).toHaveFocus();
      await user.keyboard(link ? ' ' : '{Enter}');
      expect(fetcher).toHaveBeenCalledTimes(4);
      expect(readDeviceRecord()).toBeUndefined();
      expect(screen.getByLabelText('Pairing code')).toHaveValue('');
      expect(screen.getByLabelText('Pairing code')).toHaveFocus();
      expect(screen.getByLabelText('Device name')).not.toHaveAttribute('readonly');
      expect(screen.getByText('Saved attempt forgotten. Paste a new code.')).toBeVisible();
    },
  );

  it.each([
    { name: 'claim network failure', claim: () => Promise.reject(new Error('offline')) },
    { name: 'claim 500', claim: () => Promise.resolve(json({}, 500)) },
    { name: 'claim bad JSON', claim: () => Promise.resolve(new Response('bad-json')) },
    { name: 'claim invalid schema', claim: () => Promise.resolve(json({ deviceId: '' })) },
    { name: 'recovery network failure', recovery: () => Promise.reject(new Error('offline')) },
    { name: 'recovery 500', recovery: () => Promise.resolve(json({}, 500)) },
    { name: 'recovery bad JSON', recovery: () => Promise.resolve(new Response('bad-json')) },
    {
      name: 'recovery invalid schema',
      recovery: () => Promise.resolve(json({ audience: { kind: 'device' } })),
    },
    { name: 'recovery gateway audience', recovery: () => Promise.resolve(json(gatewaySession)) },
  ])('keeps $name unconfirmed with exact-identity explicit retry', async (entry) => {
    const paired = vi.fn();
    const fetcher = vi.spyOn(globalThis, 'fetch');
    if ('claim' in entry) fetcher.mockImplementationOnce(entry.claim);
    else fetcher.mockResolvedValueOnce(json({}, 401)).mockImplementationOnce(entry.recovery);
    render(<PairScreen initialCode="" online onPaired={paired} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Pair this browser' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not sure pairing finished');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'reuses the saved request and device credential',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('Pairing was refused');
    expect(errorContainer()).toHaveFocus();
    expect(paired).not.toHaveBeenCalled();
    const stored = localStorage.getItem(DEVICE_CREDENTIAL_KEY);
    const calls = fetcher.mock.calls.length;
    expect(calls).toBe('claim' in entry ? 1 : 2);
    expect(screen.getByRole('button', { name: 'Retry pairing' })).toHaveAttribute('type', 'submit');
    fetcher.mockImplementationOnce(() => Promise.resolve(pairedResponse()));
    fireEvent.keyDown(screen.getByLabelText('Pairing code'), { key: 'Enter', isComposing: true });
    expect(fetcher).toHaveBeenCalledTimes(calls);
    expect(localStorage.getItem(DEVICE_CREDENTIAL_KEY)).toBe(stored);
    fireEvent.keyDown(screen.getByLabelText('Pairing code'), { key: 'Enter' });
    await waitFor(() => expect(paired).toHaveBeenCalledOnce());
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(fetcher.mock.calls[calls]?.[1]?.body);
  });

  it.each([false, true])(
    'keeps claim/recovery 429=%s advisory without automatic retry for 70 seconds',
    async (recovery) => {
      vi.useFakeTimers();
      try {
        const fetcher = vi.spyOn(globalThis, 'fetch');
        if (recovery) fetcher.mockResolvedValueOnce(json({}, 401));
        fetcher.mockResolvedValueOnce(json({}, 429));
        const view = render(<PairScreen initialCode="" online onPaired={vi.fn()} />);
        fill();
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: 'Pair this browser' }));
          await Promise.resolve();
        });
        expect(screen.getByRole('alert')).toHaveTextContent('Not sure pairing finished');
        expect(screen.getByRole('alert')).toHaveTextContent('Wait about a minute, then retry.');
        const pending = readDeviceRecord();
        if (pending?.kind !== 'pending') throw new Error('missing pending enrollment');
        const stored = localStorage.getItem(DEVICE_CREDENTIAL_KEY);
        const calls = recovery ? 2 : 1;
        await act(async () => {
          await vi.advanceTimersByTimeAsync(70_000);
        });
        expect(fetcher).toHaveBeenCalledTimes(calls);
        view.rerender(<PairScreen initialCode="" online={false} onPaired={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Retry pairing' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Use a new code' })).toBeEnabled();
        view.rerender(<PairScreen initialCode="" online onPaired={vi.fn()} />);
        fireEvent(window, new Event('online'));
        fireEvent(document, new Event('visibilitychange'));
        view.unmount();
        render(<PairScreen initialCode="" pending={pending} online onPaired={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Retry pairing' })).toBeEnabled();
        expect(screen.getByText(/A pairing attempt is saved/)).toHaveTextContent(
          'reuses the saved request and device credential',
        );
        expect(localStorage.getItem(DEVICE_CREDENTIAL_KEY)).toBe(stored);
        expect(fetcher).toHaveBeenCalledTimes(calls);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each([false, true])(
    'keeps rejected link=%s replacement enabled while offline',
    async (link) => {
      const fetcher = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(() => Promise.resolve(json({}, 401)));
      const view = render(<PairScreen initialCode={link ? CODE : ''} online onPaired={vi.fn()} />);
      if (link) {
        showBrowserForm();
        fireEvent.change(screen.getByLabelText('Device name'), { target: { value: 'Phone' } });
      } else fill();
      expect(screen.getByRole('button', { name: 'Pair this browser' })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'Pair this browser' }));
      await screen.findByText('Pairing was refused');
      view.rerender(
        <PairScreen initialCode={link ? CODE : ''} online={false} onPaired={vi.fn()} />,
      );
      expect(screen.getByRole('button', { name: 'Retry pairing' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Use a new code' })).toBeEnabled();
      if (link)
        expect(screen.getByRole('button', { name: 'Paste a different code' })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'Use a new code' }));
      expect(readDeviceRecord()).toBeUndefined();
      expect(screen.getByLabelText('Pairing code')).toHaveFocus();
      expect(screen.getByRole('button', { name: 'Pair this browser' })).toBeDisabled();
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it('retains the newly persisted enrollment when saving valid success fails', async () => {
    const paired = vi.fn();
    const original = Storage.prototype.setItem;
    let failSuccess = true;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (
        key === DEVICE_CREDENTIAL_KEY &&
        (JSON.parse(value) as { kind: string }).kind === 'device' &&
        failSuccess
      ) {
        failSuccess = false;
        throw new Error('quota');
      }
      original.call(this, key, value);
    });
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(pairedResponse()));
    render(<PairScreen initialCode="" online onPaired={paired} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Pair this browser' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Allow site storage');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Pairing was refused');
    expect(errorContainer()).toHaveFocus();
    expect(paired).not.toHaveBeenCalled();
    const pending = readDeviceRecord();
    expect(pending?.kind).toBe('pending');
    expect(screen.getByLabelText('Pairing code')).toHaveAttribute('readonly');
    fireEvent.click(screen.getByRole('button', { name: 'Retry pairing' }));
    await waitFor(() => expect(paired).toHaveBeenCalledOnce());
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(fetcher.mock.calls[1]?.[1]?.body);
    expect(readDeviceRecord()).toMatchObject({ kind: 'device', deviceToken: pending?.deviceToken });
  });

  it('keeps an existing enrollment recoverable when storage access fails before dispatch', async () => {
    const pending = beginPairing(CODE, 'Phone');
    const storage = localStorage,
      stored = storage.getItem(DEVICE_CREDENTIAL_KEY);
    const fetcher = vi.spyOn(globalThis, 'fetch');
    render(<PairScreen initialCode="" pending={pending} online onPaired={vi.fn()} />);
    const getter = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Retry pairing' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Allow site storage');
      expect(screen.getByRole('button', { name: 'Retry pairing' })).toBeEnabled();
      expect(screen.getByLabelText('Device name')).toHaveAttribute('readonly');
      expect(storage.getItem(DEVICE_CREDENTIAL_KEY)).toBe(stored);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      getter.mockRestore();
    }
  });

  it('retains in-memory recovery after explicit forgetting fails partway without a false success notice', async () => {
    const pending = beginPairing(CODE, 'Phone');
    const drafts = sessionStorage,
      original = Storage.prototype.removeItem;
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (
      this: Storage,
      key,
    ) {
      if (this === drafts) throw new Error('draft removal blocked');
      original.call(this, key);
    });
    const paired = vi.fn(),
      fetcher = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(() => Promise.resolve(pairedResponse()));
    render(<PairScreen initialCode="" pending={pending} online onPaired={paired} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use a new code' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Allow site storage');
    expect(
      screen.queryByText('Saved attempt forgotten. Paste a new code.'),
    ).not.toBeInTheDocument();
    expect(readDeviceRecord()).toBeUndefined();
    expect(screen.getByLabelText('Pairing code')).toHaveValue(CODE);
    expect(screen.getByLabelText('Pairing code')).toHaveAttribute('readonly');
    expect(fetcher).not.toHaveBeenCalled();
    remove.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'Retry pairing' }));
    await waitFor(() => expect(paired).toHaveBeenCalledOnce());
    expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      claimId: pending.claimId,
      deviceToken: pending.deviceToken,
    });
  });

  it('Enter submits an installed typed code while IME Enter stays in the field', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    const paired = vi.fn();
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ deviceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', label: 'Phone' })),
      );
    render(<PairScreen initialCode="" online onPaired={paired} />);
    fill();
    fireEvent.keyDown(screen.getByLabelText('Pairing code'), { key: 'Enter', isComposing: true });
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText('Pairing code'), { key: 'Enter' });
    await waitFor(() => expect(paired).toHaveBeenCalledOnce());
  });
});
