import { fileURLToPath } from 'node:url';
import { HarnessReadinessStateSchema } from '@graphgoblin/contracts';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bundledCli, cliFor, preflightCli, runCli } from './cli.js';

describe('bundledCli', () => {
  it('resolves the launcher of the CLI the SDK depends on', () => {
    const cli = bundledCli();
    expect(cli?.command).toBe(process.execPath);
    expect(cli?.prefix[0]).toMatch(/codex[\\/]bin[\\/]codex\.js$/);
    expect(existsSync(cli?.prefix[0] ?? '')).toBe(true);
  });

  it('returns undefined when the SDK cannot be resolved', () => {
    expect(
      bundledCli(() => {
        throw new Error('not found');
      }),
    ).toBeUndefined();
  });
});

describe('cliFor', () => {
  it('runs JavaScript launchers through Node and executables directly', () => {
    expect(cliFor('/x/codex.js')).toEqual({ command: process.execPath, prefix: ['/x/codex.js'] });
    expect(cliFor('C:\\bin\\codex.exe')).toEqual({ command: 'C:\\bin\\codex.exe', prefix: [] });
  });
});

describe('runCli', () => {
  const node = { command: process.execPath, prefix: [] };

  it('captures stdout and stderr together with the exit code', async () => {
    const result = await runCli(
      node,
      ['-e', 'process.stdout.write("out ");process.stderr.write("err");process.exit(3)'],
      10_000,
    );
    expect(result).toEqual({ code: 3, output: expect.stringMatching(/out|err/) });
    expect(result.output).toContain('err');
  });

  it('reports a missing binary as a spawn error', async () => {
    const result = await runCli(
      { command: 'graphgoblin-no-such-codex-binary', prefix: [] },
      ['--version'],
      10_000,
    );
    expect(result.code).toBeNull();
    expect(result.spawnError).toMatch(/ENOENT/);
  });

  it('kills a process that exceeds the timeout', async () => {
    const result = await runCli(node, ['-e', 'setTimeout(() => {}, 60000)'], 200);
    expect(result.spawnError).toBe('timed out after 200 ms');
  });
});

describe('preflightCli', () => {
  it('reports a missing bundled CLI', async () => {
    const result = await preflightCli(undefined, () => Promise.reject(new Error('unused')), 1);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/codex CLI could not be found/);
  });
});

describe('Codex no-turn executable boundaries', () => {
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
    '%s reports %s',
    async (scenario, state) => {
      const cli = {
        command: process.execPath,
        prefix: [fileURLToPath(new URL('./fixtures/readiness-cli.mjs', import.meta.url)), scenario],
      };
      const result = await preflightCli(cli, runCli, scenario === 'hang' ? 1000 : 15000);
      expect(result).toMatchObject({ state, ok: state === 'ready' });
      expect(JSON.stringify(result)).not.toContain('PRIVATE_MARKER');
    },
    75000,
  );
  it('probes the actual installed SDK CLI without a model turn', async (context) => {
    const cli = bundledCli();
    if (!cli) {
      context.skip('Codex binary missing');
      return;
    }
    const result = await preflightCli(cli, runCli, 15000);
    if (result.state === 'cli-missing') {
      context.skip('Codex platform binary missing');
      return;
    }
    expect(HarnessReadinessStateSchema.safeParse(result.state).success).toBe(true);
    expect(result.version).toMatch(/^\d+\.\d+\.\d+$/);
  }, 60000);
});

it('keeps a timed-out lookup unknown even when partial output mentions quota', async () => {
  const result = await preflightCli(
    { command: process.execPath, prefix: [] },
    (_cli, args) =>
      Promise.resolve(
        args.includes('--version')
          ? { code: 0, output: 'codex-cli 0.160.0' }
          : args.includes('--help')
            ? {
                code: 0,
                output:
                  '--json --model --sandbox --cd --skip-git-repo-check --output-schema --config',
              }
            : {
                code: null,
                output: 'quota PRIVATE_PARTIAL_BODY',
                spawnError: 'timed out after 10 ms',
              },
      ),
    10,
  );
  expect(result).toMatchObject({ state: 'unknown', ok: false });
  expect(JSON.stringify(result)).not.toContain('PRIVATE_PARTIAL_BODY');
});
