import { describe, expect, it, vi } from 'vitest';
import type { HarnessDefaults, LoopDefinitionInput, RunRecord } from '@graphgoblin/contracts';
import { CURRENT_DEFINITION_FORMAT, LoopDefinitionSchema } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { RunManager } from './run-manager.js';
import { pinLabel } from './definition-pin.js';
import { createTestEngine, type TestEngine } from './testing/scenario.js';

/**
 * ADR-0041: every run keeps the immutable definition it started with, drafts included, through
 * edits, waits, resume, replay and restart; only new runs see later edits.
 */

const shape = (mark: string) => ({
  id: 'shape',
  kind: 'mutate' as const,
  label: 'Shape',
  config: {
    operations: [{ op: 'set', path: '/vars/mark', value: { kind: 'literal', value: mark } }],
  },
});

/** start -> ask (input) -> shape (sets vars.mark) [-> think (inference)] -> done (returns mark). */
function waitThenMark(mark: string, options: { infer?: boolean; name?: string } = {}) {
  return {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name: options.name ?? 'Pinned',
    variables: { mark: { type: 'string' } },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      { id: 'ask', kind: 'wait', label: 'Ask', config: { mode: 'input', prompt: 'Go?' } },
      shape(mark),
      ...(options.infer
        ? [
            {
              id: 'think',
              kind: 'inference',
              label: 'Think',
              config: { prompt: { template: 'x' } },
            },
          ]
        : []),
      { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'vars.mark' } },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'ask' } },
      { id: 'e2', from: { node: 'ask', port: 'out' }, to: { node: 'shape' } },
      ...(options.infer
        ? [
            { id: 'e3', from: { node: 'shape', port: 'out' }, to: { node: 'think' } },
            { id: 'e4', from: { node: 'think', port: 'out' }, to: { node: 'done' } },
          ]
        : [{ id: 'e3', from: { node: 'shape', port: 'out' }, to: { node: 'done' } }]),
    ],
  } as LoopDefinitionInput;
}

/** start -> think (inference) -> shape -> done: no wait, so an edit lands mid-run. */
function inferThenMark(mark: string): LoopDefinitionInput {
  return {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name: 'Active',
    variables: { mark: { type: 'string' } },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      { id: 'think', kind: 'inference', label: 'Think', config: { prompt: { template: 'x' } } },
      shape(mark),
      { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'vars.mark' } },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'think' } },
      { id: 'e2', from: { node: 'think', port: 'out' }, to: { node: 'shape' } },
      { id: 'e3', from: { node: 'shape', port: 'out' }, to: { node: 'done' } },
    ],
  } as LoopDefinitionInput;
}

/** What `SqliteLoopRepository.saveDraft` does: the draft row's definition changes in place. */
function editDraft(engine: TestEngine, draftId: string, def: LoopDefinitionInput): void {
  const draft = engine.ports.loops.versions.get(draftId)!;
  engine.ports.loops.add({ ...draft, definition: LoopDefinitionSchema.parse(def) });
}

async function startDraft(engine: TestEngine, mark = 'old') {
  const draft = engine.publish(waitThenMark(mark), { status: 'draft' });
  const run = await engine.start(draft.loopId, null, { versionId: draft.id, allowDraft: true });
  return { draft, run: await engine.settle(run.id) };
}

/** Answer the run's current input wait; `run` may be a stale record, so the wait id is read afresh. */
async function answer(engine: TestEngine, run: RunRecord, manager = engine.manager) {
  const parked = (await engine.ports.runs.get(run.id))!;
  await manager.provideInput(run.id, parked.waiting!.waitId, true);
  await manager.waitForIdle();
  return (await engine.ports.runs.get(run.id))!;
}

const sol = (effort: 'low' | 'high' = 'low'): HarnessDefaults => ({
  byHarness: { codex: { model: 'gpt-6-sol', effort } },
});
const luna: HarnessDefaults = { byHarness: { codex: { model: 'gpt-6-luna', effort: 'low' } } };

