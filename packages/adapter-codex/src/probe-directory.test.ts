import { afterEach, describe, expect, it, vi } from 'vitest';
import * as probeFs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCodexHarness } from './index.js';
import { runCli, type CliCommand, type CliRunner } from './cli.js';

// Inject filesystem boundary faults while retaining real exclusive creation and cleanup.
vi.mock('node:fs/promises', { spy: true });

afterEach(() => vi.unstubAllEnvs());

function useTempRoot(root: string): void {
  for (const name of ['TEMP', 'TMP', 'TMPDIR']) vi.stubEnv(name, root);
}

function fixture() {
  const commands: CliCommand[] = [];
  const runner = vi.fn<CliRunner>(async (command, args, timeout) => {
    commands.push(command);
    expect(await probeFs.readdir(command.cwd ?? '')).toEqual([]);
    return runCli({ ...command, prefix: [...command.prefix, 'ready'] }, args, timeout);
  });
  const harness = createCodexHarness({
    codexBinary: fileURLToPath(new URL('./fixtures/readiness-cli.mjs', import.meta.url)),
    cliRunner: runner,
  });
  return { harness, commands, runner };
}

describe('Codex readiness probe directory', () => {
  it('runs the fake CLI under a 226-character TEMP/TMP/TMPDIR root and removes its probe', async () => {
    const root = await probeFs.mkdtemp(join(tmpdir(), 'gg-codex-long-'));
    try {
      let longTemp = root;
      while (longTemp.length < 226 - 21) longTemp = join(longTemp, 'segment-abcdefghij');
      longTemp = join(longTemp, 'x'.repeat(226 - longTemp.length - 1));
      expect(longTemp).toHaveLength(226);
      await probeFs.mkdir(longTemp, { recursive: true });
      useTempRoot(longTemp);
      const { harness, commands } = fixture();
      expect(await harness.preflight()).toMatchObject({ state: 'ready', ok: true, problems: [] });
      expect(commands).toHaveLength(4);
      const directories = new Set(commands.map((command) => command.cwd));
      expect(directories.size).toBe(1);
      const directory = commands[0]?.cwd ?? '';
      expect(dirname(directory)).toBe(longTemp);
      expect(basename(directory)).toMatch(/^gg-codex-probe-[a-f0-9]{8}$/);
      expect(directory).toHaveLength(250);
      await expect(probeFs.access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await probeFs.readdir(longTemp)).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
      await probeFs.rm(root, { recursive: true, force: true });
    }
  });

  it.each([1, 4])(
    'preserves %i existing collision directories and bounds retries',
    async (collisions) => {
      const root = await probeFs.mkdtemp(join(tmpdir(), 'gg-codex-collision-'));
      const { mkdir } = await vi.importActual<typeof probeFs>('node:fs/promises');
      const create = vi.spyOn(probeFs, 'mkdir');
      const remove = vi.spyOn(probeFs, 'rm');
      const existing: string[] = [];
      for (let index = 0; index < collisions; index += 1) {
        create.mockImplementationOnce(async (path, options) => {
          // Another creator wins this name: the second real mkdir produces EEXIST.
          await mkdir(path, options);
          const directory = String(path);
          existing.push(directory);
          await probeFs.writeFile(join(directory, 'preserved.txt'), 'existing directory');
          return mkdir(path, options);
        });
      }
      try {
        useTempRoot(root);
        const { harness, commands, runner } = fixture();
        const ready = collisions === 1;
        expect(await harness.preflight()).toMatchObject({
          state: ready ? 'ready' : 'unknown',
          ok: ready,
        });
        const attempted = create.mock.calls.map(([path]) => String(path));
        expect(attempted).toHaveLength(ready ? 2 : 4);
        expect(new Set(attempted).size).toBe(attempted.length);
        for (const [path, options] of create.mock.calls) {
          expect(dirname(String(path))).toBe(root);
          expect(options).toEqual({ mode: 0o700 });
        }
        expect(existing).toEqual(attempted.slice(0, collisions));
        for (const directory of existing)
          expect(await probeFs.readFile(join(directory, 'preserved.txt'), 'utf8')).toBe(
            'existing directory',
          );
        if (ready) {
          expect(commands).toHaveLength(4);
          expect(new Set(commands.map((command) => command.cwd))).toEqual(new Set([attempted[1]]));
          expect(remove.mock.calls.map(([path]) => String(path))).toEqual([attempted[1]]);
          await expect(probeFs.access(attempted[1] ?? '')).rejects.toMatchObject({
            code: 'ENOENT',
          });
        } else {
          expect(runner).not.toHaveBeenCalled();
          expect(remove).not.toHaveBeenCalled();
        }
      } finally {
        create.mockRestore();
        remove.mockRestore();
        vi.unstubAllEnvs();
        await probeFs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it('fails a real directory creation fault before starting the fake CLI or removing anything', async () => {
    const root = await probeFs.mkdtemp(join(tmpdir(), 'gg-codex-fault-'));
    const blocked = join(root, 'not-a-directory');
    await probeFs.writeFile(blocked, 'preserved file');
    const create = vi.spyOn(probeFs, 'mkdir');
    const remove = vi.spyOn(probeFs, 'rm');
    try {
      useTempRoot(blocked);
      const { harness, runner } = fixture();
      expect(await harness.preflight()).toMatchObject({ state: 'unknown', ok: false });
      expect(create).toHaveBeenCalledTimes(1);
      expect(runner).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(await probeFs.readFile(blocked, 'utf8')).toBe('preserved file');
    } finally {
      create.mockRestore();
      remove.mockRestore();
      vi.unstubAllEnvs();
      await probeFs.rm(root, { recursive: true, force: true });
    }
  });
});
