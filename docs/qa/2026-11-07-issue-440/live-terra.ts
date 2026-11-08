/** Exactly two bounded real turns through the unchanged, SDK-bundled GraphGoblin integration. */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexHarness } from '../../../packages/adapter-codex/src/harness.js';
import type { HarnessEvent, Logger } from '../../../packages/engine/src/ports.js';

const output = dirname(fileURLToPath(import.meta.url));
const cwd = await mkdtemp(join(tmpdir(), 'gg-440-terra-'));
const resolved: Record<string, unknown>[] = [];
const logger: Logger = {
  debug(fields, message) {
    if (message === 'codex: reasoning effort sent to the CLI') resolved.push({ ...fields });
  },
  info() {},
  warn() {},
  error() {},
};
const harness = new CodexHarness({ logger });
const preflight = await harness.preflight();
const cases: Record<string, unknown>[] = [];
const record = () =>
  writeFile(
    join(output, 'live-terra-result.json'),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        sdkVersion: '0.160.0',
        binary: 'default SDK-bundled CLI; no override',
        workingDirectory: cwd,
        store: 'no GraphGoblin store opened; direct public CodexHarness calls',
        authentication: 'inherited CLI login; no credentials read by this script',
        preflight,
        providerEffectiveModel: null,
        providerEffectiveEffort: null,
        limitation: 'The normalized SDK event stream reports neither effective model nor effective effort. Resolved values below are the adapter settings sent to the pinned CLI, not provider-reported metadata.',
        cases,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

if (preflight.state === 'ready') {
  for (const effort of ['none', 'medium'] as const) {
    const startedAt = new Date().toISOString();
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 60_000);
    const session = harness.start(
      {
        workingDirectory: cwd,
        model: 'gpt-6.1-terra',
        effort,
        options: { sandbox: 'read-only', approval: 'never', networkAccess: false, webSearch: false },
        turn: {
          prompt: 'Reply with exactly GRAPHGOBLIN_TERRA_OK. Do not use tools, read files, run commands, access the network, or change anything.',
        },
      },
      controller.signal,
    );
    const events: HarnessEvent[] = [];
    const collect = (async () => {
      for await (const event of session.events) events.push(event);
    })();
    try {
      const result = await session.result;
      await collect;
      const pass = result.finalText.trim() === 'GRAPHGOBLIN_TERRA_OK';
      cases.push({
        startedAt,
        completedAt: new Date().toISOString(),
        requestedModel: 'gpt-6.1-terra',
        requestedEffort: effort,
        resolved: resolved.at(-1),
        outcome: pass ? 'pass' : 'unexpected-final-text',
        result,
        events,
      });
    } catch (error) {
      await collect;
      const failure = error as Error & { code?: string; submission?: string };
      cases.push({
        startedAt,
        completedAt: new Date().toISOString(),
        requestedModel: 'gpt-6.1-terra',
        requestedEffort: effort,
        resolved: resolved.at(-1),
        outcome: 'failed',
        failure: { name: failure.name, code: failure.code, message: failure.message, submission: failure.submission },
        events,
      });
    } finally {
      clearTimeout(deadline);
      await record();
    }
  }
} else {
  await record();
}

console.log(JSON.stringify({ preflight, cases: cases.map(({ requestedEffort, outcome }) => ({ requestedEffort, outcome })) }));
if (cases.length !== 2 || cases.some((entry) => entry.outcome !== 'pass')) process.exitCode = 1;
