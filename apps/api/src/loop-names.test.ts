import { LoopRecordSchema, LoopVersionRecordSchema } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './testing/test-app.js';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

const definition = (name: string) => ({ ...minimalLoop(), name });
const create = (name: string) =>
  t.app.inject({
    method: 'POST',
    url: '/loops',
    payload: { definition: definition(name) },
  });
const save = (loopId: string, name: string, token?: string) =>
  t.app.inject({
    method: 'PUT',
    url: `/loops/${loopId}/draft`,
    headers: token === undefined ? {} : { 'if-match': token },
    payload: { definition: definition(name) },
  });
const template = (name: string) =>
  t.app.inject({
    method: 'POST',
    url: '/templates/starter/draft',
    payload: { name },
  });
async function created(name: string) {
  const res = await create(name);
  expect(res.statusCode, res.body).toBe(201);
  const { loop, draft } = res.json<{ loop: unknown; draft: unknown }>();
  return { loop: LoopRecordSchema.parse(loop), draft: LoopVersionRecordSchema.parse(draft) };
}

it('rejects case- and whitespace-equivalent create requests within one owner', async () => {
  await created('Écho  Board');
  const again = await create('\u00a0écho\tboard ');
  expect(again.statusCode, again.body).toBe(409);
  expect(again.json()).toMatchObject({ code: 'LOOP_NAME_CONFLICT' });
});

it('rejects equivalent draft rename without changing the target loop or draft', async () => {
  await created('Nightly Triage');
  const target = await created('Daytime Triage');
  const rename = await save(target.loop.id, ' nightly  TRIAGE ');
  expect(rename.statusCode, rename.body).toBe(409);
  expect(rename.json()).toMatchObject({ code: 'LOOP_NAME_CONFLICT' });
  const stored = (await t.app.inject(`/loops/${target.loop.id}`)).json();
  expect(stored).toMatchObject({ loop: target.loop, draft: target.draft });
  const self = await save(target.loop.id, ' daytime\tTRIAGE ', stored.draftToken);
  expect(self.statusCode, self.body).toBe(200);
  const obsolete = await save(target.loop.id, 'nightly triage', stored.draftToken);
  expect(obsolete.statusCode).toBe(409);
  expect(obsolete.json()).toMatchObject({
    code: 'DRAFT_CONFLICT',
    draftToken: self.json().draftToken,
  });
  const current = await save(target.loop.id, 'nightly triage', self.json().draftToken);
  expect(current.statusCode).toBe(409);
  expect(current.json()).toMatchObject({ code: 'LOOP_NAME_CONFLICT' });
  expect((await t.app.inject(`/loops/${target.loop.id}`)).json()).toMatchObject({
    loop: { id: target.loop.id, name: ' daytime\tTRIAGE ' },
    draft: { id: target.draft.id, definition: { name: ' daytime\tTRIAGE ' } },
  });
});

it('rejects an unchanged imported export with a suggested copy name', async () => {
  const original = await created('Import Fixture');
  const document = {
    format: 'graphgoblin-loop',
    formatVersion: original.draft.definition.schemaVersion,
    exportedAt: original.draft.createdAt,
    loop: original.draft.definition,
  };
  const duplicated = await t.app.inject({
    method: 'POST',
    url: '/loops/import',
    payload: document,
  });
  expect(duplicated.statusCode, duplicated.body).toBe(409);
  expect(duplicated.json()).toMatchObject({
    code: 'LOOP_NAME_CONFLICT',
    suggestedName: 'Import Fixture copy',
  });
  await created('IMPORT FIXTURE  COPY');
  const stale = await t.app.inject({
    method: 'POST',
    url: '/loops/import?name=Import%20Fixture%20copy',
    payload: document,
  });
  expect(stale.statusCode).toBe(409);
  expect(stale.json()).toMatchObject({
    code: 'LOOP_NAME_CONFLICT',
    suggestedName: 'Import Fixture copy copy',
  });
  const current = await t.app.inject({ method: 'POST', url: '/loops/import', payload: document });
  expect(current.json()).toMatchObject({ suggestedName: 'Import Fixture copy 2' });
  const copied = await t.app.inject({
    method: 'POST',
    url: '/loops/import?name=Import%20Fixture%20copy%202',
    payload: document,
  });
  expect(copied.statusCode, copied.body).toBe(201);
  expect(copied.json()).toMatchObject({
    draft: { definition: { ...document.loop, name: 'Import Fixture copy 2' } },
  });
  expect(copied.json().loop.id).not.toBe(original.loop.id);
  expect((await t.app.inject(`/loops/${original.loop.id}`)).json()).toMatchObject({
    loop: original.loop,
  });
});

