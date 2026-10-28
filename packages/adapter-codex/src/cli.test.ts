import { fileURLToPath } from 'node:url';
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

  it('captures stdout and stderr together, stdout alone, and the exit code', async () => {
    const result = await runCli(
      node,
      ['-e', 'process.stdout.write("out ");process.stderr.write("err");process.exit(3)'],
      10_000,
    );
    expect(result).toEqual({ code: 3, output: expect.stringMatching(/out|err/), stdout: 'out ' });
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
    expect(result.problems).toEqual([
      'Codex CLI was not found. Install the Codex CLI or set GG_CODEX_BINARY, then retry preflight.',
    ]);
  });
});

describe('Codex no-turn executable boundaries', () => {
  it.each([
    ['ready', 'ready'],
    ['old', 'cli-incompatible'],
    ['missing-model', 'cli-incompatible'],
    ['missing-effort', 'cli-incompatible'],
    ['missing-resume-json', 'cli-incompatible'],
    ['prerelease', 'ready'],
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
      if (scenario === 'ready' || scenario === 'auth')
        expect(result.authenticated).toBe(scenario === 'ready');
      expect(JSON.stringify(result)).not.toContain('PRIVATE_MARKER');
      const update = ' Update the Codex CLI, then retry preflight.';
      const expected: Record<string, string> = {
        old: 'Codex CLI 0.100.0 is older than the minimum version 0.160.0.' + update,
        'missing-model': 'Codex CLI 0.160.0 does not list required exec options: --model.' + update,
        'missing-effort':
          'Codex CLI 0.160.0 does not list required exec options: --config.' + update,
        'missing-resume-json': 'Codex CLI 0.160.0 does not list --json for exec resume.' + update,
        auth: 'Codex sign-in is missing or invalid. Run codex login, then retry preflight.',
      };
      // One detail sentence that names the version and flag, then one action; never repeated.
      if (expected[scenario]) expect(result.problems).toEqual([expected[scenario]]);
      if (state === 'cli-incompatible') expect(result).not.toHaveProperty('authenticated');
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
    if (result.state === 'auth') {
      context.skip(
        'Installed Codex has no accessible login in this environment (sandbox may hide owner login)',
      );
      return;
    }
    expect(result).toMatchObject({ state: 'ready', ok: true, authenticated: true });
    expect(result.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  }, 60000);
});

describe('audited Codex auth evidence', () => {
  it.each([
    ['auth-network', 'auth'],
    ['quota-network', 'quota'],
    ['stdout-quota-warning', 'quota'],
    ['auth-empty', 'unknown'],
    ['auth-unrecognised', 'unknown'],
  ] as const)(
    '%s preserves %s evidence through the executable boundary',
    async (scenario, state) => {
      const result = await preflightCli(
        {
          command: process.execPath,
          prefix: [
            fileURLToPath(new URL('./fixtures/readiness-cli.mjs', import.meta.url)),
            scenario,
          ],
        },
        runCli,
        15000,
      );
      expect(result).toMatchObject({ state, ok: false });
      if (state === 'unknown') {
        expect(result).not.toHaveProperty('authenticated');
        expect(result.problems).toEqual([
          'Codex readiness could not be confirmed. Check that the Codex CLI starts and responds, then retry preflight.',
        ]);
      }
    },
    60000,
  );
});

it('keeps a timed-out lookup unknown even when partial output mentions quota', async () => {
  const result = await preflightCli(
    { command: process.execPath, prefix: [] },
    (_cli, args) =>
      Promise.resolve(
        args.includes('--version')
          ? { code: 0, output: 'codex-cli 0.160.0', stdout: 'codex-cli 0.160.0' }
          : args.includes('--help')
            ? {
                code: 0,
                output:
                  '--json --model --sandbox --cd --skip-git-repo-check --output-schema --config',
                stdout:
                  '--json --model --sandbox --cd --skip-git-repo-check --output-schema --config',
              }
            : {
                code: null,
                output: 'quota PRIVATE_PARTIAL_BODY',
                stdout: 'quota PRIVATE_PARTIAL_BODY',
                spawnError: 'timed out after 10 ms',
              },
      ),
    10,
  );
  expect(result).toMatchObject({ state: 'unknown', ok: false });
  expect(JSON.stringify(result)).not.toContain('PRIVATE_PARTIAL_BODY');
});

it('leaves login unknown if a pre-login command reports an auth diagnostic', async () => {
  const result = await preflightCli(
    { command: process.execPath, prefix: [] },
    () => Promise.resolve({ code: 1, output: 'Invalid API key ? Please run /login', stdout: '' }),
    1000,
  );
  expect(result).toMatchObject({ state: 'auth', ok: false });
  expect(result).not.toHaveProperty('authenticated');
});

it.each([
  { code: 1, output: 'unknown option --version', stdout: '' },
  { code: 0, output: 'unparseable version', stdout: 'unparseable version' },
])('names the version probe when version syntax cannot be established: %j', async (response) => {
  const result = await preflightCli(
    { command: process.execPath, prefix: [] },
    () => Promise.resolve(response),
    1000,
  );
  expect(result.state).toBe('cli-incompatible');
  expect(result.problems).toEqual([
    `${response.code === 1 ? 'Codex CLI rejected the --version option.' : 'Codex CLI --version did not print a version number; 0.160.0 or newer is required.'} Update the Codex CLI, then retry preflight.`,
  ]);
  expect(result).not.toHaveProperty('authenticated');
});