describe('draft runs pin a snapshot of the draft', () => {
  it('keeps the snapshot through an edit while waiting; a new draft run sees the edit', async () => {
    const engine = await createTestEngine();
    const { draft, run } = await startDraft(engine);
    expect(run.status).toBe('waiting');
    // The run does not reference the editable draft row, but a frozen copy of it.
    expect(run.versionId).not.toBe(draft.id);
    const snapshot = await engine.ports.loops.getVersion(run.versionId);
    expect(snapshot).toMatchObject({
      loopId: draft.loopId,
      version: draft.version,
      status: 'snapshot',
      definition: draft.definition,
    });
    expect(snapshot?.publishedAt).toBeUndefined();
    expect(run.pinned).toEqual({
      source: 'draft',
      version: 1,
      name: 'Pinned',
      label: 'Pinned draft v1',
      defaults: { owner: { byHarness: {} }, process: engine.settings.defaults },
      classifiers: {},
    });
    const thread = await engine.manager.getThread(run.id);
    expect(thread?.run.versionId).toBe(run.versionId);
    expect(engine.events(run.id)[0]).toMatchObject({
      type: 'run.queued',
      versionId: run.versionId,
      pinned: run.pinned,
    });

    editDraft(engine, draft.id, waitThenMark('new'));
    const done = await answer(engine, run);
    expect(done).toMatchObject({ status: 'succeeded', result: 'old' });
    // Identity and label are stable for the run's whole life.
    expect(done.versionId).toBe(run.versionId);
    expect(done.pinned).toEqual(run.pinned);
    expect((await engine.ports.loops.getVersion(run.versionId))?.definition).toEqual(
      snapshot?.definition,
    );

    const next = await engine.start(draft.loopId, null, { versionId: draft.id, allowDraft: true });
    await engine.settle(next.id);
    expect(next.versionId).not.toBe(run.versionId);
    expect((await answer(engine, next)).result).toBe('new');
  });

  it('keeps the snapshot when the draft is edited while a node is running', async () => {
    const engine = await createTestEngine();
    // The inference turn takes a moment, so the draft is edited while the run is active.
    engine.ports.harness.script([{ finalText: 'thought', delayMs: 300 }]);
    const draft = engine.publish(inferThenMark('old'), { status: 'draft' });
    const run = await engine.start(draft.loopId, null, { versionId: draft.id, allowDraft: true });
    await vi.waitFor(() => expect(engine.ports.harness.started).toHaveLength(1));
    expect((await engine.ports.runs.get(run.id))?.status).toBe('running');
    editDraft(engine, draft.id, inferThenMark('new'));
    expect(await engine.settle(run.id)).toMatchObject({ status: 'succeeded', result: 'old' });
  });

  it('continues on the snapshot after a restart, and a replay fork reuses the pin', async () => {
    const engine = await createTestEngine();
    const { draft, run } = await startDraft(engine);
    editDraft(engine, draft.id, waitThenMark('edited'));
    engine.manager.stop();
    const restarted = new RunManager(engine.ports, {
      ...engine.settings,
      defaults: sol(),
      ownerDefaults: () => Promise.resolve(sol('high')),
    });
    await restarted.start();
    const done = await answer(engine, run, restarted);
    expect(done).toMatchObject({ status: 'succeeded', result: 'old', pinned: run.pinned });

    const fork = await restarted.replay({ runId: run.id, nodeId: 'shape' });
    expect(fork.versionId).toBe(run.versionId);
    expect(fork.pinned).toEqual(run.pinned);
    expect(engine.events(fork.id)[0]).toMatchObject({
      type: 'run.queued',
      versionId: run.versionId,
      pinned: run.pinned,
    });
    await restarted.waitForIdle();
    expect((await engine.ports.runs.get(fork.id))?.result).toBe('old');
    restarted.stop();
  });

  it('never starts a snapshot directly', async () => {
    const engine = await createTestEngine();
    const { run } = await startDraft(engine);
    await expect(
      engine.start(run.loopId, null, { versionId: run.versionId, allowDraft: true }),
    ).rejects.toMatchObject({ code: 'VERSION_NOT_PUBLISHED' });
  });
});