it('rejects an equivalent template copy and preserves the first returned loop identity', async () => {
  const first = await template('Starter custom draft');
  expect(first.statusCode, first.body).toBe(201);
  const second = await template('starter   Custom draft');
  expect(second.statusCode, second.body).toBe(409);
  expect(second.json()).toMatchObject({
    code: 'LOOP_NAME_CONFLICT',
    suggestedName: 'starter Custom draft copy',
  });
  const { loop } = first.json<{ loop: { id: string } }>();
  expect((await t.app.inject(`/loops/${loop.id}`)).json()).toMatchObject({ loop });
  const copied = await template('starter Custom draft copy');
  expect(copied.statusCode, copied.body).toBe(201);
  expect(copied.json().loop.id).not.toBe(loop.id);
});

it('serializes simultaneous create, rename and copy requests at the public API', async () => {
  const renameTarget = await created('Rename Target');
  const first = await Promise.all([create('Same  Target'), create(' same\tTARGET ')]);
  expect(first.map((res) => res.statusCode).sort()).toEqual([201, 409]);
  const next = await Promise.all([
    create('Shared Target'),
    save(renameTarget.loop.id, 'SHARED  TARGET'),
  ]);
  expect(next.filter((res) => res.statusCode === 409)).toHaveLength(1);
  expect(next.filter((res) => res.statusCode === 200 || res.statusCode === 201)).toHaveLength(1);
  const last = await Promise.all([
    template('Another  Target'),
    t.app.inject({ method: 'POST', url: '/loops/import', payload: definition(' another target ') }),
  ]);
  expect(last.map((res) => res.statusCode).sort()).toEqual([201, 409]);
  for (const res of [...first, ...next, ...last].filter(
    (response) => response.statusCode === 409,
  )) {
    expect(res.json()).toMatchObject({ code: 'LOOP_NAME_CONFLICT' });
  }
});

it('gives a valid copy suggestion without cutting a Unicode surrogate pair', async () => {
  const name = 'x'.repeat(114) + '🚀end!';
  expect(name).toHaveLength(120);
  await created(name);
  const denied = await template(name);
  expect(denied.statusCode, denied.body).toBe(409);
  const { suggestedName } = denied.json<{ suggestedName: string }>();
  expect(suggestedName).toBe('x'.repeat(114) + ' copy');
  expect(suggestedName.length).toBeLessThanOrEqual(120);
  expect((await template(suggestedName)).statusCode).toBe(201);
});

it('rejects names the native text driver cannot preserve and retains valid Unicode', async () => {
  await created('Existing');
  const original = await created('Replacement � and 🚀');
  for (const name of ['Existing\u0000Hidden', 'Replacement \uD800 and 🚀']) {
    const refused = await create(name);
    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.json()).toMatchObject({ code: 'LOOP_NAME_INVALID' });
    const renamed = await save(original.loop.id, name);
    expect(renamed.statusCode, renamed.body).toBe(400);
    expect(renamed.json()).toMatchObject({ code: 'LOOP_NAME_INVALID' });
    const imported = await t.app.inject({
      method: 'POST',
      url: '/loops/import',
      payload: definition(name),
    });
    expect(imported.statusCode, imported.body).toBe(400);
    expect(imported.json()).toMatchObject({ code: 'LOOP_NAME_INVALID' });
    const copied = await template(name);
    expect(copied.statusCode, copied.body).toBe(400);
    expect(copied.json()).toMatchObject({ code: 'LOOP_NAME_INVALID' });
  }
  expect((await t.app.inject(`/loops/${original.loop.id}`)).json()).toMatchObject({
    loop: original.loop,
    draft: original.draft,
  });
});

