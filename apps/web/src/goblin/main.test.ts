import { describe, expect, it, vi } from 'vitest';
const bootstrapGoblin = vi.hoisted(() => vi.fn());
vi.mock('./bootstrap.js', () => ({ bootstrapGoblin }));

describe('Goblin entry', () => {
  it('mounts only the peripheral bootstrap', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    await import('./main.js');
    expect(bootstrapGoblin).toHaveBeenCalledWith(root, { registerServiceWorker: false });
    root.remove();
  });
});
