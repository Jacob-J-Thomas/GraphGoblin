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

it('records a Codex request the provider refused with its own cause and offers no Resume (#243)', async () => {
  const codex = new CodexHarness({
    codexBinary: process.execPath,
    env: { ...inherited, NODE_OPTIONS: `--import=${preload}` },
  });
  const ready = new FakeHarness([], 'codex');
  const harness: HarnessPort = {
    id: 'codex',
    preflight: () => ready.preflight(),
    start: (request, signal) => codex.start(request, signal),
    resume: (sessionId, request, signal) => codex.resume(sessionId, request, signal),
  };
  t = await createTestApp({ harnesses: { codex: harness } });
  const loopId = await t.publishLoop(
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
  const started = await t.app.inject({
    method: 'POST',
    url: `/loops/${loopId}/runs`,
    payload: { input: null },
  });
  expect(started.statusCode, started.body).toBe(202);
  const runId = started.json<{ run: { id: string } }>().run.id;
  await t.idle();
  const read = await t.app.inject(`/runs/${runId}`);
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
  const resumed = await t.app.inject({
    method: 'POST',
    url: `/runs/${runId}/resume`,
    payload: { observedSeq: (await t.container.manager.getRecovery(runId)).observedSeq },
  });
  expect(resumed.statusCode).toBe(409);
  const turns = (await t.container.repos.events.read(runId)).filter(
    (event: RunEvent) => event.type === 'harness.turn',
  );
  expect(turns).toHaveLength(1);
}, 60_000);
