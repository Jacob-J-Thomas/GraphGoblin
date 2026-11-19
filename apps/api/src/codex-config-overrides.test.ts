import {
  LoopDefinitionSchema,
  type LoopDefinition,
  type LoopDefinitionInput,
  type LoopVersionRecord,
} from '@graphgoblin/contracts';
import { fakeUlid, minimalLoop } from '@graphgoblin/contracts/testing';
import { guardCurrentStore } from '@graphgoblin/infrastructure/sqlite';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './testing/test-app.js';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

function definition(configOverrides: Record<string, unknown> = {}): LoopDefinitionInput {
  return {
    ...minimalLoop(),
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      {
        id: 'work',
        kind: 'inference',
        label: 'Work',
        config: {
          prompt: { template: 'Summarise the supplied text.' },
          harnessOptions: { configOverrides },
        },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      { id: 'e2', from: { node: 'work', port: 'out' }, to: { node: 'done' } },
    ],
  };
}

async function createDraft(configOverrides?: Record<string, unknown>) {
  const response = await t.app.inject({
    method: 'POST',
    url: '/loops',
    payload: { definition: definition(configOverrides) },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ loop: { id: string }; draft: LoopVersionRecord }>();
}

describe('Codex override keys through ordinary authoring routes (#429)', () => {
  it('verifies the documented manual discovery and correction on a disposable store', async () => {
    const { loop, draft } = await createDraft();
    const retained = LoopDefinitionSchema.parse(definition());
    const node = retained.nodes[1]!;
    if (node.kind !== 'inference') throw new Error('Missing fixture inference');
    node.config.harnessOptions.configOverrides = {
      service_tier: 'ordinary value with spaces',
      toString: true,
      'features.prototype': true,
      'quoted"key.with.dot': true,
      list: [1, { 'team docs': true }],
      ...JSON.parse('{"__proto__":{"enabled":true}}'),
    };
    // This authored JSON is outside the typed overrides and must remain untouched.
    retained.variables = { receipt: { description: 'kept', properties: { 'not plain': {} } } };
    await t.container.repos.loops.saveDraft(loop.id, retained);
    const client = t.container.handle.client;
    for (const status of ['published', 'snapshot'])
      await client.execute({
        sql: 'INSERT INTO loop_versions (id, loop_id, version, status, definition, created_at) SELECT ?, loop_id, ?, ?, definition, created_at FROM loop_versions WHERE id = ?',
        args: [fakeUlid('429-' + status), status === 'published' ? 2 : 3, status, draft.id],
      });
    for (const variant of ['omitted', 'null'])
      await client.execute({
        sql: `INSERT INTO loop_versions (id, loop_id, version, status, definition, created_at)
          SELECT ?, loop_id, ?, 'draft', ${variant === 'omitted' ? "json_remove(definition, '$.nodes[1].config.harness')" : "json_set(definition, '$.nodes[1].config.harness', NULL)"}, created_at
          FROM loop_versions WHERE id = ?`,
        args: [fakeUlid('429-' + variant), variant === 'omitted' ? 4 : 5, draft.id],
      });
    // Execute the exact SQL shipped in the upgrade note, rather than a test-only approximation.
    const changelog = await readFile(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8');
    const discovery = changelog.match(/```sql\s+(SELECT v\.id[\s\S]*?)```/)?.[1];
    const correction = changelog.match(
      /```sql\s+(UPDATE loop_versions\s+SET definition = json_remove[\s\S]*?)```/,
    )?.[1];
    const materializeHarness = changelog.match(
      /```sql\s+(UPDATE loop_versions\s+SET definition = json_set[\s\S]*?)```/,
    )?.[1];
    if (!discovery || !correction || !materializeHarness)
      throw new Error('Missing #429 upgrade recipe');
    const found = await client.execute(discovery);
    expect(found.rows).toHaveLength(16);
    expect(found.rows.some((row) => row['id'] === fakeUlid('429-omitted'))).toBe(true);
    expect(found.rows.some((row) => row['id'] === fakeUlid('429-null'))).toBe(false);
    expect(new Set(found.rows.map((row) => row['status']))).toEqual(
      new Set(['draft', 'published', 'snapshot']),
    );
    await expect(guardCurrentStore(client)).rejects.toMatchObject({ code: 'STORE_UNSUPPORTED' });
    for (const row of found.rows) {
      const path = row['key_path'];
      const id = row['id'];
      if (typeof path !== 'string' || typeof id !== 'string')
        throw new Error('Invalid discovery row');
      if (row['harness_omitted'] === 1) {
        const harnessPath = row['harness_path'];
        if (typeof harnessPath !== 'string') throw new Error('Invalid harness discovery path');
        await client.execute({ sql: materializeHarness, args: [harnessPath, id, harnessPath] });
      }
      await client.execute({ sql: correction, args: [path, id] });
    }
    for (const id of [draft.id, fakeUlid('429-published'), fakeUlid('429-omitted')]) {
      // JSON1 cannot address every quoted key. Verify removal, then exercise the documented
      // structured-JSON correction for the exact member on any row it left unchanged.
      const readback = await t.container.repos.loops.getVersion(id);
      const inference = readback?.definition.nodes[1];
      if (inference?.kind !== 'inference' || !readback)
        throw new Error('Missing correction fixture');
      const overrides = inference.config.harnessOptions.configOverrides!;
      if (Object.hasOwn(overrides, 'quoted"key.with.dot')) {
        delete overrides['quoted"key.with.dot'];
        await client.execute({
          sql: "UPDATE loop_versions SET definition = ? WHERE id = ? AND status IN ('draft', 'published')",
          args: [JSON.stringify(readback.definition), id],
        });
      }
      const corrected = await t.container.repos.loops.getVersion(id);
      expect(LoopDefinitionSchema.safeParse(corrected?.definition).success).toBe(true);
      expect(corrected?.definition.variables).toEqual(retained.variables);
      const correctedInference = corrected?.definition.nodes[1];
      expect(
        correctedInference?.kind === 'inference' &&
          correctedInference.config.harnessOptions.configOverrides,
      ).toEqual({
        service_tier: 'ordinary value with spaces',
        toString: true,
        list: [1, {}],
      });
    }
    expect((await client.execute(discovery)).rows).toHaveLength(4);
    await expect(
      client.execute({
        sql: 'UPDATE loop_versions SET definition = ? WHERE id = ?',
        args: [JSON.stringify(LoopDefinitionSchema.parse(definition())), fakeUlid('429-snapshot')],
      }),
    ).rejects.toThrow('LOOP_VERSION_SNAPSHOT_IMMUTABLE');
    // The documented deletion path preserves snapshot immutability and removes the owning loop.
    expect((await t.app.inject({ method: 'DELETE', url: `/loops/${loop.id}` })).statusCode).toBe(
      204,
    );
    expect(await t.container.repos.loops.getVersion(fakeUlid('429-snapshot'))).toBeUndefined();
    expect(await guardCurrentStore(client)).toBe('current');
  });

  it('exports a retained draft for correction and import into a separate fresh store', async () => {
    const { loop, draft } = await createDraft();
    const retained = LoopDefinitionSchema.parse(definition());
    const inference = retained.nodes[1]!;
    if (inference.kind !== 'inference') throw new Error('Missing fixture inference');
    inference.config.harnessOptions.configOverrides = {
      'features.prototype': true,
      service_tier: 'fast',
    };
    await t.container.repos.loops.saveDraft(loop.id, retained);
    const before = await t.container.repos.loops.getVersion(draft.id);
    const exported = await t.app.inject(`/loops/${loop.id}/export?draft=true`);
    expect(exported.statusCode, exported.body).toBe(200);
    const document = exported.json<{ loop: LoopDefinition }>();
    const node = document.loop.nodes[1]!;
    if (node.kind !== 'inference') throw new Error('Missing exported fixture inference');
    expect(node.config.harnessOptions.configOverrides).toEqual(
      inference.config.harnessOptions.configOverrides,
    );
    delete node.config.harnessOptions.configOverrides!['features.prototype'];
    const fresh = await createTestApp();
    try {
      const imported = await fresh.app.inject({
        method: 'POST',
        url: '/loops/import',
        payload: document,
      });
      expect(imported.statusCode, imported.body).toBe(201);
      const recovered = imported.json<{ loop: { id: string }; draft: LoopVersionRecord }>();
      expect(recovered.draft.definition).toEqual(document.loop);
      expect(
        (await fresh.app.inject({ method: 'POST', url: `/loops/${recovered.loop.id}/publish` }))
          .statusCode,
      ).toBe(200);
    } finally {
      await fresh.close();
    }
    expect(await t.container.repos.loops.getVersion(draft.id)).toEqual(before);
  });

  it('refuses a stored invalid override when its defaulted Codex harness is omitted', async () => {
    const { loop, draft } = await createDraft();
    await t.container.handle.client.execute({
      sql: `UPDATE loop_versions SET definition = json_set(json_remove(definition, '$.nodes[1].config.harness'), '$.nodes[1].config.harnessOptions.configOverrides', json(?)) WHERE id = ?`,
      args: [JSON.stringify({ 'features.prototype': true }), draft.id],
    });
    const before = await t.container.repos.loops.getVersion(draft.id);
    const inference = before?.definition.nodes[1];
    expect(inference?.kind === 'inference' && inference.config.harness).toBeUndefined();
    const result = await t.app.inject({ method: 'POST', url: `/loops/${loop.id}/publish` });
    expect(result.statusCode, result.body).toBe(422);
    expect(result.json()).toMatchObject({
      code: 'LOOP_INVALID',
      errors: [{ code: 'CODEX_CONFIG_KEY_INVALID', nodeId: 'work' }],
    });
    expect(await t.container.repos.loops.getVersion(draft.id)).toEqual(before);
  });

  it('validates and publishes scalar, table and dotted overrides without rewriting them', async () => {
    const configOverrides = {
      service_tier: 'fast',
      'features.plugins': false,
      table: { 'team-docs': true },
      list: [1, { enabled: true }],
    };
    const { loop } = await createDraft(configOverrides);
    const validation = await t.app.inject({
      method: 'POST',
      url: `/loops/${loop.id}/validate`,
      payload: { definition: definition(configOverrides) },
    });
    expect(validation.statusCode, validation.body).toBe(200);
    expect(validation.json()).toMatchObject({ publishable: true });
    const published = await t.app.inject({ method: 'POST', url: `/loops/${loop.id}/publish` });
    expect(published.statusCode, published.body).toBe(200);
    expect(published.json()).toMatchObject({
      version: {
        status: 'published',
        definition: { nodes: [{}, { config: { harnessOptions: { configOverrides } } }, {}] },
      },
    });
  });

  it.each([
    { 'features.prototype': true },
    { 'features..plugins': true },
    { list: [1, { 'team docs': true }] },
    JSON.parse('{"__proto__":{"enabled":true}}') as Record<string, unknown>,
  ])('refuses invalid incoming keys and keeps the earlier draft: %j', async (configOverrides) => {
    const { loop, draft } = await createDraft({ service_tier: 'fast' });
    const earlier = await t.container.repos.loops.getVersion(draft.id);
    for (const [method, url] of [
      ['POST', '/loops'],
      ['POST', `/loops/${loop.id}/validate`],
      ['PUT', `/loops/${loop.id}/draft`],
    ] as const) {
      const refused = await t.app.inject({
        method,
        url,
        payload: { definition: definition(configOverrides) },
      });
      expect(refused.statusCode, refused.body).toBe(400);
      expect(refused.body).not.toMatch(/"stack"|node_modules/);
    }
    expect(await t.container.repos.loops.getVersion(draft.id)).toEqual(earlier);
  });

  it('refuses publication of a retained invalid-key draft while keeping its readable authored data', async () => {
    const { loop, draft } = await createDraft();
    const retained = LoopDefinitionSchema.parse(definition());
    const node = retained.nodes[1]!;
    if (node.kind !== 'inference') throw new Error('Missing fixture inference');
    node.config.harnessOptions.configOverrides = { 'features.prototype': true };
    await t.container.repos.loops.saveDraft(loop.id, retained);
    const before = await t.container.repos.loops.getVersion(draft.id);
    const published = await t.app.inject({ method: 'POST', url: `/loops/${loop.id}/publish` });
    expect(published.statusCode, published.body).toBe(422);
    expect(published.json()).toMatchObject({
      code: 'LOOP_INVALID',
      errors: [
        {
          code: 'CODEX_CONFIG_KEY_INVALID',
          nodeId: 'work',
          path: 'config.harnessOptions.configOverrides.features.prototype',
        },
      ],
    });
    const detail = await t.app.inject(`/loops/${loop.id}`);
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json()).toMatchObject({ draft: { definition: retained } });
    expect(detail.body).not.toMatch(/"stack"|node_modules/);
    expect((await t.app.inject('/healthz')).statusCode).toBe(200);
    expect(await t.container.repos.loops.getVersion(draft.id)).toEqual(before);
    expect((await t.container.repos.loops.getLoop(loop.id))?.currentVersionId).toBeUndefined();
  });
});
