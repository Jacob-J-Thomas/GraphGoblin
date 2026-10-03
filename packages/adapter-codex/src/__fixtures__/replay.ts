import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CodexOptions, ThreadEvent, ThreadOptions, TurnOptions } from '@openai/codex-sdk';
import type { CodexClientLike, CodexThreadLike } from '../harness.js';

/**
 * Test support: replay JSONL streams recorded by `scripts/record.mjs` through an object shaped
 * like the SDK client, so the harness runs end to end without the CLI or the network.
 */

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures');

export interface Fixture {
  events: ThreadEvent[];
  /** The CLI's exit code at recording time. */
  exitCode: number;
}

export function loadFixture(name: string): Fixture {
  const lines = readFileSync(join(fixturesDir, `${name}.jsonl`), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as { type: string; code?: number });
  const exit = lines.find((l) => l.type === 'x-recorder.exit');
  return {
    events: lines.filter((l) => l.type !== 'x-recorder.exit') as ThreadEvent[],
    exitCode: exit?.code ?? 0,
  };
}

export interface ReplayScript {
  events: (ThreadEvent | { type: string })[];
  /** Mimic the SDK: a non-zero exit throws after the stream drains. */
  exitCode?: number;
  /** Throw this instead of streaming (e.g. a spawn failure). */
  throwOnStart?: Error;
  /** Wait this long between events; aborting during a wait throws an AbortError like the SDK. */
  delayMs?: number;
  /** After this many events, block until aborted (simulates a long-running command). */
  hangAfter?: number;
}

export interface RecordedRun {
  kind: 'start' | 'resume';
  threadId?: string;
  clientOptions: CodexOptions;
  threadOptions: ThreadOptions | undefined;
  input?: string;
  turnOptions?: TurnOptions;
}

function abortable(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The operation was aborted', 'AbortError'));
      return;
    }
    const timer = ms === Infinity ? undefined : setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('The operation was aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

/** A fake `Codex` factory. Each started or resumed thread consumes the next script. */
export class ReplayCodex {
  readonly runs: RecordedRun[] = [];
  private readonly scripts: ReplayScript[];

  constructor(...scripts: ReplayScript[]) {
    this.scripts = scripts;
  }

  static fromFixtures(...names: string[]): ReplayCodex {
    return new ReplayCodex(
      ...names.map((n) => {
        const f = loadFixture(n);
        return { events: f.events, exitCode: f.exitCode };
      }),
    );
  }

  factory = (clientOptions: CodexOptions): CodexClientLike => ({
    startThread: (threadOptions) => this.thread({ kind: 'start', clientOptions, threadOptions }),
    resumeThread: (threadId, threadOptions) =>
      this.thread({ kind: 'resume', threadId, clientOptions, threadOptions }),
  });

  private thread(run: RecordedRun): CodexThreadLike {
    this.runs.push(run);
    const script = this.scripts.shift() ?? { events: [] };
    return {
      runStreamed: (input, turnOptions) => {
        run.input = input;
        run.turnOptions = turnOptions;
        if (script.throwOnStart) return Promise.reject(script.throwOnStart);
        const signal = turnOptions?.signal;
        async function* generate(): AsyncGenerator<ThreadEvent | { type: string }> {
          let index = 0;
          for (const event of script.events) {
            if (script.hangAfter !== undefined && index === script.hangAfter) {
              await abortable(Infinity, signal);
            }
            if (script.delayMs) await abortable(script.delayMs, signal);
            if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
            index += 1;
            yield event;
          }
          if (script.hangAfter !== undefined && index <= script.hangAfter) {
            await abortable(Infinity, signal);
          }
          if (script.exitCode) {
            throw new Error(`Codex Exec exited with code ${script.exitCode}: `);
          }
        }
        return Promise.resolve({ events: generate() });
      },
    };
  }
}
