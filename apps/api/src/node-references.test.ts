import { expect, it } from 'vitest';
import { type LoopDefinitionInput, type LoopIssue } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { createTestApp } from './testing/test-app.js';

function returning(name: string, returns: string): LoopDefinitionInput {
  const definition = minimalLoop();
  return {
    ...definition,
    name,
    nodes: definition.nodes.map((node) =>
      node.kind === 'exit' ? { ...node, config: { ...node.config, returns } } : node,
    ),
  };
}

it('saves broken references for repair but refuses publication without replacing the current version', async () => {
  const t = await createTestApp();
  try {
    const id = await t.publishLoop(returning('reference repair', 'outputs.start.value'));
    const broken = returning('reference repair', 'counters.nodeVisits.removed');
    const saved = await t.app.inject({
      method: 'PUT',
      url: '/loops/' + id + '/draft',
      payload: { definition: broken },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const issue = expect.objectContaining({
      code: 'NODE_REFERENCE_MISSING',
      severity: 'error',
      nodeId: 'done',
      path: 'config.returns',
    });
    expect(saved.json<{ issues: LoopIssue[] }>().issues).toContainEqual(issue);

    const checked = await t.app.inject({
      method: 'POST',
      url: '/loops/' + id + '/validate',
      payload: { definition: broken },
    });
    expect(checked.json()).toMatchObject({
      publishable: false,
      issues: expect.arrayContaining([issue]),
    });
    const refused = await t.app.inject({ method: 'POST', url: '/loops/' + id + '/publish' });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json()).toMatchObject({
      code: 'LOOP_INVALID',
      errors: expect.arrayContaining([issue]),
    });

    const versions = await t.app.inject({ method: 'GET', url: '/loops/' + id + '/versions' });
    expect(versions.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'published',
          definition: expect.objectContaining({
            nodes: expect.arrayContaining([
              expect.objectContaining({
                id: 'done',
                config: expect.objectContaining({ returns: 'outputs.start.value' }),
              }),
            ]),
          }),
        }),
        expect.objectContaining({ status: 'draft' }),
      ]),
    );

    const fixed = returning('reference repair', 'counters.nodeVisits.start');
    const repaired = await t.app.inject({
      method: 'PUT',
      url: '/loops/' + id + '/draft',
      payload: { definition: fixed },
    });
    expect(repaired.statusCode, repaired.body).toBe(200);
    const published = await t.app.inject({ method: 'POST', url: '/loops/' + id + '/publish' });
    expect(published.statusCode, published.body).toBe(200);
  } finally {
    await t.close();
  }
});

it('allows a child to consume an inherited output without adding that node to its own definition', async () => {
  const t = await createTestApp();
  try {
    const child = returning('inherited reference child', 'outputs.parentStart.value');
    const childId = await t.publishLoop(child);
    const readback = await t.app.inject({
      method: 'POST',
      url: '/loops/' + childId + '/validate',
      payload: { definition: child },
    });
    expect(readback.json()).toMatchObject({
      publishable: true,
      issues: [
        expect.objectContaining({
          code: 'NODE_REFERENCE_OUTPUT_UNVERIFIED',
          severity: 'warning',
          nodeId: 'done',
          path: 'config.returns',
        }),
      ],
    });

    const base = returning('inherited reference parent', 'outputs.callChild.value.result');
    const parent: LoopDefinitionInput = {
      ...base,
      nodes: [
        { id: 'parentStart', label: 'Start', kind: 'trigger', config: { type: 'manual' } },
        {
          id: 'callChild',
          label: 'Child',
          kind: 'subloop',
          config: { loopRef: { loopId: childId } },
        },
        ...base.nodes.filter((node) => node.kind === 'exit'),
      ],
      edges: [
        { id: 'toChild', from: { node: 'parentStart', port: 'out' }, to: { node: 'callChild' } },
        { id: 'toExit', from: { node: 'callChild', port: 'out' }, to: { node: 'done' } },
      ],
    };
    const id = await t.publishLoop(parent);
    const admitted = await t.app.inject({
      method: 'POST',
      url: '/loops/' + id + '/runs',
      payload: { input: { proof: 'inherited' } },
    });
    expect(admitted.statusCode, admitted.body).toBe(202);
    const runId = admitted.json<{ run: { id: string } }>().run.id;
    await t.idle();
    const result = await t.app.inject({ method: 'GET', url: '/runs/' + runId });
    expect(result.json()).toMatchObject({ status: 'succeeded', result: { proof: 'inherited' } });
  } finally {
    await t.close();
  }
});
