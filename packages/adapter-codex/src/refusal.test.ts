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
// The provider's recorded refusal of a request at the old effort `minimal` (F2 LP-5). The fake CLI
// replays it whatever effort the request names; only its handling is under test here.
const PROVIDER_MESSAGE =
  "Unsupported value: 'minimal' is not supported with the 'gpt-6-luna' model. Supported values are: 'none', 'low', 'medium', 'high', 'xhigh', and 'max'.";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
});

/** The SDK client lists MCP servers in the turn's working directory first (ADR-0063). */
async function inWorkspace(loop: ReturnType<typeof singleNodeLoop>) {
  return {
    ...loop,
    settings: { workingDirectory: { kind: 'fixed' as const, path: await workspace() } },
  };
}

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'gg-codex-refusal-'));
  directories.push(directory);
  return directory;
}

function harness(
  failure: 'refused' | 'unrecognized' | 'malformed' | 'invalid-value' | 'missing-thread',
  output: {
    stderr?: 'banner' | 'repeat' | 'banner-repeat';
    stream?: 'report' | 'none';
  } = {},
) {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    logger,
    codex: new CodexHarness({
      codexBinary: process.execPath,
      env: {
        ...inherited,
        NODE_OPTIONS: `--import=${preload}`,
        GG_FAKE_CODEX_FAILURE: failure,
        GG_FAKE_CODEX_STDERR: output.stderr ?? 'banner',
        GG_FAKE_CODEX_STREAM: output.stream ?? 'report',
      },
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
        effort: 'none',
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

  // PR #426 review B1: only the SDK's own process-exit error is a wrapper of the stream's failure.
  it('records the SDK parse failure that follows an earlier stream diagnostic', async () => {
    const { codex } = harness('malformed');
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
      message: 'Failed to parse item: MALFORMED_PROTOCOL_ITEM',
    };
    expect(events.at(-1)).toMatchObject({ type: 'error', ...failure });
    await expect(session.result).rejects.toMatchObject(failure);
  }, 30_000);

  // PR #426 review B2: the structured 400 decides before any message heuristic.
  it.each([
    ['invalid-value', "Error: invalid value for reasoning.effort: 'minimal'."],
    ['missing-thread', 'Thread not found in referenced input.'],
  ] as const)(
    'keeps the %s provider refusal as a refusal with its own text',
    async (failure, text) => {
      const { codex } = harness(failure);
      const session = codex.start(
        {
          workingDirectory: await workspace(),
          model: 'gpt-6-luna',
          effort: 'none',
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
        message: `The provider refused the request (HTTP 400, reasoning.effort): ${text}`,
      };
      expect(events.at(-1)).toEqual({
        type: 'error',
        ...refusal,
        submission: 'delivery-uncertain',
      });
      await expect(session.result).rejects.toMatchObject(refusal);
    },
    30_000,
  );

  it('fails the run with the provider refusal as its non-resumable cause and offers no Resume', async () => {
    const e = await createTestEngine();
    const { codex } = harness('refused');
    e.ports.harnesses.codex = codex;
    try {
      const version = e.publish(
        await inWorkspace(
          singleNodeLoop('Provider refusal', {
            id: 'infer',
            kind: 'inference',
            label: 'Infer',
            config: {
              model: 'gpt-6-luna',
              effort: 'none',
              prompt: { template: 'The complete authored task' },
            },
          }),
        ),
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

  // PR #426 audit scan 2: the CLI's stderr can repeat the structured refusal, which the SDK's exit
  // error then carries after its prefix. That text must not reach the message heuristics, and a
  // repeat must not replace what the stream reported.
  it.each(
    (
      [
        ['invalid-value', "Error: invalid value for reasoning.effort: 'minimal'."],
        ['missing-thread', 'Thread not found in referenced input.'],
      ] as const
    ).flatMap(([failure, text]) =>
      (
        [
          ['repeat', 'report'],
          ['banner-repeat', 'report'],
          ['repeat', 'none'],
        ] as const
      ).map(([stderr, stream]) => ({ failure, text, stderr, stream })),
    ),
  )(
    'keeps the $failure refusal when stderr is $stderr and the stream reports $stream',
    async ({ failure, text, stderr, stream }) => {
      const { codex } = harness(failure, { stderr, stream });
      const session = codex.start(
        {
          workingDirectory: await workspace(),
          model: 'gpt-6-luna',
          effort: 'none',
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
        message: `The provider refused the request (HTTP 400, reasoning.effort): ${text}`,
      };
      expect(events.at(-1)).toEqual({
        type: 'error',
        ...refusal,
        submission: 'delivery-uncertain',
      });
      await expect(session.result).rejects.toMatchObject(refusal);
    },
    30_000,
  );

  it.each([
    ['invalid-value', "Error: invalid value for reasoning.effort: 'minimal'."],
    ['missing-thread', 'Thread not found in referenced input.'],
  ] as const)(
    'fails the run on the %s refusal repeated on stderr as a refusal, never a missing session',
    async (failure, text) => {
      const e = await createTestEngine();
      e.ports.harnesses.codex = harness(failure, { stderr: 'repeat' }).codex;
      try {
        const version = e.publish(
          await inWorkspace(
            singleNodeLoop('Repeated refusal ' + failure, {
              id: 'infer',
              kind: 'inference',
              label: 'Infer',
              config: {
                model: 'gpt-6-luna',
                effort: 'none',
                prompt: { template: 'The complete authored task' },
              },
            }),
          ),
        );
        const run = await e.runToIdle(version.loopId);
        expect(run.failure).toEqual({
          code: 'HARNESS_TURN_FAILED',
          message: `harness turn failed: The provider refused the request (HTTP 400, reasoning.effort): ${text}`,
          nodeId: 'infer',
          resumable: false,
          details: { adapterCode: 'HARNESS_ARGUMENTS_REJECTED' },
          inference: expect.objectContaining({
            submission: 'delivery-uncertain',
            sessionId: 'refused-thread',
          }),
        });
        expect(run.failure).not.toHaveProperty('missingSession');
        await expect(e.manager.resume(run.id)).rejects.toThrow();
      } finally {
        e.manager.stop();
      }
    },
    60_000,
  );
});
