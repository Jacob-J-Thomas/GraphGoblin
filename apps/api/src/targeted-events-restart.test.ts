/** Real built API process deaths around receipt commit and run admission; real SQLite, no provider turns. */
import { afterEach, expect, it } from 'vitest';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { createFakePorts } from '@graphgoblin/engine/testing';
import { openDatabase, SqliteLoopRepository } from '@graphgoblin/infrastructure/sqlite';
import { createApiProcessFixture, eventually } from './testing/api-subprocess.js';

const fixtures: Awaited<ReturnType<typeof createApiProcessFixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.dispose();
}, 60_000);

it.each(['before-receipt', 'pending-before-run', 'after-run'] as const)(
  'recovers targeted Event identities across process death: %s',
  { timeout: 180_000 },
  async (phase) => {
    const milestone = (name: string) => process.stdout.write(`[${phase}] ${name}\n`);
    milestone('fixture');
    const f = await createApiProcessFixture({
      prefix: 'gg-wp-d4-',
      portStart: 5750,
      portCount: 10,
    });
    fixtures.push(f);
    milestone('key');
    const token = await f.createKey();
    milestone('key-created');
    const origin = `http://127.0.0.1:${f.port}`;
    async function call(method: string, path: string, body?: unknown) {
      return fetch(origin + path, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    }
    async function start() {
      milestone('start');
      const process = f.run();
      try {
        await f.ready(process, token);
      } finally {
        milestone('startup stdout: ' + process.stdout);
        milestone('startup stderr: ' + process.stderr);
      }
      milestone('ready');
      return process;
    }
    const db = () => openDatabase({ url: `file:${f.databaseFile.replaceAll('\\', '/')}` });
    const seed = db();
    const { clock, ids } = createFakePorts();
    let loop: { id: string };
    try {
      const loops = new SqliteLoopRepository(seed.db, clock, ids);
      const created = await loops.create(
        'local',
        LoopDefinitionSchema.parse({
          schemaVersion: 4,
          name: 'Durable Event',
          nodes: [
            {
              id: 'start',
              kind: 'trigger',
              label: 'Start',
              config: { type: 'event', eventType: 'ready' },
            },
            { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'trigger.payload' } },
          ],
          edges: [{ id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
        }),
      );
      loop = created.loop;
      await loops.publish(loop.id);
    } finally {
      seed.close();
    }
    if (phase !== 'after-run') {
      milestone('storage');
      const h = db();
      try {
        await h.client.execute(
          `CREATE TRIGGER event_crash_fault BEFORE INSERT ON ${phase === 'before-receipt' ? 'event_receipts' : 'runs'} BEGIN SELECT RAISE(ABORT,'receipt-window'); END`,
        );
      } finally {
        h.close();
      }
    }
    let server = await start();
    const body = {
      loopId: loop.id,
      type: 'ready',
      payload: { accepted: 'original' },
      dedupeKey: 'stable-key',
    };
    milestone('post');
    const accepted = await call('POST', '/events', body);
    expect(accepted.status).toBe(phase === 'before-receipt' ? 503 : 202);
    const response = (await accepted.json()) as { id?: string; admissionId?: string };
    type Item = { id: string; admissionId: string; runIds: string[]; delivery: { state: string } };
    async function rows() {
      return ((await (await call('GET', '/events')).json()) as { items: Item[] }).items;
    }
    if (phase !== 'before-receipt')
      await eventually(
        async () =>
          (await rows())[0]?.delivery.state === (phase === 'after-run' ? 'admitted' : 'pending'),
      );
    // SIGKILL ends this built API; a fresh process must discover the same store, without callbacks.
    milestone('kill');
    await server.dispose();
    milestone('killed');
    milestone('storage');
    const h = db();
    let expectedRun: string | undefined;
    try {
      const receipts = (await h.client.execute('SELECT intent FROM event_receipts')).rows;
      expect(receipts).toHaveLength(phase === 'before-receipt' ? 0 : 1);
      if (receipts[0]) {
        const serialized = receipts[0].intent;
        if (typeof serialized !== 'string') throw new Error('saved receipt intent missing');
        expectedRun = (JSON.parse(serialized) as { run: { id: string } }).run.id;
      }
      const runs = (await h.client.execute('SELECT id FROM runs')).rows;
      expect(runs).toHaveLength(phase === 'after-run' ? 1 : 0);
      if (phase !== 'after-run') await h.client.execute('DROP TRIGGER event_crash_fault');
      if (phase === 'pending-before-run')
        await h.client.execute(
          "UPDATE event_receipts SET next_attempt_at='2000-01-01T00:00:00.000Z'",
        );
    } finally {
      h.close();
    }
    server = await start();
    const retry = await call('POST', '/events', { ...body, payload: { changed: true } });
    expect(retry.status).toBe(202);
    const retried = (await retry.json()) as Item & { duplicate: boolean };
    if (phase !== 'before-receipt')
      expect(retried).toMatchObject({
        id: response.id,
        admissionId: response.admissionId,
        duplicate: true,
      });
    await eventually(async () => (await rows())[0]?.delivery.state === 'admitted');
    const [item] = await rows();
    expect(item!.runIds).toHaveLength(1);
    if (expectedRun) expect(item!.runIds).toEqual([expectedRun]);
    const runList = (await (await call('GET', '/runs')).json()) as {
      items: { id: string }[];
    };
    expect(runList.items.map((r) => r.id)).toEqual(item!.runIds);
    const events = (await (await call('GET', `/runs/${item!.runIds[0]}/events`)).json()) as {
      items: { type: string }[];
    };
    expect(events.items.filter((e) => e.type === 'run.queued')).toHaveLength(1);
    milestone('kill');
    await server.dispose();
    milestone('killed');
  },
);
