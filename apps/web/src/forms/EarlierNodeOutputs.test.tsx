import type { LoopDefinitionInput, NodeInput } from '@graphgoblin/contracts';
import { evaluateExpression, renderTemplate } from '@graphgoblin/domain';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { useEditorStore } from '../editor/store.js';
import { CodeField } from './CodeField.js';
import {
  earlierNodes,
  NodeOutputsContext,
  outputNote,
  outputReference,
  usesRunThread,
} from './EarlierNodeOutputs.js';
import type { PreviewKind } from './preview.js';

const script = (
  id: string,
  config: Extract<NodeInput, { kind: 'script' }>['config'] = { command: 'node' },
): NodeInput => ({ id, label: `Script ${id}`, kind: 'script', config });
const current = script('current');
function graph(
  pairs: [string, string][],
  nodes: NodeInput[] = [script('a'), script('b'), script('c'), current],
): LoopDefinitionInput {
  return {
    schemaVersion: 4,
    name: 'references',
    nodes,
    edges: pairs.map(([from, to], i) => ({
      id: `e${i}`,
      from: { node: from, port: 'out' },
      to: { node: to },
    })),
  };
}
const ids = (definition: LoopDefinitionInput) =>
  earlierNodes(definition, 'current').map((node) => node.id);

describe('earlier paths', () => {
  it('orders a branch and merge by shortest distance, then id; excludes disconnected successors', () => {
    expect(
      ids(
        graph(
          [
            ['a', 'b'],
            ['a', 'c'],
            ['c', 'current'],
            ['b', 'current'],
            ['current', 'later'],
          ],
          [script('later'), current, script('c'), script('b'), script('a'), script('unrelated')],
        ),
      ),
    ).toEqual(['b', 'c', 'a']);
  });
  it('includes this node only on a nonempty cycle', () => {
    expect(
      ids(
        graph([
          ['a', 'current'],
          ['current', 'b'],
          ['b', 'current'],
        ]),
      ),
    ).toEqual(['a', 'b', 'current']);
    expect(ids(graph([['current', 'current']]))).toEqual(['current']);
  });
  it('terminates on an earlier cycle without including the current node', () => {
    expect(
      ids(
        graph([
          ['a', 'b'],
          ['b', 'a'],
          ['b', 'current'],
        ]),
      ),
    ).toEqual(['b', 'a']);
    expect(ids(graph([]))).toEqual([]);
  });
});

describe('references use the real run engines', () => {
  it.each(['producer', 'with_underscore', 'old-id', 'a-b-c', 'true', 'false', 'null', 'and'])(
    'renders %s in Liquid and JSONata',
    async (id) => {
      const view = { outputs: { [id]: { value: 42 } } };
      const template = outputReference(id, 'template');
      const expression = outputReference(id, 'expression');
      expect(await renderTemplate(template, view)).toBe('42');
      expect(await evaluateExpression(expression, view)).toBe(42);
      expect(template).toBe(
        id.includes('-') ? `{{ outputs["${id}"].value }}` : `{{ outputs.${id}.value }}`,
      );
      expect(expression).toBe(
        id.includes('-') || ['true', 'false', 'null'].includes(id)
          ? `outputs."${id}".value`
          : `outputs.${id}.value`,
      );
    },
  );
});

