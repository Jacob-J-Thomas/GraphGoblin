// D203 QA seam: replaces only the `stat` import of the built claude/process.js. The controller
// decides per call whether the real native stat is delivered at once, withheld, or overridden.
import * as real from 'node:fs/promises';
export * from 'node:fs/promises';
export function stat(path, ...rest) {
  return globalThis.__d203.statSeam(real.stat, path, ...rest);
}
