import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { installationGuidance, useInstall } from './useInstall.js';

describe('Goblin installation', () => {
  it('offers installation only after a browser prompt event and consumes that event once', async () => {
    const { result } = renderHook(useInstall);
    expect(result.current).toBeUndefined();
    const prompt = vi.fn(() => Promise.resolve());
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt });
    void act(() => window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    await act(async () => {
      await result.current?.();
    });
    expect(prompt).toHaveBeenCalledOnce();
    expect(result.current).toBeUndefined();
  });

  it('clears a pending prompt when installed and removes listeners on unmount', () => {
    const { result, unmount } = renderHook(useInstall);
    void act(() =>
      window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), { prompt: vi.fn() })),
    );
    expect(result.current).toBeTypeOf('function');
    void act(() => window.dispatchEvent(new Event('appinstalled')));
    expect(result.current).toBeUndefined();
    unmount();
    const event = new Event('beforeinstallprompt', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

it.each([
  ['iPhone Safari', 'iPhone', 1, 'Share'],
  ['Safari', 'MacIntel', 5, 'Share'],
  ['Android Chrome', 'Linux', 1, 'Install app'],
  ['Macintosh Safari', 'MacIntel', 0, 'Add to Dock'],
  ['Chrome', 'MacIntel', 0, 'address bar'],
  ['Firefox', 'Linux', 0, 'keep using this browser'],
])('gives platform install guidance for %s', (ua, platform, touches, expected) => {
  expect(installationGuidance(ua, platform, touches)).toContain(expected);
});
