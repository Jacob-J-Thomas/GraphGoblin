import { act, render, screen } from '@testing-library/react';
import type { Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { useApi } from '../api/context.js';
import { subscribeTheme, THEME_STORAGE_KEY } from '../lib/theme.js';
import { bootstrap, createQueryClient } from './bootstrap.js';

const registerPwa = vi.hoisted(() => vi.fn());
vi.mock('../pwa/register.js', () => ({ registerPwa }));

describe('bootstrap', () => {
  it('mounts the app and registers the service worker unless disabled', async () => {
    window.history.pushState({}, '', '/app/nowhere');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = bootstrap(container, { baseUrl: 'http://graphgoblin.test' });
    expect(await screen.findByText('Page not found.')).toBeInTheDocument();
    expect(registerPwa).toHaveBeenCalledTimes(1);
    act(() => root.unmount());

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
});
