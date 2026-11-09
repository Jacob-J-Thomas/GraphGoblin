import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addChatUpdateLock,
  getChatUpdateLocked,
  removeChatUpdateLock,
  setChatUpdateGuardExpected,
  startChatUpdateRuntime,
  stopChatUpdateRuntime,
} from './chat-update-lock.js';
import { registerPwa } from './register.js';

const lifecycles: ReturnType<typeof registerPwa>[] = [];
beforeEach(() => {
  vi.stubGlobal('navigator', { serviceWorker: { controller: null }, locks: {} });
});
afterEach(() => {
  for (const lifecycle of lifecycles.splice(0)) lifecycle.dispose();
  removeChatUpdateLock('update');
  setChatUpdateGuardExpected(true);
  vi.unstubAllGlobals();
});

describe('chat update action gate', () => {
  it('gates the first paint while the expected runtime has not started', () => {
    expect(getChatUpdateLocked()).toBe(true);
  });

  it('permits explicitly disabled registration only before a worker controls the page', () => {
    setChatUpdateGuardExpected(false);
    expect(getChatUpdateLocked()).toBe(false);
    vi.stubGlobal('navigator', { serviceWorker: { controller: {} }, locks: {} });
    expect(getChatUpdateLocked()).toBe(true);
  });

  it('restores the startup gate when a later entry expects registration', () => {
    setChatUpdateGuardExpected(false);
    expect(getChatUpdateLocked()).toBe(false);
    setChatUpdateGuardExpected(true);
    expect(getChatUpdateLocked()).toBe(true);
  });

  it('retains transaction locks when registration is explicitly disabled', () => {
    addChatUpdateLock('update');
    setChatUpdateGuardExpected(false);
    expect(getChatUpdateLocked()).toBe(true);
    expect(removeChatUpdateLock('update')).toBe(true);
    expect(getChatUpdateLocked()).toBe(false);
  });

  it('does not change runtime ownership when entry expectations change', () => {
    startChatUpdateRuntime();
    try {
      expect(getChatUpdateLocked()).toBe(false);
      setChatUpdateGuardExpected(false);
      setChatUpdateGuardExpected(true);
      expect(getChatUpdateLocked()).toBe(false);
    } finally {
      stopChatUpdateRuntime();
    }
    expect(getChatUpdateLocked()).toBe(true);
  });

  it.each([undefined, {}, { serviceWorker: {} }])(
    'does not require a runtime without browser update-lock support (%j)',
    (browser) => {
      vi.stubGlobal('navigator', browser);
      expect(getChatUpdateLocked()).toBe(false);
    },
  );

  it('does not infer disabled registration from a failed guard startup', () => {
    expect(() =>
      registerPwa({
        createUpdateGuard: () => {
          throw new Error('guard startup unavailable');
        },
      }),
    ).toThrow('guard startup unavailable');
    expect(getChatUpdateLocked()).toBe(true);
  });

  it('does not infer disabled registration from rejection or disposal', async () => {
    const failure = new Error('registration unavailable');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dispose = vi.fn();
    const lifecycle = registerPwa({
      createUpdateGuard: () => ({
        apply: () => Promise.resolve({ accepted: false }),
        dispose,
      }),
      createWorkbox: () => ({
        addEventListener: vi.fn(),
        register: () => Promise.reject(failure),
        messageSkipWaiting: vi.fn(),
      }),
    });
    lifecycles.push(lifecycle);
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith('service worker registration failed', failure),
    );
    expect(getChatUpdateLocked()).toBe(true);
    lifecycle.dispose();
    expect(dispose).toHaveBeenCalled();
    expect(getChatUpdateLocked()).toBe(true);
  });
});
