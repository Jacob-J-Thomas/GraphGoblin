import { afterEach, describe, expect, it } from 'vitest';
import { type LoopDefinitionInput, type RunEvent, type RunRecord } from '@graphgoblin/contracts';
import { FIXTURE_TS, minimalLoop } from '@graphgoblin/contracts/testing';
import { createTestApp, type TestApp } from './testing/test-app.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

function gateLoop(): LoopDefinitionInput {
  const base = minimalLoop();
  return {
    ...base,
    name: 'gate admission',
    nodes: [
      base.nodes[0]!,
      {
        id: 'gate',
        kind: 'decision',
        label: 'Gate',
        config: {
          kind: 'expression',
          jsonata: 'gates.gate.passes = 3 ? "done" : "repeat"',
          routes: [
            { id: 'repeat', label: 'Repeat', repeat: true },
            { id: 'done', label: 'Done' },
          ],
          maxPasses: 3,
        },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'gates.gate.passes' } },
      {
        id: 'exhausted',
        kind: 'exit',
        label: 'Exhausted',
        config: { outcome: 'exhausted', returns: 'gates.gate.passes' },
      },
    ],
    edges: [
      { id: 'start', from: { node: 'start', port: 'out' }, to: { node: 'gate' } },
      { id: 'repeat', from: { node: 'gate', port: 'repeat' }, to: { node: 'gate' } },
      { id: 'done', from: { node: 'gate', port: 'done' }, to: { node: 'done' } },
      { id: 'limit', from: { node: 'gate', port: 'limit-reached' }, to: { node: 'exhausted' } },
    ],
  };
}
const envelope = (loop: unknown) => ({
  format: 'graphgoblin-loop',
  formatVersion: 4,
  exportedAt: FIXTURE_TS,
  loop,
});