describe('published runs pin their version', () => {
  it('keeps the version through a newer publish while waiting; a new run takes the newer one', async () => {
    const engine = await createTestEngine();
    const v1 = engine.publish(waitThenMark('old', { name: 'Release' }));
    const run = await engine.settle((await engine.start(v1.loopId)).id);
    expect(run.pinned).toMatchObject({ source: 'published', version: 1, label: 'Release v1' });
    engine.publish(waitThenMark('new', { name: 'Renamed' }), { loopId: v1.loopId, version: 2 });
    expect(await answer(engine, run)).toMatchObject({
      versionId: v1.id,
      result: 'old',
      pinned: { label: 'Release v1', name: 'Release' },
    });
    const next = await engine.settle((await engine.start(v1.loopId)).id);
    expect(next.pinned).toMatchObject({ version: 2, name: 'Renamed', label: 'Renamed v2' });
    expect((await answer(engine, next)).result).toBe('new');
  });
});

describe('inherited model defaults are pinned at start', () => {
  it('ignores Settings and process default changes for a waiting run, across a restart', async () => {
    let owner: HarnessDefaults = luna;
    const engine = await createTestEngine({ ownerDefaults: () => Promise.resolve(owner) });
    const v1 = engine.publish(waitThenMark('old', { infer: true }));
    const run = await engine.settle((await engine.start(v1.loopId)).id);
    expect(run.pinned.defaults).toEqual({ owner: luna, process: engine.settings.defaults });
    owner = sol();
    engine.manager.stop();
    const restarted = new RunManager(engine.ports, {
      ...engine.settings,
      defaults: sol('high'),
      ownerDefaults: () => Promise.resolve(owner),
    });
    await restarted.start();
    expect(await answer(engine, run, restarted)).toMatchObject({ status: 'succeeded' });
    expect(engine.ports.harness.started.map(({ model, effort }) => ({ model, effort }))).toEqual([
      { model: 'gpt-6-luna', effort: 'low' },
    ]);
    // A new run inherits the current defaults.
    const next = await restarted.startRun({
      ownerId: 'local',
      loopId: v1.loopId,
      source: 'manual.api',
    });
    expect(next.pinned.defaults).toEqual({ owner: sol(), process: sol('high') });
    await restarted.waitForIdle();
    await answer(engine, next, restarted);
    expect(engine.ports.harness.started.at(-1)).toMatchObject({
      model: 'gpt-6-sol',
      effort: 'low',
    });
    restarted.stop();
  });
});

describe('children keep their own pins', () => {
  /** A child that waits for input, then returns `vars.mark`. */
  const child = (mark: string) => waitThenMark(mark, { name: 'Child' });
  /** start -> ask -> first (child) -> again (input) -> second (child) -> done. */
  function parent(childLoopId: string): LoopDefinitionInput {
    const sub = (id: string) => ({
      id,
      kind: 'subloop' as const,
      label: id,
      config: { loopRef: { loopId: childLoopId }, output: { resultTo: { var: id } } },
    });
    return {
      schemaVersion: CURRENT_DEFINITION_FORMAT,
      name: 'Parent',
      variables: { first: {}, second: {} },
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
        { id: 'ask', kind: 'wait', label: 'Ask', config: { mode: 'input', prompt: '?' } },
        sub('first'),
        { id: 'again', kind: 'wait', label: 'Again', config: { mode: 'input', prompt: '?' } },
        sub('second'),
        {
          id: 'done',
          kind: 'exit',
          label: 'Done',
          config: { returns: "vars.first & '/' & vars.second" },
        },
      ],
      edges: [
        { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'ask' } },
        { id: 'e2', from: { node: 'ask', port: 'out' }, to: { node: 'first' } },
        { id: 'e3', from: { node: 'first', port: 'out' }, to: { node: 'again' } },
        { id: 'e4', from: { node: 'again', port: 'out' }, to: { node: 'second' } },
        { id: 'e5', from: { node: 'second', port: 'out' }, to: { node: 'done' } },
      ],
    };
  }

  it('runs the selection pinned at parent start, on every visit, with the parent defaults', async () => {
    let owner: HarnessDefaults = luna;
    const engine = await createTestEngine({
      maxConcurrentRuns: 2,
      ownerDefaults: () => Promise.resolve(owner),
    });
    const c1 = engine.publish(child('c1'));
    const top = await engine.settle(
      (await engine.start(engine.publish(parent(c1.loopId)).loopId)).id,
    );
    // A newer child version and new Settings defaults arrive while the parent waits.
    engine.publish(child('c2'), { loopId: c1.loopId, version: 2 });
    owner = sol();
    await answer(engine, top);
    const [first] = await engine.ports.runs.listChildren(top.id);
    expect(first).toMatchObject({
      status: 'waiting',
      versionId: c1.id,
      pinned: {
        source: 'published',
        version: 1,
        label: 'Child v1',
        defaults: { owner: luna, process: engine.settings.defaults },
      },
    });
    // A child version published while the child itself runs does not change it either.
    engine.publish(child('c3'), { loopId: c1.loopId, version: 3 });
    expect(await answer(engine, first!)).toMatchObject({ result: 'c1', pinned: first!.pinned });
    // The parent's next visit starts a new child on the same pinned selection.
    await answer(engine, top);
    const second = (await engine.ports.runs.listChildren(top.id)).find((r) => r.id !== first!.id);
    expect(second).toMatchObject({ versionId: c1.id, pinned: first!.pinned });
    await answer(engine, second!);
    expect(await engine.settle(top.id)).toMatchObject({ status: 'succeeded', result: 'c1/c1' });

    // A new parent run selects the newest child and the current defaults.
    const later = await engine.settle((await engine.start(top.loopId)).id);
    await answer(engine, later);
    const [fresh] = await engine.ports.runs.listChildren(later.id);
    expect(fresh?.pinned).toMatchObject({ version: 3, defaults: { owner: sol() } });
  });
});