it('releases a deleted loop name for its owner while preserving name and owner isolation', async () => {
  const original = await created('X');
  const retained = await created('Kept Name');
  const unrelatedOwner = await t.container.repos.apiKeys.create('unrelated-owner', 'owner', ['*']);
  const unrelatedHeaders = { authorization: `Bearer ${unrelatedOwner.token}` };

  const foreignCreate = await t.app.inject({
    method: 'POST',
    url: '/loops',
    headers: unrelatedHeaders,
    payload: { definition: definition('x') },
  });
  expect(foreignCreate.statusCode, foreignCreate.body).toBe(201);
  const foreignPayload = foreignCreate.json<{ loop: unknown; draft: unknown }>();
  const foreignLoop = LoopRecordSchema.parse(foreignPayload.loop);
  const foreignDraft = LoopVersionRecordSchema.parse(foreignPayload.draft);
  expect(foreignLoop.name).toBe('x');
  expect(foreignDraft.definition.name).toBe('x');
  expect(foreignLoop.id).not.toBe(original.loop.id);

  const hiddenForeignLoop = await t.app.inject(`/loops/${foreignLoop.id}`);
  expect(hiddenForeignLoop.statusCode, hiddenForeignLoop.body).toBe(404);
  expect(hiddenForeignLoop.json()).toMatchObject({ code: 'LOOP_NOT_FOUND' });
  const hiddenLocalLoop = await t.app.inject({
    method: 'GET',
    url: `/loops/${original.loop.id}`,
    headers: unrelatedHeaders,
  });
  expect(hiddenLocalLoop.statusCode, hiddenLocalLoop.body).toBe(404);
  expect(hiddenLocalLoop.json()).toMatchObject({ code: 'LOOP_NOT_FOUND' });

  const deleted = await t.app.inject({ method: 'DELETE', url: `/loops/${original.loop.id}` });
  expect(deleted.statusCode, deleted.body).toBe(204);
  const absent = await t.app.inject(`/loops/${original.loop.id}`);
  expect(absent.statusCode, absent.body).toBe(404);
  expect(absent.json()).toMatchObject({ code: 'LOOP_NOT_FOUND' });

  const reused = await created(' x ');
  expect(reused.loop.id).not.toBe(original.loop.id);
  expect(reused.loop.id).not.toBe(foreignLoop.id);
  expect(reused.loop.name).toBe(' x ');
  expect(reused.draft.definition.name).toBe(' x ');

  const retainedConflict = await create(' kept  NAME ');
  expect(retainedConflict.statusCode, retainedConflict.body).toBe(409);
  expect(retainedConflict.json()).toMatchObject({ code: 'LOOP_NAME_CONFLICT' });

  const retainedRead = await t.app.inject(`/loops/${retained.loop.id}`);
  expect(retainedRead.statusCode, retainedRead.body).toBe(200);
  expect(retainedRead.json()).toMatchObject({ loop: retained.loop, draft: retained.draft });

  const activeRead = await t.app.inject(`/loops/${reused.loop.id}`);
  expect(activeRead.statusCode, activeRead.body).toBe(200);
  const activePayload = activeRead.json<{ loop: unknown; draft: unknown }>();
  expect(LoopRecordSchema.parse(activePayload.loop)).toMatchObject({
    id: reused.loop.id,
    name: ' x ',
  });
  expect(LoopVersionRecordSchema.parse(activePayload.draft)).toMatchObject({
    id: reused.draft.id,
    definition: { name: ' x ' },
  });

  const foreignRead = await t.app.inject({
    method: 'GET',
    url: `/loops/${foreignLoop.id}`,
    headers: unrelatedHeaders,
  });
  expect(foreignRead.statusCode, foreignRead.body).toBe(200);
  const foreignReadPayload = foreignRead.json<{ loop: unknown; draft: unknown }>();
  expect(LoopRecordSchema.parse(foreignReadPayload.loop)).toMatchObject(foreignLoop);
  expect(LoopVersionRecordSchema.parse(foreignReadPayload.draft)).toMatchObject(foreignDraft);
});
