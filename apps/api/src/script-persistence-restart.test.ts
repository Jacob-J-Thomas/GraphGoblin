/** Real SQLite outcome faults and pre-dispatch-marker histories, against the built API (#321). */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CURRENT_DEFINITION_FORMAT,
  type LoopDefinitionInput,
  type RunEvent,
  type RunRecord,
} from '@graphgoblin/contracts';
import { openDatabase } from '@graphgoblin/infrastructure/sqlite';
import { createApiProcessFixture, eventually } from './testing/api-subprocess.js';

type Fixture = Awaited<ReturnType<typeof createApiProcessFixture>>;
type Server = ReturnType<Fixture['run']>;
const fixtures: { fixture: Fixture; servers: Server[] }[] = [];
async function markerRunning(dir: string) {
  return (await readdir(dir)).some((name) => {
    if (!name.startsWith('marker.active-')) return false;
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
  for (const { fixture, servers } of fixtures.splice(0)) {
    await writeFile(join(fixture.dataDir, 'release'), 'done');
    await eventually(async () => !(await markerRunning(fixture.dataDir)));
    for (const server of servers) await server.dispose();
    // This round retains owned stores for inspection; routine CI disposal remains available.
    if (process.env.GG_WP_D1_KEEP_STORES !== '1') await fixture.dispose();
  }
}, 60_000);

async function setup() {
  const fixture = await createApiProcessFixture({
    directoryPrefix: 'gg-wp-d1-outcome-',
    portRange: [5690, 5699],
  });
  const servers: Server[] = [];
  fixtures.push({ fixture, servers });
  const token = await fixture.createKey();
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`http://127.0.0.1:${fixture.port}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
    });
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status}`);
    return (await response.json()) as T;
  };
  const boot = async () => {
    const server = fixture.run();
    servers.push(server);
    await fixture.ready(server, token);
    return server;
  };
  const server = await boot();
  const marker = join(fixture.dataDir, 'marker');
  const release = join(fixture.dataDir, 'release');
  const definition: LoopDefinitionInput = {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name: 'Script outcome persistence',
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      {
        id: 'script',
        kind: 'script',
        label: 'Effect',
        config: {
          command: process.execPath,
          args: [
            fileURLToPath(new URL('../scripts/uncertain-script-marker.mjs', import.meta.url)),
            marker,
            release,
            '60000',
          ],
          cwd: fixture.dataDir,
        },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'script' } },
      { id: 'b', from: { node: 'script', port: 'out' }, to: { node: 'done' } },
    ],
  };
  const { loop } = await call<{ loop: { id: string } }>('POST', '/loops', { definition });
  await call('POST', `/loops/${loop.id}/publish`);
  const { run } = await call<{ run: RunRecord }>('POST', `/loops/${loop.id}/runs`, {
    triggerNodeId: 'start',
  });
  const get = () => call<RunRecord>('GET', `/runs/${run.id}`);
  const events = async () =>
    (await call<{ items: RunEvent[] }>('GET', `/runs/${run.id}/events?limit=500`)).items;
  const count = async () => {
    try {
      return (await readFile(marker, 'utf8')).match(/effect\n/g)?.length ?? 0;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw error;
    }
  };
  await eventually(async () => (await count()) === 1);
  return { fixture, call, boot, server, release, run, get, events, count };
}

