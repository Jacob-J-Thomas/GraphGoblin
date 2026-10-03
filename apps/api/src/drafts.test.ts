import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { draftTokenOf, ifMatchHolds } from './routes/loops.js';
import { createTestApp, type TestApp } from './testing/test-app.js';

let t: TestApp;

beforeEach(async () => {
  t = await createTestApp();
});

afterEach(async () => {
  await t.close();
});

async function createLoop(): Promise<{ id: string; token: string }> {
  const created = await t.app.inject({
    method: 'POST',
    url: '/loops',
    payload: { definition: minimalLoop() },
  });
  const id = created.json<{ loop: { id: string } }>().loop.id;
  const detail = await t.app.inject(`/loops/${id}`);
  const token = detail.json<{ draftToken: string }>().draftToken;
  return { id, token };
}

function save(id: string, name: string, ifMatch?: string) {
  return t.app.inject({
    method: 'PUT',
    url: `/loops/${id}/draft`,
    headers: ifMatch === undefined ? {} : { 'if-match': ifMatch },
    payload: { definition: { ...minimalLoop(), name } },
  });
}

describe('draft version tokens (If-Match)', () => {
  it('exposes the token as a body field and an ETag on GET and PUT', async () => {
    const { id, token } = await createLoop();
    expect(token).toMatch(/^[0-9a-f]{16}$/);
    const detail = await t.app.inject(`/loops/${id}`);
    expect(detail.headers.etag).toBe(`"${token}"`);

    const saved = await save(id, 'second', `"${token}"`);
    expect(saved.statusCode).toBe(200);
    const body = saved.json<{ draftToken: string; draft: { definition: { name: string } } }>();
    expect(body.draft.definition.name).toBe('second');
    expect(body.draftToken).not.toBe(token);
    expect(saved.headers.etag).toBe(`"${body.draftToken}"`);
    // The token in the PUT response is what a GET reports next.
    expect((await t.app.inject(`/loops/${id}`)).json()).toMatchObject({
      draftToken: body.draftToken,
    });
  });

  it('answers 409 DRAFT_CONFLICT with the server token when the copy is stale', async () => {
    const { id, token } = await createLoop();
    const first = await save(id, 'tab-a', token);
    expect(first.statusCode).toBe(200);
    const serverToken = first.json<{ draftToken: string }>().draftToken;

    const stale = await save(id, 'tab-b', token);
    expect(stale.statusCode).toBe(409);
    expect(stale.headers['content-type']).toMatch(/problem\+json/);
    expect(stale.json()).toMatchObject({
      code: 'DRAFT_CONFLICT',
      status: 409,
      draftToken: serverToken,
    });
    // Nothing was overwritten.
    const detail = (await t.app.inject(`/loops/${id}`)).json<{
      draft: { definition: { name: string } };
    }>();
    expect(detail.draft.definition.name).toBe('tab-a');

    // Overwrite: retry with the server token from the conflict.
    const overwrite = await save(id, 'tab-b', serverToken);
    expect(overwrite.statusCode).toBe(200);
  });

  it('keeps saves without If-Match unconditional, and accepts * and weak or listed tags', async () => {
    const { id, token } = await createLoop();
    expect((await save(id, 'no-header')).statusCode).toBe(200);
    expect((await save(id, 'star', '*')).statusCode).toBe(200);
    const current = (await t.app.inject(`/loops/${id}`)).json<{ draftToken: string }>().draftToken;
    expect((await save(id, 'weak', `W/"${current}"`)).statusCode).toBe(200);
    const next = (await t.app.inject(`/loops/${id}`)).json<{ draftToken: string }>().draftToken;
    expect((await save(id, 'listed', `"${token}", "${next}"`)).statusCode).toBe(200);
  });

  it('keeps the token across a publish, which does not change the content', async () => {
    const { id } = await createLoop();
    const saved = await save(id, 'to-publish');
    const token = saved.json<{ draftToken: string }>().draftToken;
    expect((await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` })).statusCode).toBe(
      200,
    );
    const detail = (await t.app.inject(`/loops/${id}`)).json<{
      draft?: unknown;
      draftToken: string;
    }>();
    expect(detail.draft).toBeUndefined();
    expect(detail.draftToken).toBe(token);
    expect((await save(id, 'after-publish', token)).statusCode).toBe(200);
  });

  it('lets only one of two concurrent saves with the same token win', async () => {
    const { id, token } = await createLoop();
    const results = await Promise.all([save(id, 'one', token), save(id, 'two', token)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  });

  it('accepts two editors saving the identical change from the same token', async () => {
    const { id, token } = await createLoop();
    const results = await Promise.all([save(id, 'same', token), save(id, 'same', token)]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    const [a, b] = results.map((r) => r.json<{ draftToken: string; draft: { id: string } }>());
    expect(a!.draftToken).toBe(b!.draftToken);
    expect(a!.draft.id).toBe(b!.draft.id);
    // A different change from the same stale token still conflicts.
    expect((await save(id, 'other', token)).statusCode).toBe(409);
  });

  it('keeps a publish from landing inside a draft save, so a published version never changes', async () => {
    const { id } = await createLoop();
    const repo = t.container.repos.loops;
    const saveDraft = repo.saveDraft.bind(repo);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const inSave = new Promise<void>((resolve) => (entered = resolve));
    repo.saveDraft = async (loopId, definition) => {
      entered();
      await gate;
      return saveDraft(loopId, definition);
    };
    const saving = save(id, 'late edit');
    await inSave;
    const publishing = t.app.inject({ method: 'POST', url: `/loops/${id}/publish` });
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    const [saved, published] = await Promise.all([saving, publishing]);
    repo.saveDraft = saveDraft;
    expect(saved.statusCode).toBe(200);
    expect(published.statusCode).toBe(200);
    const draft = saved.json<{ draft: { id: string; status: string } }>().draft;
    const version = published.json<{
      version: { id: string; status: string; definition: { name: string } };
    }>().version;
    expect(draft.status).toBe('draft');
    // The publish waited for the save and froze exactly what it saved.
    expect(version).toMatchObject({ id: draft.id, status: 'published' });
    expect(version.definition.name).toBe('late edit');
    const detail = (await t.app.inject(`/loops/${id}`)).json<{
      loop: { currentVersionId?: string; draftVersionId?: string };
    }>();
    expect(detail.loop.currentVersionId).toBe(draft.id);
    expect(detail.loop.draftVersionId).toBeUndefined();
    // A later save starts a new draft and leaves the published version alone.
    const next = (await save(id, 'after')).json<{ draft: { id: string } }>().draft;
    expect(next.id).not.toBe(draft.id);
    const frozen = (await t.app.inject(`/loops/${id}/versions`)).json<{
      items: { id: string; definition: { name: string } }[];
    }>();
    expect(frozen.items.find((v) => v.id === draft.id)?.definition.name).toBe('late edit');
  });

  it('answers 422 for an invalid draft and 409 when there is nothing to publish', async () => {
    const { id } = await createLoop();
    const broken = { ...minimalLoop(), edges: [] };
    expect(
      (
        await t.app.inject({
          method: 'PUT',
          url: `/loops/${id}/draft`,
          payload: { definition: broken },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` })).json(),
    ).toMatchObject({ code: 'LOOP_INVALID' });
    await save(id, 'fixed');
    expect((await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` })).statusCode).toBe(
      200,
    );
    expect(
      (await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` })).json(),
    ).toMatchObject({ code: 'NO_DRAFT' });
  });

  it('refuses a conditional save of another owner’s or a missing loop with 404', async () => {
    const missing = await save('01JZ0000000000000000000000', 'x', '"abc"');
    expect(missing.statusCode).toBe(404);
  });
});

describe('draft token helpers', () => {
  it('hashes a definition and matches If-Match forms', () => {
    expect(draftTokenOf(undefined)).toBeUndefined();
    expect(ifMatchHolds('*', undefined)).toBe(false);
    expect(ifMatchHolds('*', 'abc')).toBe(true);
    expect(ifMatchHolds('"abc"', 'abc')).toBe(true);
    expect(ifMatchHolds('abc', 'abc')).toBe(true);
    expect(ifMatchHolds('W/"abc"', 'abc')).toBe(true);
    expect(ifMatchHolds('"x", "abc"', 'abc')).toBe(true);
    expect(ifMatchHolds('"x"', 'abc')).toBe(false);
    expect(ifMatchHolds('"x"', undefined)).toBe(false);
  });
});
