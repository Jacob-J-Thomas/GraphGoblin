import { CURRENT_DEFINITION_FORMAT, type LoopDefinitionInput } from '@graphgoblin/contracts';
import { createSystemChatDefinition, enableChatAudio, renameLoopNode } from '@graphgoblin/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VOICE_STEP_MESSAGE } from './chat-protection.js';
import { COALESCE_MS } from './history.js';
import { validateDraft } from './model.js';
import { renameSummary } from './RenameNotice.js';
import { ID_FORMAT_MESSAGE, useEditorStore, type EditorState } from './store.js';

const store = () => useEditorStore.getState();
const node = (id: string) => store().definition!.nodes.find((n) => n.id === id);
const config = (id: string) => node(id)!.config as Record<string, unknown>;

/**
 * Work feeds a review and an exit. Its own prompt reads its previous visit, a sibling's Liquid
 * reads its output and visit count, the exit's JSONata returns its output and also reads a key it
 * cannot know, and the loop's working directory template reads it too.
 */
function referencing(): LoopDefinitionInput {
  return {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name: 'references',
    settings: {
      workingDirectory: { kind: 'template', template: '/tmp/{{ outputs.work.value }}' },
    },
    variables: { key: { type: 'string' } },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      {
        id: 'work',
        kind: 'inference',
        label: 'Work',
        config: { prompt: { template: 'Earlier: {{ outputs.work.value }}. Say work.' } },
      },
      {
        id: 'review',
        kind: 'inference',
        label: 'Review',
        config: {
          prompt: {
            template: 'Check {{ outputs.work.value }} after {{ counters.nodeVisits.work }} visits.',
          },
        },
      },
      {
        id: 'done',
        kind: 'exit',
        label: 'Done',
        config: { returns: '[outputs.work.value, $lookup(outputs, vars.key)]' },
      },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'work', port: 'in' } },
      { id: 'e2', from: { node: 'work', port: 'out' }, to: { node: 'review', port: 'in' } },
      { id: 'e3', from: { node: 'review', port: 'out' }, to: { node: 'done', port: 'in' } },
    ],
  };
}

const held = { message: 'Not valid JSON yet.', text: '{"type": ' };
const elsewhere = { message: 'Not valid JSON yet.', text: '[1, ' };

