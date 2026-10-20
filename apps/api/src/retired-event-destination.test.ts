/**
 * Stored definitions that still publish an Event (#242, ADR-0044). The current contract refuses
 * an exit `event` destination, but a definition saved before the change can still hold one. It
 * is refused before anything executes, with a per-loop diagnostic (409 `LOOP_UPGRADE_REQUIRED`
 * naming the loop, the version and the destination), never a generic 500 or a wedged run.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { LoopDefinitionInput, LoopVersionRecord, RunRecord } from '@graphgoblin/contracts';
import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { createTestApp, type TestApp } from './testing/test-app.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const waitingLoop: LoopDefinitionInput = {
  schemaVersion: CURRENT_DEFINITION_FORMAT,
  name: 'Emits after input',
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    { id: 'ask', kind: 'wait', label: 'Ask', config: { mode: 'input', prompt: '?' } },
    {
      id: 'touch',
      kind: 'mutate',
      label: 'Touch',
      config: {
        operations: [{ op: 'set', path: '/vars/ran', value: { kind: 'literal', value: true } }],
      },
    },
    { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'vars.ran' } },
  ],
  edges: [
    { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'ask' } },
    { id: 'e2', from: { node: 'ask', port: 'out' }, to: { node: 'touch' } },
    { id: 'e3', from: { node: 'touch', port: 'out' }, to: { node: 'done' } },
  ],
};
const directLoop: LoopDefinitionInput = {
  ...waitingLoop,
  name: 'Emits at once',
  nodes: [waitingLoop.nodes[0]!, waitingLoop.nodes[2]!, waitingLoop.nodes[3]!],
  edges: [
    { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'touch' } },
    { id: 'e3', from: { node: 'touch', port: 'out' }, to: { node: 'done' } },
  ],
};
const EXIT_PATH = (def: LoopDefinitionInput) =>
  `/nodes/${def.nodes.findIndex((node) => node.id === 'done')}/config/destinations/1`;

/**
 * Rewrite a stored version as it would be if it had been saved before ADR-0044: its exit also
 * publishes an Event. Draft-run snapshots are immutable in storage, so their trigger is lifted
 * for the rewrite and restored, as an older store would simply hold the row.
 */
async function storeWithEventDestination(app: TestApp, versionId: string): Promise<void> {
  const client = app.container.handle.client;
  const version = (await app.container.repos.loops.getVersion(versionId)) as LoopVersionRecord;
  const stored = structuredClone(version.definition) as unknown as {
    nodes: { kind: string; config: { destinations?: unknown[] } }[];
  };
  for (const node of stored.nodes)
    if (node.kind === 'exit')
      node.config.destinations = [{ kind: 'caller' }, { kind: 'event', eventType: 'loop-done' }];
  const trigger = (
    await client.execute(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'loop_versions_snapshot_immutable'",
    )
  ).rows[0]?.['sql'];
  if (typeof trigger !== 'string') throw new Error('the snapshot trigger is missing');
  await client.execute('DROP TRIGGER loop_versions_snapshot_immutable');
  await client.execute({
    sql: 'UPDATE loop_versions SET definition = ? WHERE id = ?',
    args: [JSON.stringify(stored), versionId],
  });
  await client.execute(trigger);
}

async function publishStored(app: TestApp, definition: LoopDefinitionInput) {
  const loopId = await app.publishLoop(definition);
  const version = (await app.container.repos.loops.getLatestPublished(loopId))!;
  await storeWithEventDestination(app, version.id);
  return { loopId, version };
}

function expectUpgradeRequired(
  response: { statusCode: number; json: <T>() => T },
  identity: { loopId: string; versionId: string; version: number; path: string },
) {
  expect(response.statusCode).toBe(409);
  const body = response.json<Record<string, unknown>>();
  expect(body).toMatchObject({
    code: 'LOOP_UPGRADE_REQUIRED',
    loopId: identity.loopId,
    versionId: identity.versionId,
    version: identity.version,
    paths: [identity.path],
  });
  // Actionable: names the destination and both ways out.
  expect(body['detail']).toEqual(expect.stringContaining(identity.path));
  expect(body['detail']).toEqual(expect.stringMatching(/Subloop/));
  expect(body['detail']).toEqual(expect.stringMatching(/delete the loop|reset/));
}

