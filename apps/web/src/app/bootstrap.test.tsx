import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useApi } from '../api/context.js';
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
