import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
const registerPwa = vi.hoisted(() => vi.fn(() => ({ dispose: vi.fn() })));
vi.mock('../pwa/register.js', () => ({ registerPwa }));
vi.mock('./GoblinApp.js', () => ({
  GoblinApp: ({ initialCode }: { initialCode: string }) => (
    <p>{initialCode || 'No pairing link'}</p>
  ),
}));
import { bootstrapGoblin } from './bootstrap.js';

describe('peripheral bootstrap', () => {
  it('scrubs the link before rendering, applies the stored appearance, and owns only the Goblin worker', async () => {
    window.history.replaceState(null, '', '/goblin/#pair=CaseCode');
    localStorage.setItem('graphgoblin-theme', 'light');
    localStorage.setItem('graphgoblin-font', 'inter');
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root!: ReturnType<typeof bootstrapGoblin>;
    await act(async () => {
      root = bootstrapGoblin(container);
      await Promise.resolve();
    });
    expect(window.location.hash).toBe('');
    expect(container).toHaveTextContent('CaseCode');
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(document.documentElement.dataset['font']).toBe('inter');
    expect(registerPwa).toHaveBeenCalledWith({ url: '/goblin/sw.js', scope: '/goblin/' });
    const registration = registerPwa.mock.results.at(-1)?.value as { dispose: () => void };
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    expect(registration.dispose).toHaveBeenCalled();
    container.remove();
  });

  it('does not register a worker in development', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root!: ReturnType<typeof bootstrapGoblin>;
    await act(async () => {
      root = bootstrapGoblin(container, { registerServiceWorker: false });
      await Promise.resolve();
    });
    expect(registerPwa).not.toHaveBeenCalled();
    expect(container).toHaveTextContent('No pairing link');
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    container.remove();
  });
});
