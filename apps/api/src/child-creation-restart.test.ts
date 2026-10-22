/** Real built API kills at child admission, observed through one read-only SQLite snapshot. */
import { access } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CURRENT_DEFINITION_FORMAT,
  LoopDefinitionSchema,
  type LoopDefinitionInput,
} from '@graphgoblin/contracts';
import { RunManager } from '@graphgoblin/engine';
import { createFakePorts, DEFAULT_TEST_SETTINGS } from '@graphgoblin/engine/testing';
import {
  openDatabase,
  openReadOnlyDatabaseClient,
  SqliteEventStore,
  SqliteLoopRepository,
  SqliteRunRepository,
  SqliteTriggerAdmission,
} from '@graphgoblin/infrastructure/sqlite';
import { createApiProcessFixture, eventually } from './testing/api-subprocess.js';

const fixtures: Awaited<ReturnType<typeof createApiProcessFixture>>[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.dispose();
    await expect(access(fixture.dataDir)).rejects.toMatchObject({ code: 'ENOENT' });
  }
}, 60_000);

const leaf: LoopDefinitionInput = {
  schemaVersion: CURRENT_DEFINITION_FORMAT,
  name: 'Admission kill leaf',
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    { id: 'done', kind: 'exit', label: 'Done', config: { returns: '"leaf result"' } },
  ],
  edges: [{ id: 'e', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
};
const parent = (name: string, child: string): LoopDefinitionInput => ({
  schemaVersion: CURRENT_DEFINITION_FORMAT,
  name,
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    { id: 'sub', kind: 'subloop', label: 'Sub', config: { loopRef: { loopId: child } } },
    { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'outputs.sub.value.result' } },
  ],
  edges: [
    { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'sub' } },
    { id: 'b', from: { node: 'sub', port: 'out' }, to: { node: 'done' } },
  ],
});

describe('child admission across a real API kill (#320)', () => {
  it.each([0, 5, 25])(
    'kill %sms after admission never exposes an unlinked child and recovers one child per nested parent visit',
    async (delay) => {
      const landings: string[] = [];
      const fixture = await createApiProcessFixture({
        directoryPrefix: 'gg-wp-d1-api-',
        portRange: [5910, 5919],
      });
      fixtures.push(fixture);
      const token = await fixture.createKey();
      const handle = openDatabase({ url: fixture.env.GG_DB_URL! });
      const fake = createFakePorts();
      const events = new SqliteEventStore(handle.db, fake.clock);
      const runs = new SqliteRunRepository(handle.db);
      const loops = new SqliteLoopRepository(handle.db, fake.clock, fake.ids);
      // Queue through the public manager while it is stopped. The built API, rather than this
      // test process, executes every node; observing starts before it can admit a child.
      const manager = new RunManager(
        { ...fake, events, runs, loops, admission: new SqliteTriggerAdmission(handle.db, events) },
        DEFAULT_TEST_SETTINGS,
      );
      manager.stop();
      const publish = async (definition: LoopDefinitionInput) => {
        const { loop } = await loops.create('local', LoopDefinitionSchema.parse(definition));
        await loops.publish(loop.id);
        return loop.id;
      };
      const roots: string[] = [];
      try {
        const bottom = await publish(leaf);
        const middle = await publish(parent('Admission kill middle', bottom));
        const top = await publish(parent('Admission kill top', middle));
        for (let index = 0; index < 12; index += 1)
          roots.push(
            (await manager.startRun({ ownerId: 'local', loopId: top, source: 'manual.api' })).id,
          );
      } finally {
        manager.stop();
        handle.close();
      }

      const observer = openReadOnlyDatabaseClient(fixture.databaseFile);
      const server = fixture.run([], { GG_MAX_CONCURRENT_RUNS: '8' });
      let gap: string | undefined;
      let firstChildAt: number | undefined;
      let observations = 0;
      let childrenAtKill: number | undefined;
      try {
        const deadline = Date.now() + 60_000;
        for (;;) {
          if (server.exited) throw new Error(`API exited before the kill: ${server.stderr}`);
          if (Date.now() >= deadline) throw new Error('No child admission observed within 60s');
          // One statement sees a coherent snapshot. Two separate reads could invent a gap.
          const snapshot = await observer.execute(`
            SELECT c.id, c.parent_run_id, e.seq AS link_seq FROM runs c
            LEFT JOIN run_events e ON e.run_id = c.parent_run_id
              AND e.type = 'child_run.started' AND json_extract(e.payload, '$.childRunId') = c.id
            WHERE c.parent_run_id IS NOT NULL`);
          observations += 1;
          childrenAtKill = snapshot.rows.length;
          const unlinked = snapshot.rows.find((row) => row.link_seq === null);
          if (unlinked) {
            if (typeof unlinked.id !== 'string') throw new Error('Expected a stored child id');
            gap = unlinked.id;
          }
          if (snapshot.rows.length && firstChildAt === undefined) firstChildAt = Date.now();
          if (gap || (firstChildAt !== undefined && Date.now() - firstChildAt >= delay)) {
            server.child.kill('SIGKILL');
            break;
          }
          // Yield to I/O without a polling delay that could conceal the old commit/link gap.
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        await server.waitForExit();
        const restarted = fixture.run();
        await fixture.ready(restarted, token);
        await eventually(async () => {
          const result = await observer.execute(
            'SELECT status FROM runs WHERE parent_run_id IS NULL',
          );
          return (
            result.rows.length === roots.length &&
            result.rows.every((row) => row.status === 'succeeded')
          );
        });
        const perParent = await observer.execute(`
          SELECT p.id, count(c.id) AS children FROM runs p
          JOIN runs c ON c.parent_run_id = p.id GROUP BY p.id`);
        const counts = perParent.rows.map((row) => Number(row.children));
        landings.push(
          `delay=${delay}ms snapshots=${observations} children-at-kill=${childrenAtKill} unlinked=${gap ?? 'none'} parents=${counts.length} child-counts=${counts.join(',')}`,
        );
        process.stdout.write(`child admission kill: ${landings.at(-1)}\n`);
        // Assert cardinality first so the pre-fix failure demonstrates the recovery duplicate.
        expect(counts).toEqual(Array<number>(24).fill(1));
        expect(gap).toBeUndefined();
        const finishes = await observer.execute(`
          SELECT run_id, count(*) AS finishes FROM run_events
          WHERE type = 'child_run.finished' GROUP BY run_id`);
        expect(finishes.rows.map((row) => Number(row.finishes))).toEqual(Array<number>(24).fill(1));
        const results = await observer.execute(
          'SELECT result FROM runs WHERE parent_run_id IS NULL',
        );
        expect(
          results.rows.map((row) => {
            if (typeof row.result !== 'string') throw new Error('Expected stored JSON result text');
            return JSON.parse(row.result) as unknown;
          }),
        ).toEqual(Array<string>(12).fill('leaf result'));
        await restarted.dispose();
      } finally {
        observer.close();
      }
    },
    240_000,
  );
});
