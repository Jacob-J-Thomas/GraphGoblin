import { access, copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { RunManager } from '@graphgoblin/engine';
import { createTestEngine, singleNodeLoop } from '@graphgoblin/engine/testing';
import { ProcessScripts } from './scripts.js';

describe('native script start disposition through the engine (#321)', () => {
  it('a missing command is resumable, recovery preserves its proven refusal, and explicit resume can start the repaired command', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gg-wp-d1-start-'));
    const e = await createTestEngine();
    e.manager.stop();
    const command = join(dir, process.platform === 'win32' ? 'later.exe' : 'later');
    const v = e.publish(
      singleNodeLoop('refusal', {
        id: 'script',
        kind: 'script',
        label: 'Refused',
        config: { command, cwd: dir, args: ['-e', 'process.exit(7)'] },
      }),
    );
    const run = await e.start(v.loopId);
    const ports = { ...e.ports, scripts: new ProcessScripts() };
    const first = new RunManager(ports, e.settings);
    const recovered = new RunManager(ports, e.settings);
    try {
      await first.start();
      await first.waitForIdle();
      first.stop();
      expect((await ports.runs.get(run.id))?.failure).toMatchObject({
        code: 'SCRIPT_START_FAILED',
        resumable: true,
        script: { state: 'definitely-not-started' },
      });
      await recovered.start();
      await recovered.waitForIdle();
      expect((await ports.runs.get(run.id))?.failure?.code).toBe('SCRIPT_START_FAILED');
      await copyFile(process.execPath, command);
      await recovered.resume(run.id);
      await recovered.waitForIdle();
      expect((await ports.runs.get(run.id))?.failure).toMatchObject({
        code: 'SCRIPT_EXIT_CODE',
        script: { state: 'completed', exitCode: 7 },
      });
      const dispatches = e.events(run.id).filter((event) => event.type === 'script.dispatched');
      expect(dispatches).toHaveLength(2);
      expect(dispatches[0]!.visitId).toBe(dispatches[1]!.visitId);
      expect(dispatches[0]!.dispatchId).not.toBe(dispatches[1]!.dispatchId);
    } finally {
      first.stop();
      recovered.stop();
      await rm(dir, { recursive: true, force: true });
    }
    await expect(access(dir)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 30_000);

  it.skipIf(process.platform !== 'win32')(
    'a native .cmd refusal is SCRIPT_START_FAILED with no marker effect',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'gg-wp-d1-cmd-'));
      const e = await createTestEngine();
      e.manager.stop();
      const command = join(dir, 'refused.cmd');
      const marker = join(dir, 'marker');
      await writeFile(command, `@echo effect>"${marker}"\r\n`);
      const v = e.publish(
        singleNodeLoop('cmd-refusal', {
          id: 'script',
          kind: 'script',
          label: 'Refused',
          config: { command, cwd: dir },
        }),
      );
      const run = await e.start(v.loopId);
      const manager = new RunManager({ ...e.ports, scripts: new ProcessScripts() }, e.settings);
      try {
        await manager.start();
        await manager.waitForIdle();
        expect((await e.ports.runs.get(run.id))?.failure).toMatchObject({
          code: 'SCRIPT_START_FAILED',
          script: { state: 'definitely-not-started' },
        });
        await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        manager.stop();
        await rm(dir, { recursive: true, force: true });
      }
      await expect(access(dir)).rejects.toMatchObject({ code: 'ENOENT' });
    },
    30_000,
  );
});
