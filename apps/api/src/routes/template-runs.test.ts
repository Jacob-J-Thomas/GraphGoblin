import { afterEach, describe, expect, it } from 'vitest';
import {
  TemplateInstantiateResponseSchema,
  TemplateListResponseSchema,
} from '@graphgoblin/contracts';
import { fakeUlid } from '@graphgoblin/contracts/testing';
import { createTestApp, type TestApp } from '../testing/test-app.js';
import { ParentSubjectSchema, subjectJson } from '../templates/subjects.js';
import { decodeRunCursor } from '../templates/run-view.js';
describe('API template subject view and stable paging', () => {
  let t: TestApp | undefined;
  afterEach(async () => t?.close());
  async function populated() {
    t = await createTestApp({ requireApiKey: true });
    const key = await t.container.repos.apiKeys.create('local', 'reader and author', [
      'loops:read',
      'loops:write',
      'runs:read',
      'runs:write',
    ]);
    const headers = { authorization: 'Bearer ' + key.token };
    const entry = TemplateListResponseSchema.parse(
      (await t.app.inject({ method: 'GET', url: '/templates', headers })).json(),
    ).items[0]!;
    const instance = TemplateInstantiateResponseSchema.parse(
      (
        await t.app.inject({
          method: 'POST',
          url: '/templates/starter/instantiate',
          headers,
          payload: { settings: entry.defaultSettings },
        })
      ).json(),
    ).instance;
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/loops/' + instance.parentLoopId + '/publish',
          headers,
        })
      ).statusCode,
    ).toBe(200);
    const ids: string[] = [];
    for (let index = 0; index < 4; index++) {
      const response = await t.app.inject({
        method: 'POST',
        url: '/loops/' + instance.parentLoopId + '/runs',
        headers,
        payload: {},
      });
      expect(response.statusCode, response.body).toBe(202);
      ids.push(response.json<{ run: { id: string } }>().run.id);
    }
    await t.idle();
    for (let index = 0; index < 3; index++) {
      await t.container.templates.store.setSubject(
        ids[index]!,
        subjectJson(
          ParentSubjectSchema.parse({
            role: 'parent',
            kind: 'review',
            instanceId: instance.id,
            templateVersion: '1.0.0',
            repository: index === 2 ? 'other/project' : 'example/project',
            issue: 7,
            attempt: 1,
            source: { kind: 'external' },
            pullRequest: 12,
            head: (index === 1 ? 'c' : 'a').repeat(40),
            mergeSha: 'b'.repeat(40),
          }),
        ),
      );
    }
    return { headers, ids, instance };
  }
  it('filters the private sidecar without changing core run records and pages equal timestamps by ID', async () => {
    const { headers, ids, instance } = await populated();
    const selected = ids.slice(0, 2).sort().reverse();
    const query =
      '/runs?repository=example%2Fproject&issue=7&pullRequest=12&mergeSha=' +
      'b'.repeat(40) +
      '&templateInstanceId=' +
      instance.id +
      '&loopId=' +
      instance.parentLoopId +
      '&status=succeeded&parent=none&limit=1';
    const first = await t!.app.inject({ method: 'GET', url: query, headers });
    expect(first.statusCode, first.body).toBe(200);
    const page = first.json<{
      items: { id: string; templateSubject: unknown }[];
      nextCursor: string;
    }>();
    expect(page.items.map((item) => item.id)).toEqual([selected[0]]);
    expect(page.items[0]?.templateSubject).toMatchObject({
      kind: 'review',
      issue: 7,
      instanceId: instance.id,
    });
    expect(decodeRunCursor(page.nextCursor).id).toBe(selected[0]);
    const second = await t!.app.inject({
      method: 'GET',
      url: query + '&cursor=' + page.nextCursor,
      headers,
    });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json()).toMatchObject({ items: [{ id: selected[1] }], nextCursor: null });
    expect(await t!.container.repos.runs.get(selected[0]!)).not.toHaveProperty('templateSubject');
    const snapshot = await t!.app.inject({ method: 'GET', url: '/runs/' + selected[0], headers });
    expect(snapshot.json()).toHaveProperty('templateSubject');
    const ordinary = await t!.app.inject({ method: 'GET', url: '/runs/' + ids[3], headers });
    expect(ordinary.json()).not.toHaveProperty('templateSubject');
    expect(
      (
        await t!.app.inject({
          method: 'GET',
          url: '/runs?before=2000-01-01T00%3A00%3A00.000Z',
          headers,
        })
      ).json(),
    ).toEqual({ items: [], nextCursor: null });
  });
  it('keeps reads owner-scoped and rejects corrupt selected metadata and malformed cursors locally', async () => {
    const { headers, ids } = await populated();
    const other = await t!.container.repos.apiKeys.create('other', 'other reader', ['runs:read']);
    const otherHeaders = { authorization: 'Bearer ' + other.token };
    expect(
      (
        await t!.app.inject({
          method: 'GET',
          url: '/runs?repository=example%2Fproject',
          headers: otherHeaders,
        })
      ).json(),
    ).toEqual({ items: [], nextCursor: null });
    expect(
      (await t!.app.inject({ method: 'GET', url: '/runs/' + ids[0], headers: otherHeaders }))
        .statusCode,
    ).toBe(404);
    expect((await t!.app.inject({ method: 'GET', url: '/runs' })).statusCode).toBe(401);
    for (const cursor of [
      '!',
      Buffer.from('{}').toString('base64url'),
      Buffer.from(JSON.stringify({ id: fakeUlid('cursor'), createdAt: 'bad' })).toString(
        'base64url',
      ),
    ]) {
      const response = await t!.app.inject({
        method: 'GET',
        url: '/runs?cursor=' + encodeURIComponent(cursor),
        headers,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'INVALID_CURSOR' });
    }
    expect(
      (await t!.app.inject({ method: 'GET', url: '/runs?cursor=abc&before=old', headers }))
        .statusCode,
    ).toBe(400);
    expect((await t!.app.inject({ method: 'GET', url: '/runs?issue=0', headers })).statusCode).toBe(
      400,
    );
    await t!.container.templates.store.setSubject(ids[2]!, {
      repository: 'other/project',
      issue: 7,
    });
    const unaffected = await t!.app.inject({
      method: 'GET',
      url: '/runs?repository=example%2Fproject',
      headers,
    });
    expect(unaffected.statusCode).toBe(200);
    expect(
      (await t!.app.inject({ method: 'GET', url: '/runs/' + ids[2], headers })).statusCode,
    ).toBe(409);
  });
});