describe('triggered starts pin like manual ones', () => {
  it('pins a webhook admission at claim time and a poll item at admission', async () => {
    let owner: HarnessDefaults = luna;
    const engine = await createTestEngine({ ownerDefaults: () => Promise.resolve(owner) });
    const hook = minimalLoop();
    hook.name = 'Hooked';
    hook.nodes[0]!.config = { type: 'webhook' };
    const hooked = engine.publish(hook);
    // The receipt's admission is retried later; it keeps the pin it was claimed with.
    const create = vi
      .spyOn(engine.ports.admission, 'create')
      .mockRejectedValueOnce(new Error('later'));
    const now = engine.ports.clock.now().toISOString();
    const pending = await engine.manager.receiveWebhook(
      {
        id: engine.ports.ids.next(),
        ownerId: 'local',
        loopId: hooked.loopId,
        triggerNodeId: 'start',
        contentHash: 'b'.repeat(64),
        inbound: {
          id: engine.ports.ids.next(),
          ownerId: 'local',
          type: 'webhook',
          payload: { n: 1 },
          source: 'webhook:endpoint',
          receivedAt: now,
          runIds: [],
        },
      },
      {
        ownerId: 'local',
        loopId: hooked.loopId,
        versionId: hooked.id,
        triggerNodeId: 'start',
        triggerKind: 'webhook',
        source: 'webhook',
        payload: { n: 1 },
      },
    );
    await engine.manager.waitForWebhookRecovery();
    expect(create).toHaveBeenCalledOnce();
    owner = sol();
    engine.ports.clock.advance(10_000);
    await engine.manager.retryPendingWebhooks();
    await engine.manager.waitForIdle();
    const [webhookRun] = [...engine.ports.runs.runs.values()];
    expect(pending.receipt.intent?.run.pinned).toEqual(webhookRun?.pinned);
    expect(webhookRun).toMatchObject({
      status: 'succeeded',
      versionId: hooked.id,
      pinned: { source: 'published', label: 'Hooked v1', defaults: { owner: luna } },
    });

    const poll = minimalLoop();
    poll.name = 'Polled';
    poll.nodes[0]!.config = {
      type: 'poll',
      intervalSeconds: 5,
      probe: { kind: 'script', command: 'fake' },
      fireWhen: 'true',
      items: { select: 'probe.json', dedupeKey: 'item.key' },
    };
    const polled = engine.publish(poll);
    const item = await engine.manager.startPollItem({
      ownerId: 'local',
      loopId: polled.loopId,
      versionId: polled.id,
      triggerNodeId: 'start',
      triggerKind: 'poll',
      source: 'poll',
      dedupeKey: 'one',
    });
    expect(item?.pinned).toMatchObject({ label: 'Polled v1', defaults: { owner: sol() } });
    expect(engine.events(item!.id)[0]).toMatchObject({
      versionId: polled.id,
      pinned: item!.pinned,
    });
  });
});