describe('handler-derived notes', () => {
  it.each<[NodeInput, string | undefined]>([
    [
      { id: 't', label: 'Trigger', kind: 'trigger', config: { type: 'manual' } },
      'The trigger payload.',
    ],
    [
      { id: 'i', label: 'Inference', kind: 'inference', config: { prompt: { template: 'hello' } } },
      'With an output schema, the structured result; otherwise the final reply text, parsed as JSON when possible. Output transforms may change it.',
    ],
    [
      script('s'),
      'Standard output itself, parsed as JSON when possible; otherwise text (no stdout wrapper).',
    ],
    [
      script('s', { command: 'node', stdout: 'last-output' }),
      'Standard output itself, parsed as JSON when possible; otherwise text (no stdout wrapper).',
    ],
    [script('s', { command: 'node', stdout: 'patch' }), undefined],
    [script('s', { command: 'node', stdout: 'ignore' }), undefined],
    [
      {
        id: 'd',
        label: 'Decision',
        kind: 'decision',
        config: {
          kind: 'expression',
          jsonata: '"yes"',
          routes: [
            { id: 'yes', label: 'Yes' },
            { id: 'no', label: 'No' },
          ],
        },
      },
      'Decision evidence: observation, provenance and portId, plus gate details for a repeat gate.',
    ],
    [{ id: 'm', label: 'Mutate', kind: 'mutate', config: { operations: [] } }, undefined],
    [
      {
        id: 's',
        label: 'Subloop',
        kind: 'subloop',
        config: { loopRef: { loopId: '01K00000000000000000000000' } },
      },
      'Child summary: status, outcome, result and childRunId.',
    ],
    [
      {
        id: 's',
        label: 'Subloop',
        kind: 'subloop',
        config: {
          loopRef: { loopId: '01K00000000000000000000000' },
          output: { mode: 'merge', resultTo: { lastOutput: true } },
        },
      },
      'Child summary: status, outcome, result and childRunId.',
    ],
    [
      {
        id: 's',
        label: 'Subloop',
        kind: 'subloop',
        config: {
          loopRef: { loopId: '01K00000000000000000000000' },
          output: { resultTo: { lastOutput: false } },
        },
      },
      undefined,
    ],
    [
      {
        id: 's',
        label: 'Subloop',
        kind: 'subloop',
        config: {
          loopRef: { loopId: '01K00000000000000000000000' },
          output: { mode: 'custom', custom: { patch: '[]' } },
        },
      },
      undefined,
    ],
    [
      { id: 'w', label: 'Wait', kind: 'wait', config: { mode: 'duration', seconds: 1 } },
      'Input or signal payload; timer wake {wokeAt, reason}; continuing timeout {timedOut: true}.',
    ],
    [
      {
        id: 'h',
        label: 'Heartbeat',
        kind: 'heartbeat',
        config: { intervalSeconds: 5, maxBeats: 1 },
      },
      'Completion summary: beat, probe and satisfied: true or exhausted: true.',
    ],
    [{ id: 'e', label: 'Exit', kind: 'exit', config: {} }, undefined],
  ])('$0.kind: output note respects configuration', (node, note) => {
    expect(outputNote(node)).toBe(note);
  });
});

const nodeOfKind = (kind: NodeInput['kind']): NodeInput =>
  ({ ...current, kind, config: {} }) as NodeInput;
const scopeCases: [NodeInput['kind'], string, PreviewKind, boolean][] = [
  ['script', 'args.0', 'template', true],
  ['inference', 'prompt.template', 'template', true],
  ['inference', 'contextFiles.0.template', 'template', true],
  ['inference', 'input.0.value.jsonata', 'expression', true],
  ['inference', 'output.schema.repair.prompt', 'template', true],
  ['inference', 'input.0.where', 'expression', false],
  ['inference', 'output.transforms.0.where', 'expression', false],
  ['decision', 'jsonata', 'expression', true],
  ['decision', 'instructions', 'template', true],
  ['decision', 'question', 'template', true],
  ['decision', 'context.messages.where', 'expression', false],
  ['mutate', 'operations.0.value.template', 'template', true],
  ['mutate', 'operations.0.where', 'expression', false],
  ['wait', 'prompt', 'template', true],
  ['wait', 'timestamp', 'template', true],
  ['wait', 'filter', 'expression', false],
  ['heartbeat', 'until', 'expression', false],
  ['heartbeat', 'deadline', 'template', true],
  ['heartbeat', 'probe.url', 'template', true],
  ['heartbeat', 'probe.headers.where', 'template', true],
  ['subloop', 'input.vars.where', 'expression', true],
  ['subloop', 'input.trigger.payload', 'expression', true],
  ['subloop', 'input.inject.0.content', 'template', true],
  ['subloop', 'input.messages.where', 'expression', false],
  ['subloop', 'input.artifacts.where', 'expression', false],
  ['subloop', 'output.vars.map.answer', 'expression', false],
  ['subloop', 'output.custom.patch', 'expression', false],
  ['subloop', 'output.messages.where', 'expression', false],
  ['exit', 'returns', 'expression', true],
  ['trigger', 'dedupeKey', 'expression', false],
  ['trigger', 'probe.url', 'template', false],
  ['trigger', 'fireWhen', 'expression', false],
  ['trigger', 'items.select', 'expression', false],
  ['trigger', 'items.dedupeKey', 'expression', false],
];

