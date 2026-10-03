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
    expect(result.problems[0]).toMatch(/Codex CLI not found/);
  });
});
