import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { HarnessReadinessStateSchema } from '@graphgoblin/contracts';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ClaudeHarness } from './harness.js';
import { runClaudeProcess } from './process.js';

describe('Claude no-turn executable boundary', () => {
  it.each([
    ['ready', 'ready'],
    ['old', 'cli-incompatible'],
    ['missing-model', 'cli-incompatible'],
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
  expect(HarnessReadinessStateSchema.safeParse(result.state).success).toBe(true);
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
