/**
 * Cold start over a store that still holds a retired Event destination (#242, ADR-0044). The
 * built API (`dist/main.js`) starts on a disposable store prepared as an older build would have
 * left it: one loop's published version, or only a draft-run snapshot, has an exit that publishes
 * an Event. Startup must succeed; the affected loop answers 409 `LOOP_UPGRADE_REQUIRED` per loop,
 * and the rest of the store keeps working.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { LoopDefinitionInput, LoopVersionRecord, RunRecord } from '@graphgoblin/contracts';
import { CURRENT_DEFINITION_FORMAT, LoopDefinitionSchema } from '@graphgoblin/contracts';
import { RunManager } from '@graphgoblin/engine';
import { createFakePorts, DEFAULT_TEST_SETTINGS } from '@graphgoblin/engine/testing';
import {
  openDatabase,
  SqliteEventStore,
  SqliteLoopRepository,
  SqliteRunRepository,
  SqliteTriggerAdmission,
} from '@graphgoblin/infrastructure/sqlite';
import { createApiProcessFixture, eventually } from './testing/api-subprocess.js';

const fixtures: Awaited<ReturnType<typeof createApiProcessFixture>>[] = [];
afterEach(async () => {
  for (const created of fixtures.splice(0)) await created.dispose();
}, 60_000);

const waiting: LoopDefinitionInput = {
  schemaVersion: CURRENT_DEFINITION_FORMAT,
  name: 'Waits, then returns',
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    { id: 'ask', kind: 'wait', label: 'Ask', config: { mode: 'input', prompt: '?' } },
    { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'outputs.ask.value' } },
  ],
  edges: [
    { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'ask' } },
    { id: 'e2', from: { node: 'ask', port: 'out' }, to: { node: 'done' } },
  ],
};
const healthy: LoopDefinitionInput = {
  schemaVersion: CURRENT_DEFINITION_FORMAT,
  name: 'Healthy',
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    { id: 'done', kind: 'exit', label: 'Done', config: { returns: '"healthy"' } },
  ],
  edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
};
const EXIT_PATH = '/nodes/2/config/destinations/1';

/**
 * Prepare the store as a build from before ADR-0044 left it, through the storage adapters, then
 * give the named version an exit that also publishes an Event. Draft-run snapshots are immutable
 * in storage, so their trigger is lifted for the rewrite and restored.
 */
async function prepare(state: 'published version' | 'draft snapshot only') {
  const f = await createApiProcessFixture();
  fixtures.push(f);
  const token = await f.createKey();
  const handle = openDatabase({ url: f.env.GG_DB_URL! });
  await handle.migrate();
  const fake = createFakePorts();
  const events = new SqliteEventStore(handle.db, fake.clock);
  const runs = new SqliteRunRepository(handle.db);
  const loops = new SqliteLoopRepository(handle.db, fake.clock, fake.ids);
  const publish = async (definition: LoopDefinitionInput) => {
    const { loop } = await loops.create('local', LoopDefinitionSchema.parse(definition));
    return (await loops.publish(loop.id)) as LoopVersionRecord;
  };
  const healthyVersion = await publish(healthy);
  const affected = await publish(waiting);
  let target = affected;
  let pinnedRun: RunRecord | undefined;
  if (state === 'draft snapshot only') {
    const draft = await loops.saveDraft(
      affected.loopId,
      LoopDefinitionSchema.parse({ ...waiting, name: 'Waits, then returns (draft)' }),
    );
    const manager = new RunManager(
      { ...fake, events, runs, loops, admission: new SqliteTriggerAdmission(handle.db, events) },
      DEFAULT_TEST_SETTINGS,
    );
    await manager.start();
    pinnedRun = await manager.startRun({
      ownerId: 'local',
      loopId: affected.loopId,
      versionId: draft.id,
      allowDraft: true,
      source: 'manual.api',
    });
    await manager.waitForIdle();
    manager.stop();
    pinnedRun = (await runs.get(pinnedRun.id))!;
    target = (await loops.getVersion(pinnedRun.versionId))!;
    expect(pinnedRun).toMatchObject({ status: 'waiting', pinned: { source: 'draft' } });
    expect(target.status).toBe('snapshot');
  }
  const stored = structuredClone(target.definition) as unknown as {
    nodes: { kind: string; config: { destinations?: unknown[] } }[];
  };
  for (const node of stored.nodes)
    if (node.kind === 'exit')
      node.config.destinations = [{ kind: 'caller' }, { kind: 'event', eventType: 'loop-done' }];
  const trigger = (
    await handle.client.execute(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'loop_versions_snapshot_immutable'",
    )
  ).rows[0]?.['sql'];
  if (typeof trigger !== 'string') throw new Error('the snapshot trigger is missing');
  await handle.client.execute('DROP TRIGGER loop_versions_snapshot_immutable');
  await handle.client.execute({
    sql: 'UPDATE loop_versions SET definition = ? WHERE id = ?',
    args: [JSON.stringify(stored), target.id],
  });
  await handle.client.execute(trigger);
  handle.close();

  const origin = `http://127.0.0.1:${f.port}`;
  const headers = { authorization: `Bearer ${token}` };
  const call = (method: string, path: string, body?: unknown) =>
    fetch(origin + path, {
      method,
      headers: body === undefined ? headers : { ...headers, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { f, token, call, healthyVersion, affected, target, pinnedRun };
}

describe('cold start over a stored retired Event destination (#242)', () => {
  it.each(['published version', 'draft snapshot only'] as const)(
    'starts with a %s holding one, refuses that loop per loop and serves the rest',
    async (state) => {
      const { f, token, call, healthyVersion, affected, target, pinnedRun } = await prepare(state);
      const api = f.run();
      await f.ready(api, token);
      expect(api.exited).toBe(false);

      // The affected definition answers the per-loop diagnostic, never a store refusal or a 500.
      const refused = await call(
        'GET',
        state === 'published version'
          ? `/loops/${affected.loopId}`
          : `/loops/${affected.loopId}/versions/${target.id}`,
      );
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({
        code: 'LOOP_UPGRADE_REQUIRED',
        loopId: affected.loopId,
        versionId: target.id,
        paths: [EXIT_PATH],
      });

      // A healthy loop runs to completion.
      const started = await call('POST', `/loops/${healthyVersion.loopId}/runs`, {});
      expect(started.status).toBe(202);
      const runId = ((await started.json()) as { run: RunRecord }).run.id;
      await eventually(
        async () =>
          ((await (await call('GET', `/runs/${runId}`)).json()) as RunRecord).status ===
          'succeeded',
      );

      if (state === 'published version') {
        // The remedy stays available.
        expect((await call('DELETE', `/loops/${affected.loopId}`)).status).toBe(204);
        return;
      }
      // Only the snapshot is affected: the loop itself is readable, and the pinned run fails
      // explicitly when it would execute again, instead of running to an undeliverable exit.
      expect((await call('GET', `/loops/${affected.loopId}`)).status).toBe(200);
      const answered = await call('POST', `/runs/${pinnedRun!.id}/input`, {
        waitId: pinnedRun!.waiting!.waitId,
        input: 'go',
      });
      expect(answered.status).toBe(200);
      await eventually(
        async () =>
          ((await (await call('GET', `/runs/${pinnedRun!.id}`)).json()) as RunRecord).status ===
          'failed',
      );
      expect(await (await call('GET', `/runs/${pinnedRun!.id}`)).json()).toMatchObject({
        failure: {
          code: 'LOOP_UPGRADE_REQUIRED',
          resumable: false,
          details: { versionId: target.id },
        },
      });
    },
    120_000,
  );
});
