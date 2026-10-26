/** External marker effects across real built-API kills (#321). */
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CURRENT_DEFINITION_FORMAT,
  type LoopDefinitionInput,
  type RunEvent,
  type RunRecord,
} from '@graphgoblin/contracts';
import { createApiProcessFixture, eventually } from './testing/api-subprocess.js';

const fixtures: Awaited<ReturnType<typeof createApiProcessFixture>>[] = [];
async function markerRunning(dir: string) {
  return (await readdir(dir))
    .filter((name) => name.startsWith('marker.active-'))
    .some((name) => {
      try {
        process.kill(Number(name.slice('marker.active-'.length)), 0);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
        throw error;
      }
    });
}
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    // Release a marker process orphaned by the deliberate hard kill, including on assertion failure.
    await writeFile(join(fixture.dataDir, 'release'), 'done');
    await eventually(async () => !(await markerRunning(fixture.dataDir)));
    await fixture.dispose();
    await expect(access(fixture.dataDir)).rejects.toMatchObject({ code: 'ENOENT' });
  }
}, 60_000);

describe('script effects across a real API kill (#321)', () => {
  it.each(['before-dispatch', 'after-dispatch', 'after-completion'] as const)(
    '%s never repeats an effect without an explicit resume',
    async (boundary) => {
      // The shared fixture honors GG_TEST_PORT_START/COUNT for isolated integration gates.
      const fixture = await createApiProcessFixture({
        prefix: 'gg-wp-d1-int-script-',
      });
      fixtures.push(fixture);
      const marker = join(fixture.dataDir, 'marker');
      const release = join(fixture.dataDir, 'release');
      const script = fileURLToPath(
        new URL('../scripts/uncertain-script-marker.mjs', import.meta.url),
      );
      if (boundary !== 'after-dispatch') await writeFile(release, 'done');
      const token = await fixture.createKey();
      const origin = `http://127.0.0.1:${fixture.port}`;
      async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
        const response = await fetch(origin + path, {
          method,
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
        });
        if (!response.ok)
          throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
        return (await response.json()) as T;
      }
      const count = async () => {
        try {
          return (await readFile(marker, 'utf8')).match(/effect\n/g)?.length ?? 0;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
          throw error;
        }
      };
      let server = fixture.run();
      await fixture.ready(server, token);
      const waitBefore = boundary === 'before-dispatch';
      const waitAfter = boundary === 'after-completion';
      const path = [
        'start',
        ...(waitBefore ? ['before'] : []),
        'script',
        ...(waitAfter ? ['after'] : []),
        'done',
      ];
      const definition: LoopDefinitionInput = {
        schemaVersion: CURRENT_DEFINITION_FORMAT,
        name: `Script kill ${boundary}`,
        nodes: [
          { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
          ...(waitBefore
            ? [
                {
                  id: 'before',
                  kind: 'wait' as const,
                  label: 'Before',
                  config: { mode: 'input' as const, prompt: 'Before dispatch' },
                },
              ]
            : []),
          {
            id: 'script',
            kind: 'script',
            label: 'Marker',
            config: {
              command: process.execPath,
              args: [script, marker, release, '60000'],
              cwd: fixture.dataDir,
            },
          },
          ...(waitAfter
            ? [
                {
                  id: 'after',
                  kind: 'wait' as const,
                  label: 'After',
                  config: { mode: 'input' as const, prompt: 'After completion' },
                },
              ]
            : []),
          { id: 'done', kind: 'exit', label: 'Done', config: {} },
        ],
        edges: path.slice(1).map((node, index) => ({
          id: `e${index}`,
          from: { node: path[index]!, port: 'out' },
          to: { node },
        })),
      };
      const { loop } = await call<{ loop: { id: string } }>('POST', '/loops', { definition });
      await call('POST', `/loops/${loop.id}/publish`);
      const { run } = await call<{ run: RunRecord }>('POST', `/loops/${loop.id}/runs`, {
        triggerNodeId: 'start',
      });
      const get = () => call<RunRecord>('GET', `/runs/${run.id}`);
      const events = async () =>
        (await call<{ items: RunEvent[] }>('GET', `/runs/${run.id}/events?limit=500`)).items;
      if (boundary === 'after-dispatch') await eventually(async () => (await count()) === 1);
      else await eventually(async () => (await get()).status === 'waiting');
      expect(await count()).toBe(waitBefore ? 0 : 1);
      server.child.kill('SIGKILL');
      await server.waitForExit();
      await writeFile(release, 'done');
      server = fixture.run();
      await fixture.ready(server, token);
      if (boundary === 'after-dispatch') {
        await eventually(async () => ['failed', 'succeeded'].includes((await get()).status));
        const recovered = await get();
        console.warn(
          JSON.stringify({
            boundary,
            markerCount: await count(),
            status: recovered.status,
            failure: recovered.failure?.code,
          }),
        );
        expect(await count()).toBe(1);
        expect(recovered.failure).toMatchObject({
          code: 'SCRIPT_OUTCOME_UNCERTAIN',
          resumable: true,
          script: { state: 'outcome-uncertain' },
        });
        expect(recovered.failure?.message).toMatch(/may already have produced its effect/);
        const first = (await events()).filter((event) => event.type === 'script.dispatched');
        await call('POST', `/runs/${run.id}/resume`, {
          observedSeq: (await call<{ recovery: { observedSeq: number } }>('GET', `/runs/${run.id}`))
            .recovery.observedSeq,
          retryUncertainScript: true,
        });
        await eventually(async () => (await get()).status === 'succeeded');
        expect(await count()).toBe(2);
        const dispatches = (await events()).filter((event) => event.type === 'script.dispatched');
        expect(dispatches).toHaveLength(2);
        expect(dispatches[1]!.dispatchId).not.toBe(first[0]!.dispatchId);
      } else {
        const parked = await get();
        expect(parked.status).toBe('waiting');
        await call('POST', `/runs/${run.id}/input`, {
          waitId: parked.waiting!.waitId,
          input: null,
        });
        await eventually(async () => (await get()).status === 'succeeded');
        console.warn(
          JSON.stringify({ boundary, markerCount: await count(), status: (await get()).status }),
        );
        expect(await count()).toBe(1);
      }
      await server.dispose();
    },
    180_000,
  );
});
