import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerPwa } from './register.js';
import { usePwaStore } from './store.js';

type Listener = (event: { isUpdate?: boolean }) => void;

function fakeWorkbox() {
  const listeners = new Map<string, Listener[]>();
  return {
    listeners,
    emit(type: string, event: { isUpdate?: boolean } = {}) {
      for (const l of listeners.get(type) ?? []) l(event);
    },
    addEventListener: vi.fn((type: string, listener: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    }),
    register: vi.fn(() => Promise.resolve(undefined)),
    messageSkipWaiting: vi.fn(),
  };
}

afterEach(() => {
  usePwaStore.setState({ needRefresh: false, applyUpdate: undefined, offlineReady: false });
  delete window.graphgoblinPwa;
});

describe('registerPwa', () => {
  it('prompts on a waiting worker and activates it only after confirmation', () => {
    const wb = fakeWorkbox();
    const reload = vi.fn();
    const hook = registerPwa({
      createWorkbox: () => wb as never,
      reload,
      serviceWorkerSupported: true,
    });
    expect(wb.register).toHaveBeenCalled();
    expect(window.graphgoblinPwa).toBe(hook);

    wb.emit('activated', { isUpdate: false });
    expect(usePwaStore.getState().offlineReady).toBe(true);
    wb.emit('activated', { isUpdate: true });

    wb.emit('waiting');
    expect(usePwaStore.getState().needRefresh).toBe(true);
    expect(wb.messageSkipWaiting).not.toHaveBeenCalled();
    usePwaStore.getState().confirm();
    expect(wb.messageSkipWaiting).toHaveBeenCalledTimes(1);
    expect(hook.appliedUpdates).toBe(1);
    expect(reload).not.toHaveBeenCalled();
    wb.emit('controlling');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('exposes a test hook that drives the same prompt, even without service workers', () => {
    const hook = registerPwa({ serviceWorkerSupported: false });
    hook.simulateUpdate();
    expect(usePwaStore.getState().needRefresh).toBe(true);
    usePwaStore.getState().confirm();
    expect(hook.appliedUpdates).toBe(1);
    usePwaStore.getState().confirm();
    expect(hook.appliedUpdates).toBe(1);
  });

  it('logs a failed registration', async () => {
    const wb = fakeWorkbox();
    wb.register.mockImplementation(() => Promise.reject(new Error('nope')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    registerPwa({ createWorkbox: () => wb as never, serviceWorkerSupported: true });
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith('service worker registration failed', expect.any(Error)),
    );
  });

  it('builds a real Workbox for the default worker URL', async () => {
    const register = vi.fn(() => Promise.reject(new Error('no sw in jsdom')));
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register, addEventListener: vi.fn(), controller: null, getRegistration: vi.fn() },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    registerPwa();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(register).toHaveBeenCalledWith('/app/sw.js', { scope: '/app/' });
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });
});
