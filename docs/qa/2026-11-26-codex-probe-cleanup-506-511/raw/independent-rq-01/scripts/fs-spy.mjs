// Observing wrapper for node:fs/promises as seen by cli.ts: records every rm call (path, time,
// outcome) and then performs the real rm unchanged. Everything else is the real module.
import * as real from 'node:fs/promises';
export * from 'node:fs/promises';

const log = (globalThis.__qaEvents ??= []);

export async function rm(path, options) {
  const entry = { kind: 'rm', path: String(path), options, at: performance.now() };
  log.push(entry);
  try {
    await real.rm(path, options);
    entry.outcome = 'ok';
  } catch (error) {
    entry.outcome = error?.code ?? 'error';
    throw error;
  }
}