describe('script outcomes survive storage failure and upgrade (#321)', () => {
  it.each(['node.progress', 'node.finished'] as const)(
    '%s refusal preserves uncertainty across a real restart and deliberate retry',
    async (type) => {
      const f = await setup();
      const db = openDatabase({ url: `file:${f.fixture.databaseFile.replaceAll('\\', '/')}` });
      try {
        const dispatch = (await f.events()).find((event) => event.type === 'script.dispatched')!;
        await db.client.execute(`CREATE TRIGGER refuse_script_outcome BEFORE INSERT ON run_events
          WHEN NEW.run_id = '${f.run.id}' AND NEW.type = '${type}' AND NEW.node_id = 'script'
          BEGIN SELECT RAISE(ABORT, 'WP_D1_OUTCOME_FAULT'); END;`);
        await writeFile(f.release, 'done');
        await eventually(async () => (await f.get()).status === 'failed');
        const failed = await f.get();
        f.server.child.kill('SIGKILL');
        await f.server.waitForExit();
        await f.boot();
        const recovered = await f.get();
        expect(await f.count()).toBe(1);
        await db.client.execute('DROP TRIGGER refuse_script_outcome');
        await f.call('POST', `/runs/${f.run.id}/resume`);
        await eventually(async () => (await f.get()).status === 'succeeded');
        console.warn(
          JSON.stringify({
            boundary: type,
            failure: failed.failure?.code,
            script: failed.failure?.script,
            recovered: recovered.failure?.code,
            markerAfterResume: await f.count(),
            store: f.fixture.dataDir,
          }),
        );
        expect(failed.failure).toMatchObject({
          code: 'SCRIPT_OUTCOME_UNCERTAIN',
          nodeId: 'script',
          resumable: true,
          script: {
            visitId: dispatch.visitId,
            dispatchId: dispatch.dispatchId,
            state: 'outcome-uncertain',
          },
        });
        expect(recovered.failure).toEqual(failed.failure);
        expect(await f.count()).toBe(2);
        const dispatches = (await f.events()).filter((event) => event.type === 'script.dispatched');
        expect(dispatches).toHaveLength(2);
        expect(dispatches[1]!.dispatchId).not.toBe(dispatch.dispatchId);
      } finally {
        db.close();
      }
    },
    180_000,
  );

  it('a constructed pre-change unfinished script history never automatically repeats its effect', async () => {
    const f = await setup();
    f.server.child.kill('SIGKILL');
    await f.server.waitForExit();
    await writeFile(f.release, 'done');
    await eventually(async () => !(await markerRunning(f.fixture.dataDir)));
    const db = openDatabase({ url: `file:${f.fixture.databaseFile.replaceAll('\\', '/')}` });
    try {
      // Construct the target build's valid prefix, which predates script.dispatched.
      await db.client.execute({
        sql: "DELETE FROM run_events WHERE run_id = ? AND type = 'script.dispatched'",
        args: [f.run.id],
      });
      await db.client.execute({
        sql: 'UPDATE runs SET last_event_seq = (SELECT MAX(seq) FROM run_events WHERE run_id = ?) WHERE id = ?',
        args: [f.run.id, f.run.id],
      });
    } finally {
      db.close();
    }
    const recoveredServer = await f.boot();
    await eventually(async () => ['failed', 'succeeded'].includes((await f.get()).status));
    const recovered = await f.get();
    console.warn(
      JSON.stringify({
        boundary: 'pre-change-history',
        status: recovered.status,
        failure: recovered.failure,
        markerBeforeChoice: await f.count(),
        store: f.fixture.dataDir,
      }),
    );
    expect(await f.count()).toBe(1);
    expect(recovered.failure).toMatchObject({
      code: 'SCRIPT_OUTCOME_UNCERTAIN',
      nodeId: 'script',
      resumable: true,
      script: { state: 'outcome-uncertain' },
    });
    expect(recovered.failure?.script?.dispatchId).toBeUndefined();
    expect((await f.events()).filter((event) => event.type === 'script.dispatched')).toHaveLength(
      0,
    );
    await recoveredServer.dispose();
    await f.boot();
    expect((await f.get()).failure).toEqual(recovered.failure);
    // The failed run is preserved across another restart, then an explicit choice retries it.
    await f.call('POST', `/runs/${f.run.id}/resume`);
    await eventually(async () => (await f.get()).status === 'succeeded');
    expect(await f.count()).toBe(2);
    const dispatches = (await f.events()).filter((event) => event.type === 'script.dispatched');
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]!.visitId).toBe(recovered.failure?.script?.visitId);
  }, 180_000);
});
