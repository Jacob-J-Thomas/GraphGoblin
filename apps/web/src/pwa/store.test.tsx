import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateToast } from './UpdateToast.js';
import { usePwaStore } from './store.js';

afterEach(() =>
  usePwaStore.setState({
    needRefresh: false,
    applyUpdate: undefined,
    offlineReady: false,
    applying: false,
    blockedReason: undefined,
  }),
);

describe('guarded update notice', () => {
  it('keeps a vetoed update actionable with a clear reason, then applies only on retry', async () => {
    const user = userEvent.setup();
    const apply = vi.fn(() => {
      usePwaStore.getState().setUpdateBlocked('Voice is still pending in another tab.');
      return Promise.resolve(false);
    });
    render(<UpdateToast />);
    act(() => usePwaStore.getState().promptUpdate(apply));
    await user.click(screen.getByRole('button', { name: 'Update' }));
    expect(await screen.findByText('Voice is still pending in another tab.')).toBeInTheDocument();
    expect(screen.getByText('A new version is available')).toBeInTheDocument();
    const success = vi.fn(() => Promise.resolve(true));
    act(() => usePwaStore.getState().promptUpdate(success));
    await user.click(screen.getByRole('button', { name: 'Update' }));
    expect(screen.queryByText('A new version is available')).not.toBeInTheDocument();
    expect(success).toHaveBeenCalledTimes(1);
  });

  it('holds repeat clicks while checking and restores the prompt after an unexpected failure', async () => {
    let reject!: (error: Error) => void;
    const apply = vi.fn(
      () =>
        new Promise<boolean>((_resolve, fail) => {
          reject = fail;
        }),
    );
    act(() => usePwaStore.getState().promptUpdate(apply));
    render(<UpdateToast />);
    act(() => {
      usePwaStore.getState().confirm();
      usePwaStore.getState().confirm();
    });
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
    expect(apply).toHaveBeenCalledTimes(1);
    await act(async () => {
      reject(new Error('worker unavailable'));
      await Promise.resolve();
    });
    expect(screen.getByText('The update could not be checked. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled();
  });

  it('keeps later update prompts when an older async apply settles', async () => {
    let finish!: (accepted: boolean) => void;
    usePwaStore.getState().promptUpdate(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    usePwaStore.getState().confirm();
    const next = vi.fn();
    usePwaStore.getState().promptUpdate(next);
    finish(true);
    await Promise.resolve();
    expect(usePwaStore.getState().applyUpdate).toBe(next);
    expect(usePwaStore.getState().needRefresh).toBe(true);
    usePwaStore.getState().promptUpdate(() => {
      throw new Error('failed');
    });
    usePwaStore.getState().confirm();
    expect(usePwaStore.getState().blockedReason).toContain('could not be checked');
  });
});
