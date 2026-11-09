import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CURRENT_DEFINITION_FORMAT,
  LoopDefinitionSchema,
  VoicePreviewSchema,
  type LoopDefinition,
  type LoopVersionRecord,
} from '@graphgoblin/contracts';
import { stableHash } from '@graphgoblin/domain';
import { createTestApp, type TestApp } from './testing/test-app.js';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

const definition = () =>
  LoopDefinitionSchema.parse({
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name: 'Stored inference without capture',
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      {
        id: 'think',
        kind: 'inference',
        label: 'Think',
        config: { prompt: { template: 'Answer' }, output: { capture: 'auto' } },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'lastOutput.value' } },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'think' } },
      { id: 'e2', from: { node: 'think', port: 'out' }, to: { node: 'done' } },
    ],
  });

async function storedDefinition(versionId: string): Promise<string> {
  const result = await t.container.handle.client.execute({
    sql: 'SELECT definition FROM loop_versions WHERE id = ?',
    args: [versionId],
  });
  const value = result.rows[0]?.['definition'];
  if (typeof value !== 'string') throw new Error('missing stored definition');
  return value;
}

/** Model a current-format version saved before capture existed, without changing any defaults. */
async function omitCapture(version: LoopVersionRecord): Promise<LoopDefinition> {
  const raw = structuredClone(version.definition);
  for (const node of raw.nodes) if (node.kind === 'inference') delete node.config.output.capture;
  await t.container.handle.client.execute({
    sql: 'UPDATE loop_versions SET definition = ? WHERE id = ?',
    args: [JSON.stringify(raw), version.id],
  });
  return raw;
}

describe('stored additive capture omission', () => {
  it.each(['draft', 'published'] as const)(
    'serves unchanged %s bytes, raw token, history and export, then accepts If-Match',
    async (status) => {
      const created = await t.container.repos.loops.create('local', definition());
      const version =
        status === 'published'
          ? (await t.container.repos.loops.publish(created.loop.id))!
          : created.draft;
      const raw = await omitCapture(version);
      const before = await storedDefinition(version.id);
      const detail = await t.app.inject(`/loops/${created.loop.id}`);
      expect(detail.statusCode, detail.body).toBe(200);
      expect(detail.json()[status === 'draft' ? 'draft' : 'current'].definition).toEqual(raw);
      expect(detail.json().draftToken).toBe(stableHash(raw));
      expect(detail.headers.etag).toBe(`"${stableHash(raw)}"`);

      const single = await t.app.inject(`/loops/${created.loop.id}/versions/${version.id}`);
      expect(single.statusCode, single.body).toBe(200);
      expect(single.json().definition).toEqual(raw);
      const history = await t.app.inject(`/loops/${created.loop.id}/versions`);
      expect(history.statusCode, history.body).toBe(200);
      expect(
        history.json<{ items: LoopVersionRecord[] }>().items.find((item) => item.id === version.id)
          ?.definition,
      ).toEqual(raw);
      const exported = await t.app.inject(
        `/loops/${created.loop.id}/export${status === 'draft' ? '?draft=true' : ''}`,
      );
      expect(exported.statusCode, exported.body).toBe(200);
      expect(exported.json().loop).toEqual(raw);
      expect(await storedDefinition(version.id)).toBe(before);

      const saved = await t.app.inject({
        method: 'PUT',
        url: `/loops/${created.loop.id}/draft`,
        headers: { 'if-match': detail.json().draftToken },
        payload: { definition: { ...raw, name: 'Explicit edit' } },
      });
      expect(saved.statusCode, saved.body).toBe(200);
      expect(saved.json().draft.definition.nodes[1].config.output).not.toHaveProperty('capture');
      const stale = await t.app.inject({
        method: 'PUT',
        url: `/loops/${created.loop.id}/draft`,
        headers: { 'if-match': detail.json().draftToken },
        payload: { definition: { ...raw, name: 'Stale edit' } },
      });
      expect(stale.statusCode).toBe(409);
      if (status === 'published') expect(await storedDefinition(version.id)).toBe(before);
    },
  );

  it('retains omitted auto behavior in a draft run and serves its immutable snapshot unchanged', async () => {
    const created = await t.container.repos.loops.create('local', definition());
    const raw = await omitCapture(created.draft);
    t.harness.script([{ finalText: '{"omittedCapture":"auto"}' }]);
    const started = await t.app.inject({
      method: 'POST',
      url: `/loops/${created.loop.id}/runs`,
      payload: { versionId: created.draft.id, allowDraft: true },
    });
    expect(started.statusCode, started.body).toBe(202);
    const run = started.json().run;
    await t.idle();
    const before = await storedDefinition(run.versionId);
    expect(JSON.parse(before)).toEqual(raw);
    const snapshot = await t.app.inject(`/loops/${created.loop.id}/versions/${run.versionId}`);
    expect(snapshot.statusCode, snapshot.body).toBe(200);
    expect(snapshot.json()).toMatchObject({ status: 'snapshot', definition: raw });
    const finished = await t.app.inject(`/runs/${run.id}`);
    expect(finished.statusCode, finished.body).toBe(200);
    expect(finished.json()).toMatchObject({
      status: 'succeeded',
      result: { omittedCapture: 'auto' },
    });
    expect(await storedDefinition(run.versionId)).toBe(before);
  });

  it('keeps raw voice base and preview hashes consistent through explicit CAS staging', async () => {
    const binding = await t.container.repos.chat.getBinding({
      ownerId: 'local',
      audienceKey: 'gateway',
    });
    const loop = (await t.container.repos.loops.getLoop(binding!.loopId))!;
    const version = (await t.container.repos.loops.getVersion(loop.currentVersionId!))!;
    const raw = await omitCapture(version),
      before = await storedDefinition(version.id);
    const body = { loopId: loop.id, expectedDraftHash: stableHash(raw), expectedConfigRevision: 0 };
    const detail = await t.app.inject(`/loops/${loop.id}`);
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json().draftToken).toBe(body.expectedDraftHash);
    const preview = await t.app.inject({
      method: 'POST',
      url: '/chat/voice/preview',
      payload: body,
    });
    expect(preview.statusCode, preview.body).toBe(200);
    const reviewed = VoicePreviewSchema.parse(preview.json());
    expect(reviewed.baseHash).toBe(stableHash(raw));
    expect(reviewed.previewHash).toBe(stableHash(reviewed.definition));
    expect(await storedDefinition(version.id)).toBe(before);
    expect((await t.container.repos.loops.getLoop(loop.id))?.draftVersionId).toBeUndefined();
    const stageBody = { ...body, expectedPreviewHash: reviewed.previewHash };
    const staged = await t.app.inject({
      method: 'POST',
      url: '/chat/voice/stage',
      payload: stageBody,
    });
    expect(staged.statusCode, staged.body).toBe(200);
    expect(staged.json().draftHash).toBe(reviewed.previewHash);
    const after = (await t.container.repos.loops.getLoop(loop.id))!;
    expect(after.currentVersionId).toBe(version.id);
    expect((await t.container.repos.loops.getVersion(after.draftVersionId!))?.definition).toEqual(
      reviewed.definition,
    );
    expect(await storedDefinition(version.id)).toBe(before);
    expect(
      (await t.app.inject({ method: 'POST', url: '/chat/voice/stage', payload: stageBody }))
        .statusCode,
    ).toBe(409);
  });
});
