import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ClaudeHarness } from './harness.js';
import { runClaudeProcess } from './process.js';

describe('Claude no-turn executable boundary', () => {
  it.each([
    ['ready', 'ready'],
    ['old', 'cli-incompatible'],
    ['missing-model', 'cli-incompatible'],
    ['missing-effort', 'cli-incompatible'],
    ['auth', 'auth'],
    ['quota', 'quota'],
    ['transport', 'transport'],
    ['unknown', 'unknown'],
    ['hang', 'unknown'],
  ])(
    '%s reports %s without exposing CLI bodies',
    async (scenario, state) => {
      const harness = new ClaudeHarness({
        platform: 'win32',
        preflightTimeoutMs: scenario === 'hang' ? 1000 : 15000,
        runner: (request) =>
          runClaudeProcess({
            ...request,
            binary: process.execPath,
            args: [
              fileURLToPath(new URL('./fixtures/readiness-cli.mjs', import.meta.url)),
              scenario,
              ...request.args,
            ],
          }),
      });
      const result = await harness.preflight();
      expect(result).toMatchObject({ state, ok: state === 'ready' });
      expect(JSON.stringify(result)).not.toContain('PRIVATE_');
      // Each problem is one detail sentence and one action, with no repeated sentence.
      const update = ' Update the Claude CLI, then retry preflight.';
      const check = ' Check that the Claude CLI starts and responds, then retry preflight.';
      const problems: Record<string, string[]> = {
        ready: [],
        old: ['Claude CLI 2.1.284 is older than the minimum version 2.1.285.' + update],
        'missing-model': ['Claude CLI 2.1.287 does not list required options: --model.' + update],
        'missing-effort': ['Claude CLI 2.1.287 does not list required options: --effort.' + update],
        auth: ['Claude is not signed in. Run claude auth login, then retry preflight.'],
        quota: [
          'Claude account usage limit reached. Wait for the usage limit to reset, then retry preflight.',
        ],
        transport: [
          "Claude could not reach its provider service. Check the network connection and the provider's service status, then retry preflight.",
        ],
        unknown: ['Claude CLI check exited with code 1.' + check],
        hang: ['Claude CLI did not answer before the check deadline.' + check],
      };
      expect(result.problems).toEqual(problems[scenario]);
    },
    60000,
  );
});

it('probes the actual installed native Claude without a model turn', async (context) => {
  const binary = join(homedir(), '.local', 'bin', 'claude.exe');
  if (process.platform !== 'win32' || !existsSync(binary)) {
    context.skip('Native Windows Claude binary missing');
    return;
  }
  const result = await new ClaudeHarness({ binary }).preflight();
  if (result.state === 'auth') {
    context.skip('Installed Claude has no accessible login');
    return;
  }
  expect(result).toMatchObject({ state: 'ready', ok: true, authenticated: true });
  expect(result.version).toMatch(/^\d+\.\d+\.\d+$/);
}, 60000);

it('reports a missing Claude executable as cli-missing', async () => {
  expect(
    await new ClaudeHarness({
      binary: join(process.cwd(), 'no-such-claude.exe'),
      platform: 'win32',
    }).preflight(),
  ).toMatchObject({ state: 'cli-missing', ok: false });
});

it('classifies a real installed signed-out Claude in a disposable home as auth', async (context) => {
  const binary = join(homedir(), '.local', 'bin', 'claude.exe');
  if (process.platform !== 'win32' || !existsSync(binary)) {
    context.skip('Native Windows Claude binary missing');
    return;
  }
  const home = await mkdtemp(join(tmpdir(), 'gg-claude-signed-out-'));
  const result = await new ClaudeHarness({
    binary,
    env: { ...process.env, USERPROFILE: home, HOME: home },
  }).preflight();
  expect(result).toMatchObject({ state: 'auth', ok: false, authenticated: false });
}, 60000);
