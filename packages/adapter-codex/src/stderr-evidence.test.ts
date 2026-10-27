import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HarnessEvent } from '@graphgoblin/engine';
import { createTestEngine, singleNodeLoop } from '@graphgoblin/engine/testing';
import { CodexHarness } from './harness.js';

// PR #426 audit scan 3: the stderr that the SDK's exit error carries is compared piece by piece
// with what the stream reported. The real SDK starts this Node executable with the preloaded
// spec-driven fake CLI, so every case meets the SDK's own stream parsing and exit error.
const preload = new URL('./fixtures/spec-cli.mjs', import.meta.url).href;
const inherited = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && !['NODE_OPTIONS', 'NODE_V8_COVERAGE'].includes(entry[0]),
  ),
);
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
});

const provider = (status: number, type: string, message: string, param?: string) =>
  JSON.stringify({ status, error: { type, message, ...(param ? { param } : {}) } });
const refusalA = provider(400, 'invalid_request_error', 'Effort A refused', 'reasoning.effort');
const refusalB = provider(400, 'invalid_request_error', 'Schema B refused', 'response_format');
const missing = provider(404, 'not_found_error', 'No rollout found with id genuinely-new-session');
const quota = provider(429, 'insufficient_quota', 'Capacity unavailable');
const rate = provider(429, 'rate_limit_exceeded', 'Capacity unavailable');
const auth = provider(401, 'authentication_error', 'Credentials expired');
const misleading = (text: string) =>
  provider(400, 'invalid_request_error', text, 'reasoning.effort');
const usage = {
  input_tokens: 1,
  cached_input_tokens: 0,
  cache_write_input_tokens: 0,
  output_tokens: 1,
  reasoning_output_tokens: 0,
};

/** `S` turn.started, `C` turn.completed, `F` turn.failed with the stream's failure. */
function spec(order: string, failure: string, stderr: string) {
  return {
    events: [
      { type: 'thread.started', thread_id: 'stderr-thread' },
      ...[...order].map((step) =>
        step === 'S'
          ? { type: 'turn.started' }
          : step === 'C'
            ? { type: 'turn.completed', usage }
            : { type: 'turn.failed', error: { message: failure } },
      ),
    ],
    stderr,
    exit: 1,
  };
}

function harness(cli: ReturnType<typeof spec>) {
  return new CodexHarness({
    codexBinary: process.execPath,
    env: {
      ...inherited,
      NODE_OPTIONS: `--import=${preload}`,
      GG_FAKE_CODEX_SPEC: JSON.stringify(cli),
    },
  });
}

async function outcome(cli: ReturnType<typeof spec>) {
  const directory = await mkdtemp(join(tmpdir(), 'gg-codex-stderr-'));
  directories.push(directory);
  const session = harness(cli).start(
    {
      workingDirectory: directory,
      model: 'gpt-6-luna',
      effort: 'low',
      options: { sandbox: 'read-only', approval: 'never' },
      turn: { prompt: 'Controlled fixture; no provider call' },
    },
    new AbortController().signal,
  );
  const events: HarnessEvent[] = [];
  for await (const event of session.events) events.push(event);
  return events.at(-1);
}

const refused = (param: string, text: string) => ({
  code: 'HARNESS_ARGUMENTS_REJECTED',
  message: `The provider refused the request (HTTP 400, ${param}): ${text}`,
  retriable: false,
  submission: 'delivery-uncertain',
});
const missingSession = {
  code: 'HARNESS_SESSION_MISSING',
  message: 'The recorded Codex conversation was not found',
  retriable: false,
  submission: 'session-missing',
};
const notAuthenticated = {
  code: 'HARNESS_NOT_AUTHENTICATED',
  message: 'Credentials expired',
  retriable: false,
  submission: 'delivery-uncertain',
};
const quotaExhausted = (retriable: boolean) => ({
  code: 'HARNESS_QUOTA_EXHAUSTED',
  message: 'Capacity unavailable',
  retriable,
  submission: 'delivery-uncertain',
});

describe('stderr evidence beside the stream failure (PR #426 audit scan 3)', () => {
  // The controls pass with or without the fix; every other case failed before it.
  it.each([
    [
      'a different refusal alone (control)',
      refusalA,
      refusalB,
      refused('response_format', 'Schema B refused'),
    ],
    [
      'the repeated refusal, then a different one',
      refusalA,
      `${refusalA}\n${refusalB}`,
      refused('response_format', 'Schema B refused'),
    ],
    ['a missing session alone (control)', refusalA, missing, missingSession],
    [
      'the repeated refusal, then a missing session as JSON',
      refusalA,
      `${refusalA}\n${missing}`,
      missingSession,
    ],
    [
      'the repeated refusal, then a missing session as text',
      refusalA,
      `${refusalA}\nNo rollout found with id genuinely-new-session`,
      missingSession,
    ],
    ['an authentication failure after quota (control)', quota, auth, notAuthenticated],
    [
      'the repeated quota, then an authentication failure',
      quota,
      `${quota}\n${auth}`,
      notAuthenticated,
    ],
    [
      'an exhausted quota after a rate limit with the same message',
      rate,
      quota,
      quotaExhausted(false),
    ],
    [
      'a rate limit after an exhausted quota with the same message',
      quota,
      rate,
      quotaExhausted(true),
    ],
  ] as const)(
    'folds %s',
    async (_, failure, stderr, expected) => {
      expect(await outcome(spec('SF', failure, stderr))).toEqual({ type: 'error', ...expected });
    },
    30_000,
  );

  it.each(
    [
      'Thread not found in referenced input.',
      "Error: invalid value for reasoning.effort: 'minimal'.",
    ].flatMap((text) => ['SF', 'SCF', 'SFC'].map((order) => ({ text, order }))),
  )(
    'keeps the refusal $text when stderr decorates it and the order is $order',
    async ({ text, order }) => {
      expect(await outcome(spec(order, misleading(text), `ERROR: ${misleading(text)}`))).toEqual({
        type: 'error',
        ...refused('reasoning.effort', text),
      });
    },
    30_000,
  );

  it.each(['SCF', 'SFC'])(
    'fails the run with the refusal, not a missing session, when the order is %s',
    async (order) => {
      const text = 'Thread not found in referenced input.';
      const e = await createTestEngine();
      e.ports.harnesses.codex = harness(
        spec(order, misleading(text), `ERROR: ${misleading(text)}`),
      );
      try {
        const version = e.publish(
          singleNodeLoop('Completed refusal ' + order, {
            id: 'infer',
            kind: 'inference',
            label: 'Infer',
            config: { model: 'gpt-6-luna', effort: 'low', prompt: { template: 'The task' } },
          }),
        );
        const run = await e.runToIdle(version.loopId);
        expect(run.failure).toEqual({
          code: 'HARNESS_TURN_FAILED',
          message: `harness turn failed: The provider refused the request (HTTP 400, reasoning.effort): ${text}`,
          nodeId: 'infer',
          resumable: false,
          details: { adapterCode: 'HARNESS_ARGUMENTS_REJECTED' },
          inference: expect.objectContaining({ submission: 'delivery-uncertain' }),
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
