import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HarnessEvent } from '@graphgoblin/engine';
import { createTestEngine, singleNodeLoop } from '@graphgoblin/engine/testing';
import { CodexHarness } from './harness.js';

// The real SDK runs `<codexBinary> exec ...`; with this Node executable and the preloaded fake CLI
// it meets the exact stream and exit of a Codex CLI whose request the provider refused (F2 LP-5):
// `error` and `turn.failed` carry the provider's HTTP 400, stderr only the startup banner, exit 1.
const preload = new URL('./fixtures/refusal-cli.mjs', import.meta.url).href;
const inherited = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && !['NODE_OPTIONS', 'NODE_V8_COVERAGE'].includes(entry[0]),
  ),
);
const PROVIDER_MESSAGE =
  "Unsupported value: 'minimal' is not supported with the 'gpt-6-luna' model. Supported values are: 'none', 'low', 'medium', 'high', 'xhigh', and 'max'.";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
});

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'gg-codex-refusal-'));
  directories.push(directory);
  return directory;
}

function harness(failure: 'refused' | 'unrecognized') {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    logger,
    codex: new CodexHarness({
      codexBinary: process.execPath,
      env: { ...inherited, NODE_OPTIONS: `--import=${preload}`, GG_FAKE_CODEX_FAILURE: failure },
      logger,
    }),
  };
}

describe('a failure the Codex event stream reports before the CLI exits non-zero (#243)', () => {
  it('records the provider refusal of the request, not the exit error that follows it', async () => {
    const { codex, logger } = harness('refused');
    const session = codex.start(
      {
        workingDirectory: await workspace(),
        model: 'gpt-6-luna',
        effort: 'minimal',
        options: { sandbox: 'read-only', approval: 'never' },
        turn: { prompt: 'Controlled fixture; no provider call' },
      },
      new AbortController().signal,
    );
    const events: HarnessEvent[] = [];
    for await (const event of session.events) events.push(event);
    const refusal = {
      code: 'HARNESS_ARGUMENTS_REJECTED',
      retriable: false,
      message: `The provider refused the request (HTTP 400, reasoning.effort): ${PROVIDER_MESSAGE}`,
    };
    // turn.started is the documented Codex acceptance marker (#244): the CLI took the prompt into
    // its conversation, so a later refusal cannot make the turn definitely unsubmitted.
    expect(events).toEqual([
      { type: 'session', sessionId: 'refused-thread', mode: 'fresh' },
      { type: 'submitted', marker: 'codex.turn.started' },
      { type: 'error', ...refusal, submission: 'delivery-uncertain' },
    ]);
    await expect(session.result).rejects.toMatchObject(refusal);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ code: refusal.code, retriable: false }),
      `codex turn failed: ${refusal.message}`,
    );
  }, 30_000);

  it('keeps an unclassified stream failure instead of the generic exit error', async () => {
    const { codex } = harness('unrecognized');
    const session = codex.start(
      {
        workingDirectory: await workspace(),
        options: { sandbox: 'read-only', approval: 'never' },
        turn: { prompt: 'Controlled fixture; no provider call' },
      },
      new AbortController().signal,
    );
    const events: HarnessEvent[] = [];
    for await (const event of session.events) events.push(event);
    const failure = {
      code: 'HARNESS_TURN_FAILED',
      message: 'The synthetic turn stopped for a reason GraphGoblin does not classify',
    };
    expect(events.at(-1)).toMatchObject({ type: 'error', ...failure });
    await expect(session.result).rejects.toMatchObject(failure);
  }, 30_000);

  it('fails the run with the provider refusal as its non-resumable cause and offers no Resume', async () => {
    const e = await createTestEngine();
    const { codex } = harness('refused');
    e.ports.harnesses.codex = codex;
    try {
      const version = e.publish(
        singleNodeLoop('Provider refusal', {
          id: 'infer',
          kind: 'inference',
          label: 'Infer',
          config: {
            model: 'gpt-6-luna',
            effort: 'minimal',
            prompt: { template: 'The complete authored task' },
          },
        }),
      );
      const run = await e.runToIdle(version.loopId);
      expect(run.failure).toMatchObject({
        code: 'HARNESS_TURN_FAILED',
        message: `harness turn failed: The provider refused the request (HTTP 400, reasoning.effort): ${PROVIDER_MESSAGE}`,
        resumable: false,
        details: { adapterCode: 'HARNESS_ARGUMENTS_REJECTED' },
        inference: { submission: 'delivery-uncertain', sessionId: 'refused-thread' },
      });
      await expect(e.manager.resume(run.id)).rejects.toThrow();
      expect(e.events(run.id).filter((event) => event.type === 'harness.turn')).toHaveLength(1);
    } finally {
      e.manager.stop();
    }
  }, 60_000);
});