function field(
  node = current,
  path: string | undefined = 'args.0',
  kind: PreviewKind = 'template',
  definition = graph([['a', 'current']]),
) {
  return (
    <NodeOutputsContext value={{ node, definition }}>
      <CodeField
        id="field"
        label="Source"
        kind={kind}
        path={path}
        value=""
        optional
        onChange={vi.fn()}
      />
    </NodeOutputsContext>
  );
}

describe('field rendering and clipboard', () => {
  it.each(scopeCases)('%s %s (%s) shows list: %s', (kind, path, syntax, visible) => {
    const node = nodeOfKind(kind);
    expect(usesRunThread(node, path, syntax)).toBe(visible);
    render(field(node, path, syntax));
    expect(screen.queryByRole('button', { name: 'Earlier node outputs (1)' }) !== null).toBe(
      visible,
    );
  });
  it('renders nothing without a node context or a field path, or without earlier outputs', () => {
    const view = render(
      <CodeField id="settings" label="Settings" kind="template" value="" onChange={vi.fn()} />,
    );
    expect(screen.queryByText(/Earlier node outputs/)).not.toBeInTheDocument();
    // Direct CodeFields without the form's path cannot opt into run-thread help.
    view.rerender(
      <NodeOutputsContext value={{ node: current, definition: graph([['a', 'current']]) }}>
        <CodeField id="direct" label="Direct" kind="template" value="" onChange={vi.fn()} />
      </NodeOutputsContext>,
    );
    expect(screen.queryByText(/Earlier node outputs/)).not.toBeInTheDocument();
    view.rerender(field(current, 'args.0', 'template', graph([])));
    expect(screen.queryByText(/Earlier node outputs/)).not.toBeInTheDocument();
    view.rerender(
      field(
        current,
        'args.0',
        'template',
        graph(
          [['a', 'current']],
          [{ id: 'a', kind: 'mutate', label: 'Mutate', config: { operations: [] } }, current],
        ),
      ),
    );
    expect(screen.queryByText(/Earlier node outputs/)).not.toBeInTheDocument();
  });
  it.each(['template', 'expression'] as const)(
    'starts collapsed, supports keyboard expansion and copies exact %s reference',
    async (kind) => {
      const user = userEvent.setup();
      render(
        field(
          current,
          'args.0',
          kind,
          graph(
            [
              ['old-id', 'current'],
              ['current', 'current'],
            ],
            [script('old-id'), current],
          ),
        ),
      );
      const toggle = screen.getByRole('button', { name: 'Earlier node outputs (2)' });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('button', { name: /Copy reference/ })).not.toBeInTheDocument();
      toggle.focus();
      await user.keyboard('{Enter}');
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText(/previous visit$/)).toBeVisible();
      await user.click(
        screen.getByRole('button', { name: 'Copy reference for Script old-id (old-id)' }),
      );
      expect(await navigator.clipboard.readText()).toBe(outputReference('old-id', kind));
      expect(screen.getByRole('status')).toHaveTextContent('Copied');
      expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    },
  );
  it('announces clipboard failure and leaves the full reference selectable', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'));
    render(field());
    await user.click(screen.getByRole('button', { name: 'Earlier node outputs (1)' }));
    await user.click(screen.getByRole('button', { name: /Copy reference/ }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Copy failed. Select the reference and copy it manually.',
    );
    expect(screen.getByText('{{ outputs.a.value }}')).toHaveClass('select-text');
  });
  it('uses the live store definition in the node dialog when edges and ids change', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const definition = graph([['a', 'current']], [script('a'), current]);
    const loop = api.addLoop(definition);
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'references' });
    act(() => useEditorStore.getState().openNode('current'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Add args' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('textbox', { name: 'Args 1' })).toHaveFocus(),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Earlier node outputs (1)' }));
    expect(within(dialog).getByText('{{ outputs.a.value }}')).toBeVisible();
    act(() => useEditorStore.getState().renameNode('a', 'renamed-id'));
    expect(within(dialog).getByText('{{ outputs["renamed-id"].value }}')).toBeVisible();
    act(() => useEditorStore.getState().removeEdge('e0'));
    expect(within(dialog).queryByText(/Earlier node outputs/)).not.toBeInTheDocument();
    act(() => {
      useEditorStore
        .getState()
        .connect({ source: 'renamed-id', sourceHandle: 'out', target: 'current' });
    });
    expect(
      within(dialog).getByRole('button', { name: 'Earlier node outputs (1)' }),
    ).toBeInTheDocument();
  });
});
