import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useApi } from '../api/context.js';
import { mockChatClient, turn } from '../chat/__fixtures__/chat.js';
import { FONT_STORAGE_KEY } from '../lib/font.js';
import { subscribeTheme, THEME_STORAGE_KEY } from '../lib/theme.js';
import { setNavigator } from '../pwa/__fixtures__/update.js';
import { getChatUpdateLocked, setChatUpdateGuardExpected } from '../pwa/chat-update-lock.js';
import { bootstrap, createQueryClient } from './bootstrap.js';

const registerPwa = vi.hoisted(() => vi.fn());
vi.mock('../pwa/register.js', () => ({ registerPwa }));
const chat = vi.hoisted(() => ({
  client: undefined as ReturnType<typeof mockChatClient> | undefined,
}));
vi.mock('./useOwnerChatClient.js', () => ({ useOwnerChatClient: () => chat.client }));

const nativeRestorers: (() => void)[] = [];
afterEach(() => {
  for (const restore of nativeRestorers.splice(0)) restore();
  setChatUpdateGuardExpected(true);
  chat.client = undefined;
});

function supportedBrowser(controller: object | null = null) {
  nativeRestorers.push(setNavigator('locks', {}));
  nativeRestorers.push(setNavigator('serviceWorker', { controller }));
}

describe('bootstrap', () => {
  it('mounts the app and registers the service worker unless disabled', async () => {
    window.history.pushState({}, '', '/app/nowhere');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = vi.fn();
    registerPwa.mockReturnValueOnce({ dispose });
    let root!: Root;
    act(() => {
      root = bootstrap(container, { baseUrl: 'http://graphgoblin.test' });
    });
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(registerPwa).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    expect(dispose).toHaveBeenCalledTimes(1);

    const second = bootstrap(container, { registerServiceWorker: false, basename: '/app' });
    expect(registerPwa).toHaveBeenCalledTimes(1);
    act(() => second.unmount());
    container.remove();
    fetchSpy.mockRestore();
    window.history.pushState({}, '', '/');
  });

  it('applies the stored theme if the boot script did not, and follows other tabs', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    document.documentElement.dataset['theme'] = 'dark';
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root!: Root;
    act(() => {
      root = bootstrap(container, { registerServiceWorker: false });
    });
    expect(document.documentElement.dataset['theme']).toBe('light');
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY }));
    expect(document.documentElement.dataset['theme']).toBe('dark');
    act(() => root.unmount());
    container.remove();
    fetchSpy.mockRestore();
  });

  it('follows other tabs only while mounted: mounting again leaves exactly one listener', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    const notified = vi.fn();
    const unsubscribe = subscribeTheme(notified);
    const otherTab = () =>
      window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY }));
    const container = document.createElement('div');
    document.body.appendChild(container);

    let first!: Root;
    act(() => {
      first = bootstrap(container, { registerServiceWorker: false });
    });
    otherTab();
    expect(notified).toHaveBeenCalledTimes(1);
    act(() => first.unmount());
    otherTab();
    expect(notified).toHaveBeenCalledTimes(1);

    let second!: Root;
    act(() => {
      second = bootstrap(container, { registerServiceWorker: false });
    });
    notified.mockClear();
    otherTab();
    expect(notified).toHaveBeenCalledTimes(1);
    act(() => second.unmount());

    unsubscribe();
    container.remove();
    fetchSpy.mockRestore();
  });

  it('applies the stored font if the boot script did not, leaves a shown one, and follows other tabs', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    localStorage.setItem(FONT_STORAGE_KEY, 'opendyslexic');
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root!: Root;
    act(() => {
      root = bootstrap(container, { registerServiceWorker: false });
    });
    expect(document.documentElement.dataset['font']).toBe('opendyslexic');
    localStorage.setItem(FONT_STORAGE_KEY, 'inter');
    window.dispatchEvent(new StorageEvent('storage', { key: FONT_STORAGE_KEY }));
    expect(document.documentElement.dataset['font']).toBe('inter');
    act(() => root.unmount());

    // Nothing stored and nothing shown: Geist, with no attribute added.
    localStorage.clear();
    delete document.documentElement.dataset['font'];
    act(() => {
      root = bootstrap(container, { registerServiceWorker: false });
    });
    expect(document.documentElement.hasAttribute('data-font')).toBe(false);
    act(() => root.unmount());
    container.remove();
    fetchSpy.mockRestore();
  });

  it('configures queries with one retry', () => {
    expect(createQueryClient().getDefaultOptions().queries?.retry).toBe(1);
  });

  it('requires an ApiProvider for useApi', () => {
    function Probe() {
      useApi();
      return null;
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow('useApi must be used inside <ApiProvider>');
    error.mockRestore();
  });

  it.each([false, true])(
    'sends in development only when no worker controls the page (controlled=%s)',
    async (controlled) => {
      supportedBrowser(controlled ? {} : null);
      chat.client = mockChatClient();
      window.history.pushState({}, '', '/app/chat');
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
      const container = document.createElement('div');
      document.body.appendChild(container);
      let root!: Root;
      act(() => {
        root = bootstrap(container, { registerServiceWorker: false });
        // This is checked before React renders or runs a registration effect.
        expect(getChatUpdateLocked()).toBe(controlled);
      });
      try {
        await waitFor(() => expect(chat.client?.session).toHaveBeenCalled());
        fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
          target: { value: 'Hello from development' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        if (controlled) {
          expect(
            await screen.findByText('The app is updating. Try sending again in a moment.'),
          ).toBeVisible();
          expect(chat.client.send).not.toHaveBeenCalled();
        } else {
          expect(await screen.findByText(turn.response!.reply)).toBeVisible();
          expect(chat.client.send).toHaveBeenCalledExactlyOnceWith(
            expect.any(String),
            expect.objectContaining({ input: { kind: 'text', text: 'Hello from development' } }),
          );
        }
        expect(registerPwa).not.toHaveBeenCalled();
      } finally {
        act(() => root.unmount());
        container.remove();
        window.history.pushState({}, '', '/');
      }
    },
  );

  it.each([undefined, true])(
    'restores the production startup gate before a later render (registration=%s)',
    (registerServiceWorker) => {
      supportedBrowser();
      window.history.pushState({}, '', '/app/nowhere');
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
      const container = document.createElement('div');
      document.body.appendChild(container);
      let root!: Root;
      act(() => {
        root = bootstrap(container, { registerServiceWorker: false });
        expect(getChatUpdateLocked()).toBe(false);
      });
      act(() => root.unmount());
      registerPwa.mockReturnValueOnce({ dispose: vi.fn() });
      act(() => {
        root = bootstrap(
          container,
          registerServiceWorker === undefined ? {} : { registerServiceWorker },
        );
        expect(getChatUpdateLocked()).toBe(true);
      });
      expect(registerPwa).toHaveBeenCalledOnce();
      act(() => root.unmount());
      expect(getChatUpdateLocked()).toBe(true);
      container.remove();
      window.history.pushState({}, '', '/');
    },
  );
});