describe('classifier bindings are pinned at start', () => {
  /** start -> ask (input) -> decide (classifier `custom`) -> yes | no. */
  function waitThenClassify(model = 'custom'): LoopDefinitionInput {
    return {
      schemaVersion: CURRENT_DEFINITION_FORMAT,
      name: 'Classified',
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
        { id: 'ask', kind: 'wait', label: 'Ask', config: { mode: 'input', prompt: 'Go?' } },
        {
          id: 'decide',
          kind: 'decision',
          label: 'Decide',
          config: {
            kind: 'classifier',
            model,
            question: 'Which?',
            answer: {
              type: 'choice',
              options: [
                { id: 'yes', label: 'Yes', criteria: 'Yes' },
                { id: 'no', label: 'No', criteria: 'No' },
              ],
            },
          },
        },
        { id: 'yes', kind: 'exit', label: 'Yes', config: { returns: '"yes"' } },
        { id: 'no', kind: 'exit', label: 'No', config: { returns: '"no"' } },
      ],
      edges: [
        { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'ask' } },
        { id: 'e2', from: { node: 'ask', port: 'out' }, to: { node: 'decide' } },
        { id: 'e3', from: { node: 'decide', port: 'yes' }, to: { node: 'yes' } },
        { id: 'e4', from: { node: 'decide', port: 'no' }, to: { node: 'no' } },
      ],
    };
  }
  const binding = (providerModel: string) => ({
    provider: 'http' as const,
    providerModel,
    primitives: ['choice' as const],
    endpoint: 'https://classifier.test',
  });

  it('calls the binding pinned at start after a catalog edit while waiting and a restart', async () => {
    const engine = await createTestEngine();
    const registry = engine.ports.classifiers;
    registry.models.set('custom', engine.ports.jev);
    registry.bindings.set('custom', binding('model-original'));
    const v1 = engine.publish(waitThenClassify());
    const run = await engine.settle((await engine.start(v1.loopId)).id);
    expect(run.pinned.classifiers).toEqual({ custom: binding('model-original') });
    // The owner edits the catalog entry while the run waits, then the process restarts.
    registry.bindings.set('custom', binding('model-edited'));
    engine.manager.stop();
    const restarted = new RunManager(engine.ports, engine.settings);
    await restarted.start();
    expect(await answer(engine, run, restarted)).toMatchObject({ status: 'succeeded' });
    expect(registry.requests.map((request) => request.binding.providerModel)).toEqual([
      'model-original',
    ]);
    expect(engine.events(run.id).find((event) => event.type === 'decision.made')).toMatchObject({
      provenance: { classifierId: 'custom', model: 'model-original' },
    });
    // A new run pins the edited entry; a replay fork keeps the source's binding.
    const next = await restarted.startRun({
      ownerId: 'local',
      loopId: v1.loopId,
      source: 'manual.api',
    });
    expect(next.pinned.classifiers).toEqual({ custom: binding('model-edited') });
    const fork = await restarted.replay({ runId: run.id, nodeId: 'decide' });
    await restarted.waitForIdle();
    expect(fork.pinned.classifiers).toEqual({ custom: binding('model-original') });
    expect(registry.requests.at(-1)?.binding.providerModel).toBe('model-original');
    restarted.stop();
  });

  it('keeps availability live: a disabled classifier fails explicitly, and nothing is substituted', async () => {
    const engine = await createTestEngine();
    const registry = engine.ports.classifiers;
    registry.models.set('custom', engine.ports.jev);
    registry.bindings.set('custom', binding('model-original'));
    const run = await engine.settle(
      (await engine.start(engine.publish(waitThenClassify()).loopId)).id,
    );
    registry.unavailable.set('custom', {
      status: 'unavailable',
      reason: 'CLASSIFIER_MODEL_DISABLED',
      message: 'disabled',
    });
    expect(await answer(engine, run)).toMatchObject({
      status: 'failed',
      failure: { code: 'EVALUATION_UNAVAILABLE', resumable: true },
    });
    expect(engine.ports.jev.choices).toEqual([]);
  });

  it('never looks up a classifier that was missing when the run started', async () => {
    const engine = await createTestEngine();
    const run = await engine.settle(
      (await engine.start(engine.publish(waitThenClassify('later')).loopId)).id,
    );
    expect(run.pinned.classifiers).toEqual({});
    // Created afterwards: a catalog change, so it reaches new runs only.
    engine.ports.classifiers.models.set('later', engine.ports.jev);
    expect(await answer(engine, run)).toMatchObject({
      status: 'failed',
      failure: {
        code: 'EVALUATION_UNAVAILABLE',
        resumable: false,
        details: { reason: 'CLASSIFIER_MODEL_NOT_FOUND' },
      },
    });
    expect(engine.ports.classifiers.requests).toEqual([]);
  });

  it('binds and calls a classifier whose catalog id is an Object property name', async () => {
    const engine = await createTestEngine();
    const registry = engine.ports.classifiers;
    registry.models.set('constructor', engine.ports.jev);
    registry.bindings.set('constructor', binding('model-original'));
    const run = await engine.settle(
      (await engine.start(engine.publish(waitThenClassify('constructor')).loopId)).id,
    );
    expect(run.pinned.classifiers).toEqual({ constructor: binding('model-original') });
    expect(await answer(engine, run)).toMatchObject({ status: 'succeeded', result: 'yes' });
    expect(registry.requests).toEqual([
      expect.objectContaining({ modelId: 'constructor', binding: binding('model-original') }),
    ]);
  });

  it('treats an unbound Object property name as missing, not as an inherited binding', async () => {
    const engine = await createTestEngine();
    const run = await engine.settle(
      (await engine.start(engine.publish(waitThenClassify('constructor')).loopId)).id,
    );
    expect(run.pinned.classifiers).toEqual({});
    expect(Object.keys(run.pinned.classifiers)).toEqual([]);
    expect(await answer(engine, run)).toMatchObject({
      status: 'failed',
      failure: {
        code: 'EVALUATION_UNAVAILABLE',
        resumable: false,
        details: { reason: 'CLASSIFIER_MODEL_NOT_FOUND' },
      },
    });
    expect(engine.ports.classifiers.requests).toEqual([]);
  });

  it('gives a child its parent binding for a shared classifier', async () => {
    const engine = await createTestEngine({ maxConcurrentRuns: 2 });
    const registry = engine.ports.classifiers;
    registry.models.set('custom', engine.ports.jev);
    registry.bindings.set('custom', binding('model-original'));
    const child = engine.publish({ ...waitThenClassify(), name: 'Child classifier' });
    const parent: LoopDefinitionInput = {
      ...waitThenClassify(),
      name: 'Parent classifier',
      nodes: [
        ...waitThenClassify().nodes.filter((node) => node.id !== 'yes'),
        {
          id: 'yes',
          kind: 'subloop',
          label: 'Child',
          config: { loopRef: { loopId: child.loopId } },
        },
        { id: 'done', kind: 'exit', label: 'Done', config: {} },
      ],
      edges: [
        ...waitThenClassify().edges,
        { id: 'e5', from: { node: 'yes', port: 'out' }, to: { node: 'done' } },
      ],
    };
    const top = await engine.settle((await engine.start(engine.publish(parent).loopId)).id);
    registry.bindings.set('custom', binding('model-edited'));
    await answer(engine, top);
    const [started] = await engine.ports.runs.listChildren(top.id);
    expect(started?.pinned.classifiers).toEqual({ custom: binding('model-original') });
  });
});

describe('pin labels', () => {
  it('name the source and number', () => {
    expect(pinLabel('published', 'Review', 4)).toBe('Review v4');
    expect(pinLabel('draft', 'Review', 5)).toBe('Review draft v5');
  });
});
