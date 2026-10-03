import { describe, expect, it, vi } from 'vitest';

const bootstrap = vi.hoisted(() => vi.fn());
vi.mock('./app/bootstrap.js', () => ({ bootstrap }));

describe('main', () => {
  it('bootstraps into #root', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    await import('./main.js');
    expect(bootstrap).toHaveBeenCalledWith(root, { registerServiceWorker: false });
    root.remove();
  });
});
