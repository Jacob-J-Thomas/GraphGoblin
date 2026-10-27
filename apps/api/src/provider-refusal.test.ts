import { afterEach, expect, it } from 'vitest';
import { CodexHarness } from '@graphgoblin/adapter-codex';
import type { RunEvent } from '@graphgoblin/contracts';
import type { HarnessPort } from '@graphgoblin/engine';
import { FakeHarness, singleNodeLoop } from '@graphgoblin/engine/testing';
import { createTestApp, type TestApp } from './testing/test-app.js';

// The real CodexHarness and SDK start this Node executable with the preloaded fake CLI, which
// reports the provider's refusal of the request in the event stream and then exits with code 1
// (final integrated check F2, LP-5). Readiness comes from a ready fake, so publication and run
// admission proceed as they do for a ready, logged-in CLI.
const preload = new URL('./testing/codex-refusal-cli.mjs', import.meta.url).href;
const inherited = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && !['NODE_OPTIONS', 'NODE_V8_COVERAGE'].includes(entry[0]),
  ),
);

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

/** Publish one Codex inference on the fake CLI, run it to failure, and read it over HTTP. */
async function refusedRun(cli: Record<string, string> = {}) {
  const codex = new CodexHarness({
    codexBinary: process.execPath,
    env: { ...inherited, NODE_OPTIONS: `--import=${preload}`, ...cli },
  });
  const ready = new FakeHarness([], 'codex');
  const harness: HarnessPort = {
    id: 'codex',
    preflight: () => ready.preflight(),
    start: (request, signal) => codex.start(request, signal),
    resume: (sessionId, request, signal) => codex.resume(sessionId, request, signal),
  };
  const app = await createTestApp({ harnesses: { codex: harness } });
  t = app;
  const loopId = await app.publishLoop(
    singleNodeLoop('Provider refusal', {
      id: 'infer',
      kind: 'inference',
      label: 'Infer',
      config: {
        model: 'gpt-6-luna',
        effort: 'low',
        prompt: { template: 'The complete authored task' },
      },
    }),
  );
  const started = await app.app.inject({
    method: 'POST',
    url: `/loops/${loopId}/runs`,
    payload: { input: null },
  });
  expect(started.statusCode, started.body).toBe(202);
  const runId = started.json<{ run: { id: string } }>().run.id;
  await app.idle();
  const read = await app.app.inject(`/runs/${runId}`);
  const resumed = await app.app.inject({
    method: 'POST',
    url: `/runs/${runId}/resume`,
    payload: { observedSeq: (await app.container.manager.getRecovery(runId)).observedSeq },
  });
  const turns = (await app.container.repos.events.read(runId)).filter(
    (event: RunEvent) => event.type === 'harness.turn',
  );
  return { read, resumed, turns };
}

it('records a Codex request the provider refused with its own cause and offers no Resume (#243)', async () => {
  const { read, resumed, turns } = await refusedRun();
  expect(read.json()).toMatchObject({
    status: 'failed',
    failure: {
      code: 'HARNESS_TURN_FAILED',
      message:
        "harness turn failed: The provider refused the request (HTTP 400): The 'gpt-6-luna' model is not supported when using Codex with a ChatGPT account.",
      resumable: false,
      details: { adapterCode: 'HARNESS_ARGUMENTS_REJECTED' },
      inference: { sessionId: 'refused-thread' },
    },
    recovery: { resume: { allowed: false } },
  });
  expect(read.body).not.toContain('Reading prompt from stdin');
  expect(resumed.statusCode).toBe(409);
  expect(turns).toHaveLength(1);
}, 60_000);

// PR #426 audit scan 2: stderr repeats the structured refusal, so the SDK's exit error carries it
// after its prefix. Provider text that matches a CLI heuristic must still read as the refusal.
it.each([
  "Error: invalid value for reasoning.effort: 'minimal'.",
  'Thread not found in referenced input.',
])(
  'records the refusal %j repeated on stderr as the refusal, with Resume refused and Replay allowed',
  async (text) => {
    const { read, resumed, turns } = await refusedRun({
      GG_FAKE_PROVIDER_TEXT: text,
      GG_FAKE_CODEX_STDERR: 'repeat',
    });
    const run = read.json<{
      failure: Record<string, unknown>;
      recovery: {
        resume: { allowed: boolean; code?: string };
        replay: { nodeId: string; action: { allowed: boolean } }[];
      };
    }>();
    expect(run.failure).toMatchObject({
      code: 'HARNESS_TURN_FAILED',
      message: `harness turn failed: The provider refused the request (HTTP 400, reasoning.effort): ${text}`,
      resumable: false,
      details: { adapterCode: 'HARNESS_ARGUMENTS_REJECTED' },
      inference: { submission: 'delivery-uncertain', sessionId: 'refused-thread' },
    });
    expect(run.failure).not.toHaveProperty('missingSession');
    expect(run.recovery.resume).toMatchObject({ allowed: false, code: 'FAILURE_NOT_RESUMABLE' });
    expect(run.recovery.replay.find((option) => option.nodeId === 'infer')?.action).toEqual({
      allowed: true,
    });
    expect(resumed.statusCode).toBe(409);
    expect(resumed.json()).toMatchObject({ code: 'FAILURE_NOT_RESUMABLE' });
    expect(turns).toHaveLength(1);
  },
  60_000,
);
