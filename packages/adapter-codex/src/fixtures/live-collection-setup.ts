import { readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readinessFailure } from '@graphgoblin/domain';
import type { HarnessPreflight } from '@graphgoblin/engine';
import { CodexHarness } from '../harness.js';

/**
 * Vitest setup file for the child runs of `live-collection.test.ts` (#511). It makes the live
 * suite's Codex adapters test-controlled in that child, so no Codex CLI starts and no model
 * request can be made there. It imports nothing from Vitest, so the package source gains no
 * test-only dependency.
 */

/** The prefix of the live suite's working directory. */
export const LIVE_FIXTURE_PREFIX = 'graphgoblin-live-';

export interface LiveControl {
  /** The file the controlled preflight writes the live fixtures it saw into. */
  record: string;
  /** The child run's own temporary directory, where the live suite allocates its fixture. */
  temporary: string;
  /** Whether the controlled preflight passes. */
  ready: boolean;
}

const CONTROLLED = ['preflight', 'start', 'resume'] as const;

/**
 * Replaces every Codex harness's preflight with one that records the live fixtures present in
 * `temporary` and passes or fails as `ready` says, and refuses every turn. The decider and
 * structured calls start their turns through the harness, so they are refused too. Returns the
 * restoration of the original methods.
 */
export function controlLiveAdapters(control: LiveControl): () => void {
  const prototype = CodexHarness.prototype;
  const original = CONTROLLED.map(
    (name) => [name, Object.getOwnPropertyDescriptor(prototype, name)!] as const,
  );
  prototype.preflight = (): Promise<HarnessPreflight> => {
    const fixtures = readdirSync(control.temporary).filter((name) =>
      name.startsWith(LIVE_FIXTURE_PREFIX),
    );
    writeFileSync(control.record, JSON.stringify({ fixtures }));
    return Promise.resolve(
      control.ready
        ? { state: 'ready', ok: true, version: '0.160.0', authenticated: true, problems: [] }
        : readinessFailure('codex', 'unknown'),
    );
  };
  const refuse = (): never => {
    throw new Error('The live collection check starts no Codex turn');
  };
  prototype.start = refuse;
  prototype.resume = refuse;
  return () => {
    for (const [name, descriptor] of original) Object.defineProperty(prototype, name, descriptor);
  };
}

// The child run names its record file; anywhere else this module only exports.
const record = process.env['GG_LIVE_COLLECTION_RECORD'];
if (record !== undefined)
  controlLiveAdapters({
    record,
    temporary: tmpdir(),
    ready: process.env['GG_LIVE_COLLECTION_PREFLIGHT'] === 'ready',
  });
