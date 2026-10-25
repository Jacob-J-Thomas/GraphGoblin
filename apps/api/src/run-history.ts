import type { ContextThread } from '@graphgoblin/contracts';
import { replayThread, replayStateAt, type ReplayState } from '@graphgoblin/domain';
import { z } from 'zod';
import type { Container } from './container.js';

const Cursor = z.strictObject({
  runId: z.string(),
  seq: z.number().int().nonnegative().safe(),
  direction: z.enum(['older', 'newer']),
});
type Cursor = z.infer<typeof Cursor>;

export function historyCursor(value: Cursor): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function readHistoryCursor(cursor: string, runId: string): Cursor {
  try {
    if (cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error('invalid');
    const value = Cursor.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    if (value.runId !== runId || historyCursor(value) !== cursor) throw new Error('invalid');
    return value;
  } catch {
    throw Object.assign(new Error('Choose a cursor returned by this run history.'), {
      code: 'INVALID_CURSOR',
      statusCode: 400,
    });
  }
}

/** Historical reads carry the domain replay state across 128-row pages, never the whole log. */
export async function historicalThread(
  container: Container,
  runId: string,
  at: number,
): Promise<ContextThread | undefined> {
  const { repos } = container;
  let thread = await repos.runs.getInitialThread(runId);
  if (!thread) return undefined;
  let after = 0;
  let state: ReplayState = { strict: false };
  const checkpoint = await repos.runs.getThreadCheckpoint(runId);
  if (checkpoint?.replayState && checkpoint.seq <= at) {
    const [boundary] = await repos.events.read(runId, checkpoint.seq - 1, 1);
    if (boundary?.seq === checkpoint.seq) {
      thread = checkpoint.thread;
      after = checkpoint.seq;
      state = checkpoint.replayState;
    }
  }
  while (after < at) {
    // Sequences are contiguous, so a page never reaches past `at`: a damaged later event must
    // not block an earlier thread (D-016).
    const page = await repos.events.read(runId, after, Math.min(128, at - after));
    if (!page.length) break;
    thread = replayThread(thread, page, at, state);
    state = replayStateAt(page, at, state);
    after = page.at(-1)!.seq;
    // Give cancellation and other requests a turn between historical pages.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return thread;
}
