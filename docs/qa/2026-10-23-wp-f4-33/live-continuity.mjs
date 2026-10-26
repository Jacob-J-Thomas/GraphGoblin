import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Exactly two turns, no retries, read-only tools, synthetic task, no owner workspace/store.
// Leave the disposable directory in place: this worker does not delete directories.
export async function run(harness, Harness) {
  const directory = await mkdtemp(join(tmpdir(), 'gg-wp-f4-33-'));
  const subscriptionEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL'].includes(key.toUpperCase()),
    ),
  );
  const options = {
    env: subscriptionEnv,
    ...(harness === 'codex' && process.env.GG_CODEX_BINARY
      ? { codexBinary: process.env.GG_CODEX_BINARY }
      : {}),
  };
  const create = () => new Harness(options);
  const preflight = await create().preflight();
  console.log(
    JSON.stringify({
      harness,
      phase: 'preflight',
      state: preflight.state,
      version: preflight.version,
      store: basename(directory),
    }),
  );
  assert.equal(preflight.ok, true, `No provider turns: ${preflight.problems.join('; ')}`);
  const model = harness === 'codex' ? 'gpt-6-luna' : 'claude-haiku-5-5';
  const request = (prompt) => ({
    workingDirectory: directory,
    model,
    effort: 'low',
    options: { sandbox: 'read-only', approval: 'never' },
    turn: { prompt },
  });
  const collect = async (session) => {
    const events = [];
    try {
      for await (const event of session.events) events.push(event);
      const result = await session.result;
      assert.ok(events.some((x) => x.type === 'submitted'));
      assert.ok(result.usage.inputTokens > 0);
      return { id: await session.sessionId, events, text: result.finalText.trim() };
    } catch (error) {
      await session.cancel();
      throw error;
    }
  };
  const nonce = randomBytes(12).toString('hex');
  const first = await collect(
    create().start(
      request(`Remember this synthetic nonce: ${nonce}. Do not use tools. Reply with exactly OK.`),
      AbortSignal.timeout(90000),
    ),
  );
  assert.equal(first.text, 'OK');
  assert.ok(first.events.some((x) => x.type === 'session' && x.mode === 'fresh'));
  // Recreate the adapter: only the persisted provider ID crosses this boundary.
  const resumed = await collect(
    create().resume(
      first.id,
      request(
        'What synthetic nonce did I ask you to remember? Do not use tools. Reply with the nonce only.',
      ),
      AbortSignal.timeout(90000),
    ),
  );
  assert.equal(resumed.id, first.id);
  assert.equal(resumed.text, nonce);
  assert.ok(
    resumed.events.some(
      (x) => x.type === 'session' && x.mode === 'resumed' && x.sessionId === first.id,
    ),
  );
  console.log(
    JSON.stringify({
      harness,
      requestedModel: model,
      requestedEffort: 'low',
      sessionId: first.id,
      turns: 2,
      sameSession: true,
      nonceRecall: true,
      adapterRecreated: true,
    }),
  );
}

// Resolve the existing workspace dependencies through public exports at the API composition root.
// The provider's working directory remains the independently created scratch directory above.
export async function launch(harness) {
  assert.ok(['codex', 'claude'].includes(harness));
  const symbol = harness === 'codex' ? 'CodexHarness' : 'ClaudeHarness';
  const specifier =
    harness === 'codex' ? '@graphgoblin/adapter-codex' : '@graphgoblin/infrastructure/claude';
  const source = `import { ${symbol} } from ${JSON.stringify(specifier)}; import { run } from ${JSON.stringify(import.meta.url)}; await run(${JSON.stringify(harness)}, ${symbol});`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: fileURLToPath(new URL('../../../apps/api/', import.meta.url)),
    stdio: 'inherit',
    windowsHide: true,
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}
