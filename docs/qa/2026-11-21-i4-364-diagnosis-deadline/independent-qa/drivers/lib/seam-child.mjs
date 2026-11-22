// D203 QA seam: replaces only the `spawn` import of the built claude/process.js. By default the
// controller calls the real native spawn (genuine start or refusal) and only logs it.
import * as real from 'node:child_process';
export * from 'node:child_process';
export function spawn(command, args, options) {
  return globalThis.__d203.spawnSeam(real.spawn, command, args, options);
}
