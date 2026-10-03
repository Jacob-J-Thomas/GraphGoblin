/**
 * Regression tests for defects found by the WP-D2 adversarial QA pass (docs/qa/2026-10-03-wp-d2.md).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LoopDefinitionInput, RunEvent } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { readOwnerDefaults } from './container.js';
import { createTestApp, type TestApp } from './testing/test-app.js';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

const start = { id: 'start', kind: 'trigger', label: 'S', config: { subtype: 'manual' } } as const;
const done = { id: 'done', kind: 'exit', label: 'D', config: {} } as const;
function chain(name: string, middle: LoopDefinitionInput['nodes'][number]): LoopDefinitionInput {
  return {
    schemaVersion: 1,
    name,
    nodes: [start, middle, done],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: middle.id } },
      { id: 'e2', from: { node: middle.id, port: 'out' }, to: { node: 'done' } },
    ],
  };
}
const subloop = (loopId: string, version: 'latest' | number = 'latest') =>
  ({
    id: 'sub',
    kind: 'subloop',
    label: 'Sub',
    config: { loopRef: { loopId, version } },
  }) as const;

async function createLoop(definition: LoopDefinitionInput) {
  const res = await t.app.inject({ method: 'POST', url: '/loops', payload: { definition } });
  return res.json<{ loop: { id: string }; issues: { code: string }[] }>();
}

describe('owner defaults (Settings) reach the engine at run start', () => {
  const infer = chain('infer', {
    id: 'ask',
    kind: 'inference',
    label: 'Ask',
    config: { prompt: { template: 'hi' } },
  });

  it('uses the saved defaults for the next run and the configuration after they are removed', async () => {
    const loopId = await t.publishLoop(infer);
    const run = async () => {
      const res = await t.app.inject({ method: 'POST', url: `/loops/${loopId}/runs`, payload: {} });
      expect(res.statusCode).toBe(202);
      await t.idle();
      return t.harness.started.at(-1);
    };
    expect(await run()).toMatchObject({ model: 'gpt-6-luna', effort: 'low' });

    const put = await t.app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { defaultModel: 'gpt-6-sol', defaultEffort: 'high' },
    });
    expect(put.statusCode).toBe(200);
    expect(await run()).toMatchObject({ model: 'gpt-6-sol', effort: 'high' });

    await t.app.inject({ method: 'DELETE', url: '/settings/defaultModel' });
    expect(await run()).toMatchObject({ model: 'gpt-6-luna', effort: 'high' });
  });

  it('refuses invalid values for the known keys and ignores bad stored values', async () => {
    for (const payload of [
      { defaultEffort: 'ultra' },
      { defaultModel: '  ' },
      { defaultModel: 7 },
    ]) {
      const res = await t.app.inject({ method: 'PUT', url: '/settings', payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
    }
    const other = await t.app.inject({ method: 'PUT', url: '/settings', payload: { theme: 1 } });
    expect(other.statusCode).toBe(200);
    const stored = { defaultModel: '', defaultEffort: 'ultra' } as Record<string, unknown>;
    expect(
      await readOwnerDefaults({ get: (_o, k) => Promise.resolve(stored[k] as never) }, 'x'),
    ).toEqual({});
  });
});

describe('validate, draft saves, and publish agree', () => {
  it('reports cron, subloop, and template problems the same way everywhere', async () => {
    const child = await createLoop(minimalLoop());
    const cases: { definition: LoopDefinitionInput; code: string }[] = [
      {
        definition: {
          ...minimalLoop(),
          nodes: [
            {
              id: 'start',
              kind: 'trigger',
              label: 'S',
              config: { subtype: 'cron', expression: 'not cron' },
            },
            done,
          ],
        },
        code: 'CRON_INVALID',
      },
      {
        definition: chain('missing', subloop('01ARZ3NDEKTSV4RRFFQ69G5FAV')),
        code: 'SUBLOOP_NOT_FOUND',
      },
      { definition: chain('unpublished', subloop(child.loop.id)), code: 'SUBLOOP_NOT_PUBLISHED' },
      {
        definition: chain('template', {
          id: 'ask',
          kind: 'inference',
          label: 'Ask',
          config: { prompt: { template: 'Hello {% if x %}' } },
        }),
        code: 'TEMPLATE_INVALID',
      },
    ];
    for (const { definition, code } of cases) {
      const created = await createLoop(definition);
      expect(
        created.issues.map((i) => i.code),
        code,
      ).toContain(code);
      const id = created.loop.id;
      const validate = await t.app.inject({
        method: 'POST',
        url: `/loops/${id}/validate`,
        payload: { definition },
      });
      const checked = validate.json<{ issues: { code: string }[]; publishable: boolean }>();
      expect(checked.publishable, code).toBe(false);
      expect(checked.issues.map((i) => i.code)).toContain(code);
      const draft = await t.app.inject({
        method: 'PUT',
        url: `/loops/${id}/draft`,
        payload: { definition },
      });
      expect(draft.json<{ issues: { code: string }[] }>().issues.map((i) => i.code)).toContain(
        code,
      );
      const publish = await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` });
      expect(publish.statusCode, code).toBe(422);
      expect(JSON.stringify(publish.json())).toContain(code);
    }
  });

  it('accepts a published subloop, a pinned version, and a self-reference', async () => {
    const childId = await t.publishLoop(minimalLoop());
    for (const ref of [subloop(childId), subloop(childId, 1)]) {
      const created = await createLoop(chain('ok', ref));
      expect(created.issues.filter((i) => i.code.startsWith('SUBLOOP'))).toEqual([]);
    }
    const missingVersion = await createLoop(chain('v9', subloop(childId, 9)));
    expect(missingVersion.issues.map((i) => i.code)).toContain('SUBLOOP_NOT_PUBLISHED');

    const self = await createLoop(chain('self', subloop('01ARZ3NDEKTSV4RRFFQ69G5FAV')));
    const selfDef = chain('self', subloop(self.loop.id));
    const saved = await t.app.inject({
      method: 'PUT',
      url: `/loops/${self.loop.id}/draft`,
      payload: { definition: selfDef },
    });
    expect(saved.json<{ issues: unknown[] }>().issues).toEqual([]);
  });

  it('accepts a self-reference only when it resolves', async () => {
    const self = await createLoop(chain('self pinned', subloop('01ARZ3NDEKTSV4RRFFQ69G5FAV')));
    const id = self.loop.id;
    const validate = async (ref: ReturnType<typeof subloop>) => {
      const res = await t.app.inject({
        method: 'POST',
        url: `/loops/${id}/validate`,
        payload: { definition: chain('self pinned', ref) },
      });
      return res.json<{ issues: { code: string }[]; publishable: boolean }>();
    };
    // Version 1 is the number this draft publishes as; 999 never exists.
    expect((await validate(subloop(id, 1))).publishable).toBe(true);
    const pinned = await validate(subloop(id, 999));
    expect(pinned.publishable).toBe(false);
    expect(pinned.issues.map((i) => i.code)).toContain('SUBLOOP_NOT_PUBLISHED');
    await t.app.inject({
      method: 'PUT',
      url: `/loops/${id}/draft`,
      payload: { definition: chain('self pinned', subloop(id, 999)) },
    });
    expect((await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` })).statusCode).toBe(
      422,
    );
    // After version 1 is published, a new draft is version 2; 1 resolves as published, 3 does not.
    await t.app.inject({
      method: 'PUT',
      url: `/loops/${id}/draft`,
      payload: { definition: chain('self pinned', subloop(id, 1)) },
    });
    expect((await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` })).statusCode).toBe(
      200,
    );
    expect((await validate(subloop(id, 1))).publishable).toBe(true);
    expect((await validate(subloop(id, 2))).publishable).toBe(true);
    expect((await validate(subloop(id, 3))).publishable).toBe(false);
  });

  it('import reports the same issues as create, including trigger checks', async () => {
    const definition: LoopDefinitionInput = {
      ...minimalLoop(),
      name: 'imported cron',
      nodes: [
        {
          id: 'start',
          kind: 'trigger',
          label: 'S',
          config: { subtype: 'cron', expression: 'not cron' },
        },
        done,
      ],
    };
    const created = await createLoop(definition);
    const imported = await t.app.inject({
      method: 'POST',
      url: '/loops/import',
      payload: {
        format: 'graphgoblin-loop',
        formatVersion: 1,
        exportedAt: '2026-10-03T00:00:00.000Z',
        loop: definition,
      },
    });
    const codes = imported.json<{ issues: { code: string }[] }>().issues.map((i) => i.code);
    expect(codes).toContain('CRON_INVALID');
    expect(codes).toEqual(created.issues.map((i) => i.code));
  });

  it('reports a missing subloop on import', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/loops/import',
      payload: {
        format: 'graphgoblin-loop',
        formatVersion: 1,
        exportedAt: '2026-10-03T00:00:00.000Z',
        loop: chain('imported', subloop('01ARZ3NDEKTSV4RRFFQ69G5FAV')),
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ issues: { code: string }[] }>().issues.map((i) => i.code)).toContain(
      'SUBLOOP_NOT_FOUND',
    );
  });
});

describe('export and import', () => {
  it('round-trips: export, import, export again gives the same loop', async () => {
    const original = await t.publishLoop({
      ...minimalLoop(),
      name: 'round trip',
      description: 'Ünïcödé 🚀',
    });
    const first = await t.app.inject({ method: 'GET', url: `/loops/${original}/export` });
    const imported = await t.app.inject({
      method: 'POST',
      url: '/loops/import',
      payload: first.json(),
    });
    expect(imported.statusCode).toBe(201);
    const copy = imported.json<{ loop: { id: string } }>().loop.id;
    const second = await t.app.inject({
      method: 'GET',
      url: `/loops/${copy}/export?draft=true`,
    });
    const strip = (doc: Record<string, unknown>) => ({ ...doc, exportedAt: undefined });
    expect(strip(second.json())).toEqual(strip(first.json()));
  });
});

describe('run.queued carries the initial thread', () => {
  it('records the seeded thread of a subloop child on its first event', async () => {
    const childId = await t.publishLoop(minimalLoop());
    const parentId = await t.publishLoop(chain('parent', subloop(childId)));
    await t.app.inject({ method: 'POST', url: `/loops/${parentId}/runs`, payload: { input: 1 } });
    await t.idle();
    const runs = await t.app.inject({ method: 'GET', url: `/runs?loopId=${childId}` });
    const [child] = runs.json<{ items: { id: string; parentRunId?: string }[] }>().items;
    expect(child?.parentRunId).toBeDefined();
    const events = await t.app.inject({ method: 'GET', url: `/runs/${child!.id}/events` });
    const [first] = events.json<{ items: RunEvent[] }>().items;
    expect(first?.type).toBe('run.queued');
    expect(first?.type === 'run.queued' && first.initialThread?.run.parentRunId).toBe(
      child?.parentRunId,
    );
  });
});

describe('request errors use stable problem codes', () => {
  it('maps malformed, empty, and oversized bodies', async () => {
    const malformed = await t.app.inject({
      method: 'POST',
      url: '/loops',
      headers: { 'content-type': 'application/json' },
      payload: '{bad',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json<{ code: string; type: string }>()).toMatchObject({
      code: 'MALFORMED_BODY',
      type: 'https://graphgoblin.dev/problems/malformed-body',
    });
    const empty = await t.app.inject({
      method: 'POST',
      url: '/loops',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });
    expect(empty.json<{ code: string }>().code).toBe('MALFORMED_BODY');
    const huge = await t.app.inject({
      method: 'POST',
      url: '/loops',
      headers: { 'content-type': 'application/json' },
      payload: `{"definition":"${'x'.repeat(9 * 1024 * 1024)}"}`,
    });
    expect(huge.statusCode).toBe(413);
    expect(huge.json<{ code: string }>().code).toBe('BODY_TOO_LARGE');
    const media = await t.app.inject({
      method: 'POST',
      url: '/loops',
      headers: { 'content-type': 'application/x-unknown' },
      payload: 'x',
    });
    expect(media.statusCode).toBe(415);
    expect(media.json<{ code: string }>().code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });
});
