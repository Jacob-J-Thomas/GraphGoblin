import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { isStandalone, useStandalone } from './standalone.js';

describe('installed Goblin context', () => {
  it('detects iOS Home Screen context independently from browser credentials', () => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    expect(isStandalone()).toBe(true);
    Reflect.deleteProperty(navigator, 'standalone');
    expect(isStandalone()).toBe(false);
  });

  it('reads the window installation context once and a new window can have a different context', () => {
    const media = { matches: false };
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => media),
    );
    const first = renderHook(useStandalone);
    expect(first.result.current).toBe(false);
    media.matches = true;
    first.rerender();
    expect(first.result.current).toBe(false);
    first.unmount();
    const installed = renderHook(useStandalone);
    expect(installed.result.current).toBe(true);
    installed.unmount();
    vi.unstubAllGlobals();
  });
});
