import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginPairing, readDeviceRecord } from './credentials.js';
import { PairScreen } from './PairScreen.js';

const CODE = 'A'.repeat(42) + 'w';
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
    fireEvent.submit(screen.getByLabelText('Device name').closest('form')!);
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
    'keeps a rejected claim identity and focuses the code correction for link=%s',
    async (link) => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        Promise.resolve(new Response('{}', { status: 401 })),
      );
      render(<PairScreen initialCode={link ? CODE : ''} online onPaired={vi.fn()} />);
      if (link) {
        showBrowserForm();
        fireEvent.change(screen.getByLabelText('Device name'), { target: { value: 'Phone' } });
      } else fill();
      fireEvent.click(screen.getByRole('button', { name: 'Pair this browser' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('That code didn’t work.');
      expect(readDeviceRecord()?.kind).toBe('pending');
      expect(
        link
          ? screen.getByRole('button', { name: 'Paste a different code' })
          : screen.getByLabelText('Pairing code'),
      ).toHaveFocus();
    },
  );

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
