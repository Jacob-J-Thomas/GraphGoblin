// D203 QA seam: wraps the real built killTree imported by claude/process.js and logs every call.
import * as real from 'file:///G:/ggq/gg-i4-364-deadline-qa/GraphGoblin/packages/infrastructure/dist/process/index.js';
export * from 'file:///G:/ggq/gg-i4-364-deadline-qa/GraphGoblin/packages/infrastructure/dist/process/index.js';
export function killTree(child, ...rest) {
  return globalThis.__d203.killSeam(real.killTree, child, ...rest);
}