describe('a stored definition with an Event destination (#242)', () => {
  it('is refused on every read of the loop and its versions with a per-loop diagnostic', async () => {
    t = await createTestApp();
    const { loopId, version } = await publishStored(t, directLoop);
    const identity = {
      loopId,
      versionId: version.id,
      version: version.version,
      path: EXIT_PATH(directLoop),
    };
    for (const url of [
      `/loops/${loopId}`,
      `/loops/${loopId}/versions`,
      `/loops/${loopId}/versions/${version.id}`,
      `/loops/${loopId}/export`,
    ])
      expectUpgradeRequired(await t.app.inject(url), identity);
    // A stored draft holding one cannot be published either.
    await t.app.inject({
      method: 'PUT',
      url: `/loops/${loopId}/draft`,
      payload: { definition: { ...directLoop, name: 'Emits at once (draft)' } },
    });
    const draftId = (await t.container.repos.loops.getLoop(loopId))!.draftVersionId!;
    await storeWithEventDestination(t, draftId);
    expectUpgradeRequired(await t.app.inject({ method: 'POST', url: `/loops/${loopId}/publish` }), {
      ...identity,
      versionId: draftId,
      version: 2,
    });
    // The remedy stays available: the loop can still be deleted.
    expect((await t.app.inject({ method: 'DELETE', url: `/loops/${loopId}` })).statusCode).toBe(
      204,
    );
  });

  it('is refused before a run starts, and a parent calling it fails before any child exists', async () => {
    t = await createTestApp();
    const { loopId, version } = await publishStored(t, directLoop);
    const identity = {
      loopId,
      versionId: version.id,
      version: version.version,
      path: EXIT_PATH(directLoop),
    };
    expectUpgradeRequired(
      await t.app.inject({ method: 'POST', url: `/loops/${loopId}/runs`, payload: {} }),
      identity,
    );
    expect(await t.container.repos.runs.list({ loopId })).toEqual([]);

    const parentId = await t.publishLoop({
      schemaVersion: CURRENT_DEFINITION_FORMAT,
      name: 'Calls an emitting loop',
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
        { id: 'sub', kind: 'subloop', label: 'Sub', config: { loopRef: { loopId } } },
        { id: 'done', kind: 'exit', label: 'Done', config: {} },
      ],
      edges: [
        { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'sub' } },
        { id: 'e2', from: { node: 'sub', port: 'out' }, to: { node: 'done' } },
      ],
    });
    const started = await t.app.inject({
      method: 'POST',
      url: `/loops/${parentId}/runs`,
      payload: {},
    });
    await t.idle();
    const parent = (
      await t.app.inject(`/runs/${started.json<{ run: RunRecord }>().run.id}`)
    ).json<RunRecord>();
    expect(parent).toMatchObject({
      status: 'failed',
      failure: {
        code: 'LOOP_UPGRADE_REQUIRED',
        resumable: false,
        nodeId: 'sub',
        details: { loopId, versionId: version.id, paths: [identity.path] },
      },
    });
    expect(await t.container.repos.runs.list({ loopId })).toEqual([]);
  });

  it.each(['published version', 'draft-run snapshot'] as const)(
    'a run already pinned to a %s holding one fails explicitly before it executes again',
    async (pin) => {
      t = await createTestApp();
      const loopId = await t.publishLoop(waitingLoop);
      let draftId: string | undefined;
      if (pin === 'draft-run snapshot') {
        await t.app.inject({
          method: 'PUT',
          url: `/loops/${loopId}/draft`,
          payload: { definition: { ...waitingLoop, name: 'Emits after input (draft)' } },
        });
        draftId = (await t.container.repos.loops.getLoop(loopId))!.draftVersionId!;
      }
      const started = await t.app.inject({
        method: 'POST',
        url: `/loops/${loopId}/runs`,
        payload: draftId ? { versionId: draftId, allowDraft: true } : {},
      });
      await t.idle();
      const waiting = (
        await t.app.inject(`/runs/${started.json<{ run: RunRecord }>().run.id}`)
      ).json<RunRecord>();
      expect(waiting.status).toBe('waiting');
      // The run pins exactly what this case names: a published version, or a draft-run snapshot.
      expect(waiting.pinned.source).toBe(draftId ? 'draft' : 'published');
      expect((await t.container.repos.loops.getVersion(waiting.versionId))?.status).toBe(
        draftId ? 'snapshot' : 'published',
      );
      // The run was admitted before the upgrade; its pinned definition holds the destination.
      await storeWithEventDestination(t, waiting.versionId);

      const answered = await t.app.inject({
        method: 'POST',
        url: `/runs/${waiting.id}/input`,
        payload: { waitId: waiting.waiting!.waitId, input: 'go' },
      });
      expect(answered.statusCode).toBe(200);
      await t.idle();
      const failed = (await t.app.inject(`/runs/${waiting.id}`)).json<RunRecord>();
      expect(failed).toMatchObject({
        status: 'failed',
        failure: {
          code: 'LOOP_UPGRADE_REQUIRED',
          resumable: false,
          details: { loopId, versionId: waiting.versionId, paths: [EXIT_PATH(waitingLoop)] },
        },
      });
      // Nothing after the wait executed, and the failure was finalized.
      const events = (await t.app.inject(`/runs/${waiting.id}/events`)).json<{
        items: { type: string; nodeId?: string }[];
      }>().items;
      expect(events.filter((event) => event.nodeId === 'touch')).toEqual([]);
      const row = await t.container.handle.client.execute({
        sql: 'SELECT finalized_at FROM runs WHERE id = ?',
        args: [waiting.id],
      });
      expect(row.rows[0]?.['finalized_at']).not.toBeNull();
      // The inspector's read of the pinned definition gets the diagnostic, not a 500.
      expect(
        (await t.app.inject(`/loops/${loopId}/versions/${waiting.versionId}`)).json(),
      ).toMatchObject({ status: 409, code: 'LOOP_UPGRADE_REQUIRED' });
    },
  );

  it('refuses a webhook delivery deterministically and logs the diagnostic, saving nothing', async () => {
    t = await createTestApp();
    const hooked: LoopDefinitionInput = {
      ...directLoop,
      name: 'Hooked emitter',
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Hook', config: { type: 'webhook' } },
        ...directLoop.nodes.slice(1),
      ],
    };
    const { loopId, version } = await publishStored(t, hooked);
    const path = (await t.app.inject(`/loops/${loopId}/triggers`)).json<{
      webhooks: { path: string }[];
    }>().webhooks[0]!.path;
    const delivered = await t.app.inject({
      method: 'POST',
      url: path,
      payload: '{"n":1}',
      headers: { 'content-type': 'application/json' },
    });
    expect(delivered.statusCode).toBe(409);
    const body = delivered.json<Record<string, unknown>>();
    expect(body).toMatchObject({ code: 'LOOP_UPGRADE_REQUIRED' });
    // The public sender learns nothing about the loop.
    expect(JSON.stringify(body)).not.toContain(loopId);
    expect(t.logger.lines).toContainEqual(
      expect.objectContaining({
        level: 'error',
        msg: 'webhook admission refused: the loop needs an upgrade',
        obj: expect.objectContaining({
          loopId,
          versionId: version.id,
          paths: [EXIT_PATH(hooked)],
          code: 'LOOP_UPGRADE_REQUIRED',
        }),
      }),
    );
    for (const table of ['webhook_receipts', 'runs'])
      expect(
        (await t.container.handle.client.execute(`SELECT count(*) AS n FROM ${table}`)).rows[0]?.[
          'n'
        ],
      ).toBe(0);
  });
});