let now = 0;
beforeEach(() => {
  store().reset();
  now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => vi.restoreAllMocks());
/** Let the open step close, so the next change starts a new one. */
const pause = () => (now += COALESCE_MS + 1);

describe('renaming a node with its references (#273)', () => {
  it('is schema-valid before the rename and reports only the expected dynamic warning', () => {
    const issues = validateDraft(referencing()).issues;
    expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(issues.map((issue) => issue.code)).toEqual(['NODE_REFERENCE_UNCERTAIN']);
  });

  it('applies the definition, routes, held text, selection and focus target as one write', () => {
    store().load('L1', referencing());
    store().setFieldError('node:work', 'output.schema', held);
    store().setFieldError('node:review', 'output.schema', elsewhere);
    store().setFieldError('variables', 'variables.key', elsewhere);
    store().openNode('work', { field: 'config.prompt.template' });
    pause();
    const before = store();
    const writes: EditorState[] = [];
    const unsubscribe = useEditorStore.subscribe((state) => writes.push(state));
    expect(store().renameNode('work', 'draft')).toBeUndefined();
    unsubscribe();

    // Autosave, the device mirror and every subscriber see one complete state.
    expect(writes).toHaveLength(1);
    const after = writes[0]!;
    expect(after).toBe(store());
    expect(after.revision).toBe(before.revision + 1);
    expect(after.saveState).toBe('pending');
    expect(after.past).toHaveLength(before.past.length + 1);
    expect(after.past.at(-1)).toMatchObject({
      label: 'rename work to draft',
      renamed: { from: 'work', to: 'draft' },
      definition: before.definition,
      fieldErrors: before.fieldErrors,
    });
    expect(after.future).toEqual([]);

    // The id, both edge ends and every understood reference, wherever they are.
    expect(node('work')).toBeUndefined();
    expect(config('draft')['prompt']).toEqual({
      template: 'Earlier: {{ outputs.draft.value }}. Say work.',
    });
    expect(config('review')['prompt']).toEqual({
      template: 'Check {{ outputs.draft.value }} after {{ counters.nodeVisits.draft }} visits.',
    });
    expect(config('done')['returns']).toBe('[outputs.draft.value, $lookup(outputs, vars.key)]');
    expect(after.definition!.settings?.workingDirectory).toEqual({
      kind: 'template',
      template: '/tmp/{{ outputs.draft.value }}',
    });
    expect(after.definition!.edges.map((e) => [e.id, e.from.node, e.to.node])).toEqual([
      ['e1', 'start', 'draft'],
      ['e2', 'draft', 'review'],
      ['e3', 'review', 'done'],
    ]);

    // Its unfinished input, the selection and the pending focus follow it; other text stays.
    expect(after.fieldErrors).toEqual({
      'node:draft': { 'output.schema': held },
      'node:review': { 'output.schema': elsewhere },
      variables: { 'variables.key': elsewhere },
    });
    expect(after.fieldErrors['node:review']).toBe(before.fieldErrors['node:review']);
    expect(after.fieldErrors['variables']).toBe(before.fieldErrors['variables']);
    expect(after).toMatchObject({
      selectedNodeId: 'draft',
      nodeDialogOpen: true,
      nodeDialogSession: before.nodeDialogSession,
      nodeFocus: { nodeId: 'draft', field: 'config.prompt.template' },
    });

    // Only the forms holding a repaired source remount; the trigger's does not.
    expect(after.formEpochs).toEqual({
      'node:draft': 1,
      'node:review': 1,
      'node:done': 1,
      settings: 1,
    });

    // Five references and two connections; the exit's computed key is left for review.
    expect(after.renameReport).toMatchObject({
      from: 'work',
      to: 'draft',
      connections: 2,
      references: 5,
      warnings: [
        {
          severity: 'warning',
          code: 'NODE_REFERENCE_UNCERTAIN',
          nodeId: 'done',
          path: 'config.returns',
        },
      ],
    });
    // The persisted draft analysis no longer finds anything new to report.
    expect(validateDraft(after.definition!).issues.map((issue) => issue.code)).toEqual([
      'NODE_REFERENCE_UNCERTAIN',
    ]);
  });

  it('undoes and redoes every repaired source, edge end, held text and the selection', () => {
    const original = referencing();
    store().load('L1', original);
    store().setFieldError('node:work', 'output.schema', held);
    store().openNode('work');
    pause();
    const loaded = { definition: store().definition, fieldErrors: store().fieldErrors };
    store().renameNode('work', 'draft');
    const renamed = { definition: store().definition, fieldErrors: store().fieldErrors };
    const revision = store().revision;

    store().undo();
    expect(store().definition).toEqual(loaded.definition);
    expect(store().fieldErrors).toEqual(loaded.fieldErrors);
    expect(store()).toMatchObject({
      selectedNodeId: 'work',
      nodeDialogOpen: true,
      revision: revision + 1,
      saveState: 'pending',
      renameReport: undefined,
    });

    store().redo();
    expect(store().definition).toEqual(renamed.definition);
    expect(store().fieldErrors).toEqual(renamed.fieldErrors);
    expect(store()).toMatchObject({ selectedNodeId: 'draft', revision: revision + 2 });
    expect(original).toEqual(referencing());
  });

  it('keeps the report through later edits and their undo, until the rename itself is undone', () => {
    store().load('L1', referencing());
    store().renameNode('work', 'draft');
    const report = store().renameReport;
    pause();
    store().updateNode('done', { config: { returns: 'outputs.draft.value' } });
    expect(store().renameReport).toBe(report);
    store().undo();
    expect(store().renameReport).toBe(report);
    store().undo();
    expect(store().renameReport).toBeUndefined();
    store().redo();
    expect(store().renameReport).toBeUndefined();

    // Dismissing forgets it, and a load starts without one.
    store().renameNode('draft', 'other');
    expect(store().renameReport).toMatchObject({ from: 'draft', to: 'other' });
    store().dismissRenameReport();
    expect(store().renameReport).toBeUndefined();
    store().renameNode('other', 'again');
    store().load('L1', referencing());
    expect(store()).toMatchObject({ renameReport: undefined, formEpochs: {} });
  });

  it('moves a form count with its node, so an unrepaired rename does not remount the form', () => {
    const definition = referencing();
    store().load('L1', definition);
    store().renameNode('work', 'draft');
    expect(store().formEpochs['node:draft']).toBe(1);
    // Nothing reads review itself: its form keeps its count under the new id.
    store().renameNode('review', 'check');
    expect(store().formEpochs).toMatchObject({ 'node:check': 1, 'node:done': 1 });
    expect(store().formEpochs).not.toHaveProperty('node:review');
    // The exit's own form is repaired when the node it reads is renamed again.
    store().renameNode('draft', 'final');
    expect(store().formEpochs).toMatchObject({
      'node:final': 2,
      'node:check': 2,
      'node:done': 2,
      settings: 2,
    });
  });

  it('refuses ids the domain refuses, changing nothing, with the editor wording', () => {
    store().load('L1', referencing());
    const before = store();
    expect(store().renameNode('work', 'work')).toBeUndefined();
    expect(store().renameNode('work', '9lives')).toBe(ID_FORMAT_MESSAGE);
    expect(store().renameNode('work', 'has space')).toBe(ID_FORMAT_MESSAGE);
    expect(store().renameNode('work', 'review')).toBe('"review" is already used');
    expect(store().renameNode('gone', 'other')).toBe('"gone" is no longer in this draft');
    expect(store()).toBe(before);

    const twice = referencing();
    twice.nodes.push({ ...twice.nodes[1]!, label: 'Copy' });
    store().load('L1', twice);
    const loaded = store();
    expect(store().renameNode('work', 'one')).toBe(
      'More than one node uses "work"; give the others their own ids first',
    );
    expect(store()).toBe(loaded);
  });

  it('keeps decision route ownership with a renamed decision and repairs its readers', () => {
    const definition: LoopDefinitionInput = {
      ...referencing(),
      nodes: [
        ...referencing().nodes.filter((n) => n.id !== 'done'),
        {
          id: 'gate',
          kind: 'decision',
          label: 'Gate',
          config: {
            kind: 'expression',
            jsonata: 'counters.nodeVisits.review > 2 ? "stop" : "again"',
            routes: [
              { id: 'again', label: 'Again', repeat: true },
              { id: 'stop', label: 'Stop' },
            ],
            maxPasses: 3,
          },
        },
        {
          id: 'done',
          kind: 'exit',
          label: 'Done',
          config: { returns: 'gates.gate.passes' },
        },
      ],
      edges: [
        ...referencing().edges.filter((e) => e.id !== 'e3'),
        { id: 'e3', from: { node: 'review', port: 'out' }, to: { node: 'gate', port: 'in' } },
        { id: 'e4', from: { node: 'gate', port: 'again' }, to: { node: 'work', port: 'in' } },
        { id: 'e5', from: { node: 'gate', port: 'stop' }, to: { node: 'done', port: 'in' } },
        {
          id: 'e6',
          from: { node: 'gate', port: 'limit-reached' },
          to: { node: 'done', port: 'in' },
        },
      ],
    };
    store().load('L1', definition);
    const rows = store().decisionRoutes['gate'];
    expect(rows?.rows.map((row) => row.edgeIds)).toEqual([['e4'], ['e5']]);
    store().renameNode('gate', 'check');
    expect(store().decisionRoutes['check']).toBe(rows);
    expect(store().decisionRoutes).not.toHaveProperty('gate');
    expect(config('done')['returns']).toBe('gates.check.passes');
    expect(store().definition!.edges.filter((e) => e.from.node === 'check')).toHaveLength(3);
    // The gate the exit reads is a known identity after the rename: no publication error.
    expect(
      validateDraft(store().definition!).issues.filter((issue) => issue.severity === 'error'),
    ).toEqual([]);

    // A reviewed decision reading another node is repaired too, in its own config.
    store().renameNode('review', 'audit');
    expect(config('check')['jsonata']).toBe('counters.nodeVisits.audit > 2 ? "stop" : "again"');
    expect(store().decisionRoutes['check']).toBe(rows);
  });

  it('reports the repaired sources and each connection once, a repeat self-edge included (#476)', () => {
    const base = referencing();
    const definition: LoopDefinitionInput = {
      ...base,
      nodes: [
        ...base.nodes.filter((n) => n.id !== 'done'),
        {
          id: 'gate',
          kind: 'decision',
          label: 'Gate',
          config: {
            kind: 'expression',
            jsonata: 'counters.nodeVisits.gate > 2 ? "stop" : "again"',
            routes: [
              { id: 'again', label: 'Again', repeat: true },
              { id: 'stop', label: 'Stop' },
            ],
            maxPasses: 3,
          },
        },
        { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'gates.gate.passes' } },
      ],
      edges: [
        ...base.edges.filter((e) => e.id !== 'e3'),
        { id: 'e3', from: { node: 'review', port: 'out' }, to: { node: 'gate', port: 'in' } },
        { id: 'e4', from: { node: 'gate', port: 'again' }, to: { node: 'gate', port: 'in' } },
        { id: 'e5', from: { node: 'gate', port: 'stop' }, to: { node: 'done', port: 'in' } },
        {
          id: 'e6',
          from: { node: 'gate', port: 'limit-reached' },
          to: { node: 'done', port: 'in' },
        },
      ],
    };
    store().load('L1', definition);
    pause();
    const loaded = store().definition;
    expect(store().renameNode('gate', 'check')).toBeUndefined();
    const ends = () => store().definition!.edges.map((e) => [e.id, e.from.node, e.to.node]);
    const renamedEnds = [
      ['e1', 'start', 'work'],
      ['e2', 'work', 'review'],
      ['e3', 'review', 'check'],
      ['e4', 'check', 'check'],
      ['e5', 'check', 'done'],
      ['e6', 'check', 'done'],
    ];
    expect(ends()).toEqual(renamedEnds);
    expect(config('check')['jsonata']).toBe('counters.nodeVisits.check > 2 ? "stop" : "again"');
    expect(config('done')['returns']).toBe('gates.check.passes');

    // Four connections hold the gate, e4 at both ends; the two sources reading it are the
    // references. Connection ends are never counted as references.
    const report = store().renameReport!;
    expect(report).toMatchObject({
      from: 'gate',
      to: 'check',
      connections: 4,
      references: 2,
      warnings: [],
    });
    expect(renameSummary(report)).toBe(
      'Updated 2 references in expressions, templates and mutation paths, and 4 connections.',
    );
    // Both counts are the domain's for the draft the store renamed, taken as returned: the
    // connections are its `repairedConnections`, not its five `repairedEndpoints`.
    const domain = renameLoopNode(loaded!, 'gate', 'check');
    if (domain.kind !== 'renamed') throw new Error(domain.kind);
    expect(domain).toMatchObject({
      repairedSources: 2,
      repairedConnections: 4,
      repairedEndpoints: 5,
    });
    expect(report).toMatchObject({
      connections: domain.repairedConnections,
      references: domain.repairedSources,
    });

    store().undo();
    expect(store().definition).toEqual(loaded);
    expect(store().renameReport).toBeUndefined();
    store().redo();
    expect(ends()).toEqual(renamedEnds);
    expect(store().renameReport).toBeUndefined();
  });

  it('keeps protected voice steps: no rename, no report, the existing message', () => {
    const definition = enableChatAudio(
      createSystemChatDefinition({ name: 'Gateway chat', harness: 'codex' }),
      {
        id: 'chat-normalize',
        label: 'Normalize',
        kind: 'script',
        config: {
          command: 'normalizer',
          args: [],
          cwd: 'workspace',
          stdin: 'thread',
          stdout: 'last-output',
        },
        ui: { x: 0, y: 0 },
      },
    );
    store().load('gateway', definition);
    useEditorStore.setState({ systemChat: true });
    for (const id of ['chat-normalize', 'chat-normalize-check', 'chat-normalize-invalid'])
      expect(store().renameNode(id, `${id}-renamed`)).toBe(VOICE_STEP_MESSAGE);
    expect(store()).toMatchObject({
      definition,
      revision: 0,
      past: [],
      renameReport: undefined,
      connectionError: VOICE_STEP_MESSAGE,
    });
    // An ordinary step of the chat loop still renames, and its readers follow it.
    expect(store().renameNode('respond', 'answer')).toBeUndefined();
    expect(JSON.stringify(store().definition)).not.toContain('outputs.respond');
    expect(JSON.stringify(store().definition)).toContain('outputs.answer');
  });

  it('reports scripts and generated patches it cannot read without a location', () => {
    const definition = referencing();
    definition.nodes.push({
      id: 'probe',
      kind: 'script',
      label: 'Probe',
      config: { command: 'probe', args: [], cwd: 'workspace', stdin: 'thread' },
    });
    store().load('L1', definition);
    store().renameNode('work', 'draft');
    const general = store().renameReport!.warnings.filter((issue) => issue.nodeId === undefined);
    expect(general).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'NODE_REFERENCE_UNCERTAIN',
        message: 'Check scripts and generated patches for references to the old ID.',
      }),
    ]);
    expect(general[0]).not.toHaveProperty('path');
  });
});
