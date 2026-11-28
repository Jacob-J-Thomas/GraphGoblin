// Observing wrapper for node:child_process as seen by cli.ts: records each spawn, kill request,
// exit, close and error with a timestamp, then behaves exactly like the real module.
import * as real from 'node:child_process';
export * from 'node:child_process';

const log = (globalThis.__qaEvents ??= []);
let next = 0;

export function spawn(...args) {
  const child = real.spawn(...args);
  const id = next++;
  log.push({ kind: 'spawn', id, pid: child.pid, args: args[1], cwd: args[2]?.cwd, at: performance.now() });
  const kill = child.kill.bind(child);
  child.kill = (signal) => {
    log.push({ kind: 'kill', id, signal, at: performance.now() });
    return kill(signal);
  };
  child.on('exit', (code, signal) => log.push({ kind: 'exit', id, code, signal, at: performance.now() }));
  child.on('close', (code, signal) => log.push({ kind: 'close', id, code, signal, at: performance.now() }));
  child.on('error', (error) => log.push({ kind: 'error', id, code: error?.code, at: performance.now() }));
  child.stderr?.once('data', () => log.push({ kind: 'stderr-first', id, at: performance.now() }));
  (globalThis.__qaChildren ??= []).push(child);
  return child;
}
