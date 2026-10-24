import { spawn, ChildProcess } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { ProcessScripts } from './scripts.js';
afterEach(() => vi.useRealTimers());
function fixture() {
  const root = new ChildProcess();
  Object.assign(root, { pid: 123456 });
  const killer = new ChildProcess();
  const spawnImpl = new Proxy(spawn, {
    apply(_target, _receiver, args: Parameters<typeof spawn>) {
      return args[0] === 'taskkill' ? killer : root;
    },
  });
  const controller = new AbortController();
  const scripts = new ProcessScripts({ platform: 'win32', spawnImpl });
  const pending = scripts.run({
    command: 'controlled-child',
    args: [],
    cwd: '.',
    env: {},
    signal: controller.signal,
  });
  controller.abort();
  return { root, killer, pending };
}
it('reports taskkill nonzero exit truthfully instead of assuming tree termination', async () => {
  const f = fixture();
  let result: Awaited<typeof f.pending> | undefined;
  void f.pending.then((value) => {
    result = value;
  });
  f.killer.emit('close', 1);
  // A controlled root-close only allows the old implementation to settle; nonzero taskkill
  // never confirms descendants, even when the root independently exits successfully.
  f.root.emit('close', 0);
  await f.pending;
  expect(result).toMatchObject({ terminationUnconfirmed: true, exitCode: null });
});
it('waits for both tree acknowledgement and the root close before reporting cleanup', async () => {
  const f = fixture();
  let done = false;
  void f.pending.then(() => {
    done = true;
  });
  f.root.emit('close', null);
  expect(done).toBe(false);
  f.killer.emit('close', 0);
  expect(await f.pending).not.toHaveProperty('terminationUnconfirmed');
});
it('reports unconfirmed cleanup after five seconds without a close event', async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.killer.emit('close', 0);
  await vi.advanceTimersByTimeAsync(5000);
  expect(await f.pending).toMatchObject({ terminationUnconfirmed: true });
});

it('completes cleanup when tree acknowledgement precedes root close', async () => {
  const f = fixture();
  let done = false;
  void f.pending.then(() => {
    done = true;
  });
  f.killer.emit('close', 0);
  f.root.emit('close', null);
  await vi.waitFor(() => expect(done).toBe(true));
  expect(await f.pending).not.toHaveProperty('terminationUnconfirmed');
});
