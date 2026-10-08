import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LoopExportSchema,
  TemplateManifestSchema,
  ImplementationTemplateSettingsSchema,
  NodeSchema,
  type RunEvent,
} from '@graphgoblin/contracts';
import { FIXTURE_TS, fakeUlid } from '@graphgoblin/contracts/testing';
import { prepareTemplateBundle, stableHash } from '@graphgoblin/domain';
import { createInitialThread } from '@graphgoblin/engine';
import { createTestEngine, singleNodeLoop, type TestEngine } from '@graphgoblin/engine/testing';
import type { TemplateTransaction } from '@graphgoblin/infrastructure/sqlite';
import { TemplateBindingSchema, executionHash } from './binding.js';
import { assertPinnedBundle } from './authority.js';

const engines: TestEngine[] = [];
afterEach(() => {
  for (const engine of engines.splice(0)) engine.manager.stop();
});
async function fixedBundle() {
  const folder = new URL('../../templates/implementation/', import.meta.url);
  const json = async (file: string): Promise<unknown> =>
    JSON.parse(await readFile(new URL(file, folder), 'utf8'));
  const manifest = TemplateManifestSchema.parse(await json('manifest.json'));
  const loops = Object.fromEntries(
    await Promise.all(
      manifest.loops.map(async (loop) => [
        loop.key,
        LoopExportSchema.parse(await json(loop.file)).loop,
      ]),
    ),
  );
  const settings = ImplementationTemplateSettingsSchema.parse({
    kind: 'implementation',
    repository: { path: '/inert/repository', owner: 'example', name: 'repo', baseBranch: 'main' },
    supportReadKey: 'reader',
    roles: { implementer: { harness: 'codex', model: 'gpt-6-sol', effort: 'high' } },
  });
  const prepared = prepareTemplateBundle(
    { manifest, loops },
    settings,
    Object.fromEntries(
      manifest.loops.map((loop) => [
        loop.key,
        {
          loopId: fakeUlid(loop.key),
          versionId: fakeUlid(loop.key + '-version'),
          version: 1,
          name: loop.key,
        },
      ]),
    ),
  );
  const binding = TemplateBindingSchema.parse({
    instanceId: fakeUlid('fixed-instance'),
    ownerId: 'local',
    manifest,
    settings,
    loops: prepared.loops.map((loop) => ({
      key: loop.key,
      loopId: loop.loopId,
      versionId: loop.versionId,
      hash: executionHash(loop.definition),
      nodes: Object.fromEntries(
        loop.definition.nodes.map((node) => [
          node.id,
          { kind: node.kind, configHash: stableHash(node.config) },
        ]),
      ),
    })),
  });
  const versions = new Map(
    prepared.loops.map((loop) => [
      loop.versionId,
      {
        id: loop.versionId,
        loopId: loop.loopId,
        version: loop.version,
        status: loop.status,
        definition: loop.definition,
        createdAt: FIXTURE_TS,
        publishedAt: loop.status === 'published' ? FIXTURE_TS : null,
      },
    ]),
  );
  const parent = prepared.loops.find((loop) => loop.key === 'parent')!,
    child = prepared.loops.find((loop) => loop.key !== 'parent')!;
  const thread = createInitialThread({
    runId: fakeUlid('fixed-run'),
    loopId: parent.loopId,
    versionId: parent.versionId,
    invocation: {
      id: fakeUlid('fixed-invocation'),
      source: 'manual.api',
      trigger: { nodeId: 'start', kind: 'manual', payload: null, receivedAt: FIXTURE_TS },
    },
  });
  const queued: RunEvent = {
    type: 'run.queued',
    runId: thread.run.id,
    seq: 1,
    ts: FIXTURE_TS,
    initialThread: thread,
  };
  const store: Pick<TemplateTransaction, 'version'> = {
    version: (id) => Promise.resolve(versions.get(id)),
  };
  return { binding, versions, parent, child, queued, store };
}
describe('template fixed-child authority', () => {
  it('accepts numeric immutable references without fabricating dynamic queued pins', async () => {
    const f = await fixedBundle();
    await expect(
      assertPinnedBundle(f.store, f.binding, f.parent.loopId, [f.queued]),
    ).resolves.toBeUndefined();
    expect(f.queued).not.toHaveProperty('subloopVersions');
  });
  it.each([
    'missing',
    'loop',
    'number',
    'draft',
    'hash',
    'unknown-ref',
    'wrong-pin',
    'extra-pin',
  ] as const)('refuses %s fixed child authority', async (mode) => {
    const f = await fixedBundle(),
      record = f.versions.get(f.child.versionId)!;
    if (mode === 'missing') f.versions.delete(record.id);
    if (mode === 'loop') record.loopId = fakeUlid('foreign');
    if (mode === 'number') record.version = 9;
    if (mode === 'draft') record.status = 'draft';
    if (mode === 'hash') f.binding.loops.find((loop) => loop.key === f.child.key)!.hash = 'changed';
    if (mode === 'unknown-ref') {
      const node = f.parent.definition.nodes.find((node) => node.kind === 'subloop')!;
      if (node.kind === 'subloop') node.config.loopRef.loopId = fakeUlid('foreign');
      f.binding.loops.find((loop) => loop.key === 'parent')!.hash = executionHash(
        f.parent.definition,
      );
    }
    const queued =
      f.queued.type === 'run.queued'
        ? {
            ...f.queued,
            ...(mode === 'wrong-pin'
              ? { subloopVersions: { [f.child.loopId]: fakeUlid('wrong') } }
              : {}),
            ...(mode === 'extra-pin'
              ? { subloopVersions: { [fakeUlid('extra')]: f.child.versionId } }
              : {}),
          }
        : f.queued;
    await expect(
      assertPinnedBundle(f.store, f.binding, f.parent.loopId, [queued]),
    ).rejects.toThrow();
  });
  it('requires actual dynamic latest pins when a bound definition contains latest', async () => {
    const f = await fixedBundle();
    for (const node of f.parent.definition.nodes)
      if (node.kind === 'subloop') node.config.loopRef.version = 'latest';
    f.binding.loops.find((loop) => loop.key === 'parent')!.hash = executionHash(
      f.parent.definition,
    );
    await expect(
      assertPinnedBundle(f.store, f.binding, f.parent.loopId, [f.queued]),
    ).rejects.toThrow();
    if (f.queued.type !== 'run.queued') throw new Error('Expected queued');
    await expect(
      assertPinnedBundle(f.store, f.binding, f.parent.loopId, [
        { ...f.queued, subloopVersions: { [f.child.loopId]: f.child.versionId } },
      ]),
    ).resolves.toBeUndefined();
  });
  it('checks fixed references through a transitive child', async () => {
    const f = await fixedBundle(),
      child = f.versions.get(f.child.versionId)!,
      leaf = {
        ...structuredClone(child),
        id: fakeUlid('leaf-version'),
        loopId: fakeUlid('leaf-loop'),
      };
    f.versions.set(leaf.id, leaf);
    const descriptor = f.binding.manifest.loops.find((loop) => loop.key === f.child.key)!;
    descriptor.dependsOn = ['leaf'];
    f.binding.manifest.loops.push({ ...structuredClone(descriptor), key: 'leaf', dependsOn: [] });
    child.definition.nodes.push(
      NodeSchema.parse({
        id: 'nested',
        label: 'Nested',
        kind: 'subloop',
        config: {
          loopRef: { loopId: leaf.loopId, version: leaf.version },
        },
      }),
    );
    f.binding.loops.find((loop) => loop.key === f.child.key)!.hash = executionHash(
      child.definition,
    );
    f.binding.loops.push({
      key: 'leaf',
      loopId: leaf.loopId,
      versionId: leaf.id,
      hash: executionHash(leaf.definition),
      nodes: {},
    });
    await expect(
      assertPinnedBundle(f.store, f.binding, f.parent.loopId, [f.queued]),
    ).resolves.toBeUndefined();
    leaf.definition.description = 'Changed outside immutable binding';
    // Descriptions are editable metadata; executable config changes must still refuse.
    leaf.definition.settings.maxIterations++;
    await expect(
      assertPinnedBundle(f.store, f.binding, f.parent.loopId, [f.queued]),
    ).rejects.toThrow();
  });
  it('runs an actual parent and fixed fresh worker with the engine native pin semantics', async () => {
    const f = await fixedBundle();
    let binding = f.binding;
    const engine = await createTestEngine({
      beforeExecute: async ({ run, events }) => {
        await assertPinnedBundle(
          {
            version: async (id) => {
              const record = await engine.ports.loops.getVersion(id);
              return record ? { ...record, publishedAt: record.publishedAt ?? null } : undefined;
            },
          },
          binding,
          run.loopId,
          events,
        );
      },
    });
    engines.push(engine);
    const child = engine.publish(
      singleNodeLoop('Fixed worker', {
        id: 'worker',
        kind: 'inference',
        label: 'Worker',
        config: {
          harness: 'codex',
          prompt: { template: 'Return a bounded result.' },
          session: { policy: 'fresh' },
        },
      }),
    );
    const parent = engine.publish(
      singleNodeLoop('Fixed parent', {
        id: 'child',
        kind: 'subloop',
        label: 'Child',
        config: {
          loopRef: { loopId: child.loopId, version: child.version },
          input: { mode: 'fresh' },
        },
      }),
    );
    binding = TemplateBindingSchema.parse({
      ...f.binding,
      loops: [
        {
          key: 'parent',
          loopId: parent.loopId,
          versionId: parent.id,
          hash: executionHash(parent.definition),
          nodes: {},
        },
        {
          key: f.child.key,
          loopId: child.loopId,
          versionId: child.id,
          hash: executionHash(child.definition),
          nodes: {},
        },
      ],
    });
    const run = await engine.runToIdle(parent.loopId);
    expect(run.status).toBe('succeeded');
    expect(engine.events(run.id)[0]).not.toHaveProperty('subloopVersions');
    expect(engine.ports.harness.started).toHaveLength(1);
    const workers = [...engine.ports.runs.runs.values()].filter(
      (row) => row.parentRunId === run.id,
    );
    expect(workers).toHaveLength(1);
    expect(workers[0]?.status).toBe('succeeded');
  });
});