describe('decision gate API admission', () => {
  it('returns the visit-cap warning on all five admission paths while allowing an early non-repeat', async () => {
    t = await createTestApp();
    const definition = gateLoop();
    definition.settings = { maxNodeVisits: 2 };
    const gate = definition.nodes.find((n) => n.id === 'gate')!;
    if (gate.kind === 'decision' && gate.config.kind === 'expression')
      gate.config.jsonata = '"done"';
    const created = await t.app.inject({ method: 'POST', url: '/loops', payload: { definition } });
    expect(created.statusCode).toBe(201);
    const id = created.json().loop.id as string;
    const responses = [
      created,
      await t.app.inject({ method: 'POST', url: '/loops/import', payload: envelope(definition) }),
      await t.app.inject({ method: 'PUT', url: `/loops/${id}/draft`, payload: { definition } }),
      await t.app.inject({ method: 'POST', url: `/loops/${id}/validate`, payload: { definition } }),
      await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` }),
    ];
    for (const response of responses) {
      expect(response.statusCode).toBeLessThan(300);
      expect(response.json().issues).toEqual([
        expect.objectContaining({
          code: 'GATE_PASSES_ABOVE_VISIT_CAP',
          severity: 'warning',
          nodeId: 'gate',
          path: 'config.maxPasses',
          message: expect.stringContaining('maxPasses 3, above settings.maxNodeVisits 2'),
        }),
      ]);
    }
    expect(responses[3]!.json().publishable).toBe(true);
    const started = await t.app.inject({ method: 'POST', url: `/loops/${id}/runs`, payload: {} });
    await t.idle();
    expect(
      await t.container.repos.runs.get(started.json<{ run: RunRecord }>().run.id),
    ).toMatchObject({ status: 'succeeded', result: 1 });
  });

  it('agrees across create, import, draft save, validate and publish, and persists runtime counts', async () => {
    t = await createTestApp();
    const definition = gateLoop();
    const created = await t.app.inject({ method: 'POST', url: '/loops', payload: { definition } });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().loop.id as string;
    const imported = await t.app.inject({
      method: 'POST',
      url: '/loops/import',
      payload: envelope(definition),
    });
    const saved = await t.app.inject({
      method: 'PUT',
      url: `/loops/${id}/draft`,
      payload: { definition },
    });
    const validated = await t.app.inject({
      method: 'POST',
      url: `/loops/${id}/validate`,
      payload: { definition },
    });
    for (const response of [created, imported, saved, validated])
      expect(response.json().issues).toEqual([]);
    expect(validated.json().publishable).toBe(true);
    expect((await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` })).statusCode).toBe(
      200,
    );
    const started = await t.app.inject({ method: 'POST', url: `/loops/${id}/runs`, payload: {} });
    const run = started.json<{ run: RunRecord }>().run;
    await t.idle();
    expect(await t.container.repos.runs.get(run.id)).toMatchObject({
      status: 'succeeded',
      result: 3,
    });
    const events = (await t.app.inject(`/runs/${run.id}/events`)).json<{ items: RunEvent[] }>()
      .items;
    expect(
      events.filter((event) => event.type === 'decision.made').map((event) => event.gate?.passes),
    ).toEqual([2, 3, 3]);
    expect((await t.container.manager.getThread(run.id))?.gates.gate?.passes).toBe(3);
  });

  it.each(['repeat-target', 'limit-unconnected', 'terminal-edge'] as const)(
    'reports the same %s graph issue on all five paths',
    async (invalid) => {
      t = await createTestApp();
      const definition = gateLoop();
      if (invalid === 'repeat-target') definition.edges[1]!.to.node = 'done';
      if (invalid === 'limit-unconnected') definition.edges.pop();
      if (invalid === 'terminal-edge')
        definition.edges.push({
          id: 'terminal-edge',
          from: { node: 'done', port: 'out' },
          to: { node: 'gate' },
        });
      const created = await t.app.inject({
        method: 'POST',
        url: '/loops',
        payload: { definition },
      });
      expect(created.statusCode, created.body).toBe(201); // Incomplete graphs remain editable drafts.
      const id = created.json().loop.id as string;
      const imported = await t.app.inject({
        method: 'POST',
        url: '/loops/import',
        payload: envelope(definition),
      });
      const saved = await t.app.inject({
        method: 'PUT',
        url: `/loops/${id}/draft`,
        payload: { definition },
      });
      const validated = await t.app.inject({
        method: 'POST',
        url: `/loops/${id}/validate`,
        payload: { definition },
      });
      const issues = created.json().issues;
      for (const response of [imported, saved, validated])
        expect(response.json().issues).toEqual(issues);
      expect(validated.json().publishable).toBe(false);
      const published = await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` });
      expect(published.statusCode).toBe(422);
      expect(published.json().errors).toEqual(issues);
      expect(issues).toContainEqual(
        expect.objectContaining(
          invalid === 'repeat-target'
            ? { code: 'REPEAT_ROUTE_NOT_CYCLIC', nodeId: 'gate', path: 'config.routes.0.repeat' }
            : invalid === 'limit-unconnected'
              ? { code: 'PORT_UNCONNECTED', nodeId: 'gate', path: 'config.maxPasses' }
              : { code: 'EDGE_PORT_MISSING', edgeId: 'terminal-edge' },
        ),
      );
    },
  );

  it.each([
    ['missing-max', { maxPasses: undefined }, 'maxPasses'],
    [
      'multiple-repeats',
      {
        routes: [
          { id: 'repeat', label: 'Repeat', repeat: true },
          { id: 'done', label: 'Done', repeat: true },
        ],
      },
      'routes.1.repeat',
    ],
    [
      'reserved-id',
      {
        routes: [
          { id: 'limit-reached', label: 'Repeat', repeat: true },
          { id: 'done', label: 'Done' },
        ],
      },
      'routes.0.id',
    ],
    [
      'orphan-limit',
      {
        routes: [
          { id: 'repeat', label: 'Repeat' },
          { id: 'done', label: 'Done' },
        ],
      },
      'maxPasses',
    ],
    ['invalid-time', { maxRunTimeSeconds: 0 }, 'maxRunTimeSeconds'],
  ] as const)(
    'rejects %s with a precise config path on every authoring endpoint',
    async (_name, fields, path) => {
      t = await createTestApp();
      const id = await t.publishLoop(minimalLoop());
      const definition = gateLoop();
      const node = definition.nodes[1]!;
      if (node.kind !== 'decision') throw new Error('missing gate');
      const invalid = {
        ...definition,
        nodes: definition.nodes.map((item) =>
          item.id === 'gate' ? { ...item, config: { ...node.config, ...fields } } : item,
        ),
      };
      const responses = [
        await t.app.inject({ method: 'POST', url: '/loops', payload: { definition: invalid } }),
        await t.app.inject({ method: 'POST', url: '/loops/import', payload: envelope(invalid) }),
        await t.app.inject({
          method: 'PUT',
          url: `/loops/${id}/draft`,
          payload: { definition: invalid },
        }),
        await t.app.inject({
          method: 'POST',
          url: `/loops/${id}/validate`,
          payload: { definition: invalid },
        }),
      ];
      for (const response of responses) {
        expect(response.statusCode, response.body).toBe(400);
        const errors = response.json<{ errors: unknown }>().errors;
        if (response.json<{ code: string }>().code === 'LOOP_IMPORT_ERROR')
          expect(errors).toMatchObject({
            errors: expect.arrayContaining([
              expect.stringContaining(`loop.nodes.1.config.${path}:`),
            ]),
          });
        else
          expect(errors).toContainEqual(
            expect.objectContaining({
              path: `/definition/nodes/1/config/${path.replaceAll('.', '/')}`,
            }),
          );
      }
    },
  );

  it.each(['criteria', 'predicate', 'loopBack', 'return', 'default'])(
    'rejects removed exit field %s on every authoring endpoint',
    async (field) => {
      t = await createTestApp();
      const id = await t.publishLoop(minimalLoop());
      const base = minimalLoop();
      const definition = {
        ...base,
        nodes: base.nodes.map((node) =>
          node.kind === 'exit' ? { ...node, config: { [field]: {} } } : node,
        ),
      };
      for (const request of [
        { method: 'POST' as const, url: '/loops', payload: { definition } },
        { method: 'POST' as const, url: '/loops/import', payload: envelope(definition) },
        { method: 'PUT' as const, url: `/loops/${id}/draft`, payload: { definition } },
        { method: 'POST' as const, url: `/loops/${id}/validate`, payload: { definition } },
      ]) {
        const response = await t.app.inject(request);
        expect(response.statusCode).toBe(400);
        const errors = response.json<{ errors: unknown }>().errors;
        if (response.json<{ code: string }>().code === 'LOOP_IMPORT_ERROR')
          expect(errors).toMatchObject({
            errors: expect.arrayContaining([
              expect.stringContaining(`loop.nodes.1.config.${field}:`),
            ]),
          });
        else
          expect(errors).toContainEqual(
            expect.objectContaining({ path: `/definition/nodes/1/config/${field}` }),
          );
      }
    },
  );
});
