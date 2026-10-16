import { LoopDefinitionSchema, type JsonValue } from '@graphgoblin/contracts';
import { evaluateExpression, validateLoop } from '@graphgoblin/domain';
import { describe, expect, it } from 'vitest';
import { manualTriggerConfig, triggerConfig } from '../__fixtures__/triggers.js';
import { previewGitHubPreset } from './github-fragment.js';
import { newLoopDefinition } from './model.js';
import { useEditorStore } from './store.js';
import {
  canApplyGitHubPreset,
  githubEventCheck,
  makeGitHubTriggerPreset,
} from './trigger-presets.js';

const setup = {
  owner: 'octo-team',
  repository: 'service',
  label: 'ready',
  baseBranch: 'main',
  secretRef: 'hook',
};
const presets = ['issues-labeled', 'pull-request-ready', 'pull-request-merged'] as const;
const payload = (preset: (typeof presets)[number]): JsonValue => ({
  repository: { full_name: 'octo-team/service' },
  action:
    preset === 'issues-labeled' ? 'labeled' : preset === 'pull-request-ready' ? 'opened' : 'closed',
  ...(preset === 'issues-labeled'
    ? { issue: { number: 1 }, label: { name: setup.label } }
    : {
        pull_request: {
          draft: false,
          merged: preset === 'pull-request-merged',
          base: { ref: setup.baseBranch },
        },
      }),
});
const store = () => useEditorStore.getState();

describe('editable GitHub fragments', () => {
  it.each(presets)(
    'builds and validates %s with terminal ignore and unchanged successor identity',
    (preset) => {
      const source = newLoopDefinition(preset);
      source.nodes[0]!.config = triggerConfig('webhook', {
        authentication: { type: 'hmac-sha256', message: 'body', secretRef: 'old' },
        filter: 'false',
      });
      source.edges[0]!.ui = { route: [200] };
      const preview = previewGitHubPreset(source, 'start', preset, setup);
      const parsed = LoopDefinitionSchema.parse(preview.definition);
      expect(validateLoop(parsed)).toEqual([]);
      expect(preview.issues).toEqual([]);
      expect(preview.fields).toContain('filter');
      expect(parsed.nodes[0]!.config).not.toHaveProperty('filter');
      expect(preview.addedNodes.map((node) => node.kind)).toEqual(['decision', 'mutate', 'exit']);
      expect(preview.addedNodes[0]!.config).toMatchObject({
        kind: 'expression',
        routes: [
          { id: 'pass', label: 'Continue' },
          { id: 'ignore', label: 'Ignore' },
        ],
      });
      expect(preview.addedNodes[2]!.config).toEqual({
        outcome: 'success',
        returns: 'none',
        destinations: [],
      });
      expect(preview.addedEdges.map((edge) => edge.from.port)).toEqual(['out', 'pass', 'ignore']);
      expect(preview.rewiredEdges).toEqual([
        { ...source.edges[0], from: { node: 'restore-output', port: 'out' } },
      ]);
      expect(source.nodes).toHaveLength(2);
    },
  );

  it.each(presets)('ports every signed-body predicate for %s', async (preset) => {
    const expression = githubEventCheck(preset, setup);
    const original = payload(preset) as Record<string, JsonValue>;
    const route = (body: JsonValue) =>
      evaluateExpression(expression, { invocation: { trigger: { payload: body } } });
    expect(await route(original)).toBe('pass');
    for (const changed of [
      { ...original, repository: { full_name: 'other/service' } },
      { ...original, action: 'ping' },
      { ...original, issue: undefined, pull_request: undefined },
      preset === 'issues-labeled'
        ? { ...original, label: { name: 'other' } }
        : {
            ...original,
            pull_request: { draft: false, merged: true, base: { ref: 'other' } },
          },
      preset === 'issues-labeled'
        ? { ...original, issue: { pull_request: {} } }
        : {
            ...original,
            pull_request: { draft: true, merged: false, base: { ref: 'main' } },
          },
    ])
      expect(await route(JSON.parse(JSON.stringify(changed)) as JsonValue)).toBe('ignore');
    if (preset === 'pull-request-ready')
      expect(await route({ ...original, action: 'ready_for_review' })).toBe('pass');
    if (preset === 'pull-request-merged')
      expect(
        await route({
          ...original,
          pull_request: {
            merged: false,
            base: { ref: 'main' },
          },
        }),
      ).toBe('ignore');
    expect(await route(null)).toBe('ignore');
  });

  it.each(presets)('quotes quotes, backslashes, newlines and Unicode for %s', async (preset) => {
    const literal = 'ready "now" \\ path\n日本語 🦇';
    const expression = githubEventCheck(preset, { ...setup, label: literal, baseBranch: literal });
    const body = payload(preset) as Record<string, JsonValue>;
    const changed =
      preset === 'issues-labeled'
        ? { ...body, label: { name: literal } }
        : {
            ...body,
            pull_request: { draft: false, merged: true, base: { ref: literal } },
          };
    expect(
      await evaluateExpression(expression, { invocation: { trigger: { payload: changed } } }),
    ).toBe('pass');
  });

  it('avoids node and edge collisions and card overlaps', () => {
    const source = newLoopDefinition('collisions');
    for (const id of ['event-check', 'event-check-2', 'restore-output', 'quiet-exit'])
      source.nodes.push({
        id,
        kind: 'mutate',
        label: id,
        config: {
          operations: [{ op: 'set', path: '/vars/x', value: { kind: 'literal', value: 1 } }],
        },
        ui: { x: 286, y: 80 },
      });
    const chain = ['start', 'event-check', 'event-check-2', 'restore-output', 'quiet-exit', 'done'];
    source.edges = chain.slice(1).map((to, i) => ({
      id: i === 0 ? 'e6' : `c${i}`,
      from: { node: chain[i]!, port: 'out' },
      to: { node: to },
    }));
    const preview = previewGitHubPreset(source, 'start', 'issues-labeled', setup);
    expect(preview.addedNodes.map((node) => node.id)).toEqual([
      'event-check-3',
      'restore-output-2',
      'quiet-exit-2',
    ]);
    expect(preview.addedNodes[0]!.ui!.y).toBeGreaterThan(80);
    expect(new Set(preview.definition.edges.map((edge) => edge.id)).size).toBe(
      preview.definition.edges.length,
    );
    expect(preview.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it.each([0, 1, 3])(
    'rewires all %i successors and reports existing contract constraints',
    (count) => {
      const source = newLoopDefinition('edges');
      source.edges = Array.from({ length: count }, (_, i) => ({
        id: `edge-${i}`,
        from: { node: 'start', port: 'out' },
        to: { node: 'done', port: 'in' },
      }));
      const preview = previewGitHubPreset(source, 'start', 'issues-labeled', setup);
      expect(preview.rewiredEdges).toHaveLength(count);
      expect(preview.rewiredEdges.map((edge) => edge.id)).toEqual(
        source.edges.map((edge) => edge.id),
      );
      expect(preview.issues.some((issue) => issue.severity === 'error')).toBe(count !== 1);
    },
  );

  it('applies atomically with held input, undo and redo; cancel is read-only', () => {
    const source = newLoopDefinition('history');
    store().load('loop', source);
    store().setFieldError('node:start', 'inputSchema', { message: 'invalid', text: '{unfinished' });
    const before = store();
    const preview = previewGitHubPreset(source, 'start', 'issues-labeled', setup);
    // Preview/cancel has no store writes.
    expect(store()).toBe(before);
    expect(store().applyGitHubPreset(preview, before)).toBeUndefined();
    const applied = store().definition;
    expect(store().past).toHaveLength(before.past.length + 1);
    expect(store().fieldErrors).toEqual({});
    store().undo();
    expect(store().definition).toBe(source);
    expect(store().fieldErrors).toBe(before.fieldErrors);
    store().redo();
    expect(store().definition).toBe(applied);
    expect(store().fieldErrors).toEqual({});
  });

  it.each(['definition', 'fieldErrors', 'historyEpoch', 'generation'] as const)(
    'refuses a stale %s',
    (key) => {
      store().load('loop', newLoopDefinition('stale'));
      const before = store();
      const preview = previewGitHubPreset(before.definition!, 'start', 'issues-labeled', setup);
      if (key === 'definition') store().updateMeta({ name: 'changed' });
      if (key === 'fieldErrors')
        store().setFieldError('node:start', 'x', { message: 'held', text: '{' });
      if (key === 'historyEpoch') {
        store().updateMeta({ name: 'changed' });
        store().undo();
      }
      if (key === 'generation') store().load('another', before.definition!);
      const current = store();
      expect(store().applyGitHubPreset(preview, before)).toContain('draft changed');
      expect(store()).toBe(current);
    },
  );

  it('previews replacement of owner edits, including held inputs, and undo restores them', () => {
    const initial = previewGitHubPreset(
      newLoopDefinition('replace'),
      'start',
      'issues-labeled',
      setup,
    ).definition;
    store().load('loop', initial);
    store().updateNode('event-check', {
      label: 'Owner check',
      config: {
        kind: 'expression',
        jsonata: '"ignore"',
        routes: [
          { id: 'pass', label: 'Go' },
          { id: 'ignore', label: 'Stop' },
        ],
      },
    });
    store().setFieldError('node:event-check', 'jsonata', { text: 'unfinished', message: 'held' });
    const before = store();
    const preview = previewGitHubPreset(before.definition!, 'start', 'pull-request-ready', setup);
    expect(preview.removedNodes).toHaveLength(3);
    expect(preview.removedNodes[0]!.label).toBe('Owner check');
    expect(preview.removedEdges).toHaveLength(3);
    expect(preview.rewiredEdges[0]!.id).toBe('e1');
    expect(validateLoop(LoopDefinitionSchema.parse(preview.definition))).toEqual([]);
    store().applyGitHubPreset(preview, before);
    expect(store().fieldErrors).toEqual({});
    expect(store().definition!.nodes).toHaveLength(5);
    store().undo();
    expect(store().definition).toBe(before.definition);
    expect(store().fieldErrors).toBe(before.fieldErrors);
  });

  it.each(presets)(
    'removes an edited %s fragment for poll and reconnects in one undo step',
    (preset) => {
      const source = newLoopDefinition('webhook to poll');
      source.edges[0]!.ui = { route: [200] };
      const initial = previewGitHubPreset(source, 'start', preset, setup).definition;
      store().load('loop', initial);
      store().updateNode('event-check', { label: 'Owner edited check' });
      store().setFieldError('node:event-check', 'jsonata', { text: 'unfinished', message: 'held' });
      const before = store();
      const preview = previewGitHubPreset(before.definition!, 'start', 'issues-poll', setup);
      expect(preview.removedNodes.map((node) => node.id)).toEqual([
        'event-check',
        'restore-output',
        'quiet-exit',
      ]);
      expect(preview.removedNodes[0]!.label).toBe('Owner edited check');
      expect(preview.removedEdges).toHaveLength(3);
      expect(preview.addedNodes).toEqual([]);
      expect(preview.addedEdges).toEqual([]);
      expect(preview.rewiredEdges).toEqual(source.edges);
      expect(preview.definition).toEqual({
        ...source,
        nodes: source.nodes.map((node) =>
          node.id === 'start'
            ? { ...node, config: makeGitHubTriggerPreset('issues-poll', setup) }
            : node,
        ),
      });
      expect(validateLoop(LoopDefinitionSchema.parse(preview.definition))).toEqual([]);
      expect(preview.issues).toEqual([]);
      expect(store()).toBe(before);
      expect(store().applyGitHubPreset(preview, before)).toBeUndefined();
      expect(store().past).toHaveLength(before.past.length + 1);
      expect(store().fieldErrors).toEqual({});
      const applied = store().definition;
      store().undo();
      expect(store().definition).toBe(before.definition);
      expect(store().fieldErrors).toBe(before.fieldErrors);
      store().redo();
      expect(store().definition).toBe(applied);
      expect(store().fieldErrors).toEqual({});
    },
  );

  it.each(['unrecognized', 'ambiguous', 'nested'] as const)(
    'warns and preserves a %s downstream check when applying poll',
    (shape) => {
      const source = previewGitHubPreset(
        newLoopDefinition('retained check'),
        'start',
        'issues-labeled',
        setup,
      ).definition;
      const check = source.nodes.find((node) => node.id === 'event-check')!;
      if (check.kind !== 'decision' || check.config.kind !== 'expression')
        throw new Error('Missing check');
      if (shape === 'unrecognized') {
        check.config.routes[0]!.id = 'continue';
        source.edges.find(
          (edge) => edge.from.node === check.id && edge.from.port === 'pass',
        )!.from.port = 'continue';
      } else if (shape === 'ambiguous') {
        check.config.routes.push({ id: 'extra', label: 'Extra' });
        source.edges.push({
          id: 'extra',
          from: { node: check.id, port: 'extra' },
          to: { node: 'done' },
        });
      } else {
        source.nodes.push({
          id: 'preface',
          kind: 'mutate',
          label: 'Preface',
          config: {
            operations: [{ op: 'set', path: '/vars/x', value: { kind: 'literal', value: true } }],
          },
        });
        source.edges.find((edge) => edge.from.node === 'start')!.to.node = 'preface';
        source.edges.push({
          id: 'preface',
          from: { node: 'preface', port: 'out' },
          to: { node: check.id },
        });
      }
      store().load('loop', source);
      const before = store();
      const preview = previewGitHubPreset(source, 'start', 'issues-poll', setup);
      expect(preview.removedNodes).toEqual([]);
      expect(preview.removedEdges).toEqual([]);
      expect(preview.rewiredEdges).toEqual([]);
      expect(preview.definition.edges).toEqual(source.edges);
      expect(preview.definition.nodes.slice(1)).toEqual(source.nodes.slice(1));
      expect(validateLoop(LoopDefinitionSchema.parse(preview.definition))).toEqual([]);
      expect(preview.issues).toMatchObject([
        { code: 'POLL_RETAINS_DOWNSTREAM_CHECK', severity: 'warning' },
      ]);
      expect(store().applyGitHubPreset(preview, before)).toBeUndefined();
      expect(store().past).toHaveLength(1);
      store().undo();
      expect(store().definition).toBe(source);
    },
  );

  it('retains ambiguous/shared downstream graphs and leaves the poll recipe alone', () => {
    const first = previewGitHubPreset(
      newLoopDefinition('shared'),
      'start',
      'issues-labeled',
      setup,
    ).definition;
    first.nodes.push({
      id: 'shared-start',
      kind: 'trigger',
      label: 'Shared start',
      config: manualTriggerConfig(),
    });
    first.edges.push({
      id: 'shared',
      from: { node: 'shared-start', port: 'out' },
      to: { node: 'restore-output' },
    });
    const again = previewGitHubPreset(first, 'start', 'issues-labeled', setup);
    expect(again.removedNodes).toEqual([]);
    expect(again.definition.nodes).toHaveLength(9);
    expect(validateLoop(LoopDefinitionSchema.parse(again.definition))).toEqual([]);
    const poll = previewGitHubPreset(first, 'start', 'issues-poll', setup);
    expect(poll.addedNodes).toEqual([]);
    expect(poll.definition.edges).toEqual(first.edges);
    expect(poll.removedNodes).toEqual([]);
    expect(poll.issues).toMatchObject([
      { code: 'POLL_RETAINS_DOWNSTREAM_CHECK', severity: 'warning' },
    ]);
    store().load('loop', first);
    const before = store();
    expect(store().applyGitHubPreset(poll, before)).toBeUndefined();
    expect(store().past).toHaveLength(1);
    store().undo();
    expect(store().definition).toBe(first);
    expect(() => previewGitHubPreset(first, 'missing', 'issues-labeled', setup)).toThrow(
      'no longer exists',
    );
  });

  it('refuses limits and invalid graphs without making an undo step', () => {
    const source = newLoopDefinition('limits');
    source.nodes.push(
      ...Array.from({ length: 496 }, (_, i) => ({
        id: `exit-${i}`,
        kind: 'exit' as const,
        label: 'Exit',
        config: {},
      })),
    );
    store().load('loop', source);
    const before = store();
    const preview = previewGitHubPreset(source, 'start', 'issues-labeled', setup);
    expect(store().applyGitHubPreset(preview, before)).toBeDefined();
    expect(store()).toBe(before);
  });

  it('validates setup bounds and keeps poll configuration unchanged', () => {
    expect(canApplyGitHubPreset('', setup)).toBe(false);
    for (const preset of ['issues-labeled', 'issues-poll'] as const)
      for (const label of ['', 'a'.repeat(256)])
        expect(canApplyGitHubPreset(preset, { ...setup, label })).toBe(false);
    for (const baseBranch of ['', 'a'.repeat(256)])
      expect(canApplyGitHubPreset('pull-request-ready', { ...setup, baseBranch })).toBe(false);
    for (const secretRef of ['', 'a'.repeat(129)])
      expect(canApplyGitHubPreset('issues-labeled', { ...setup, secretRef })).toBe(false);
    expect(makeGitHubTriggerPreset('issues-poll', setup)).toMatchObject({
      type: 'poll',
      intervalSeconds: 60,
    });
  });

  it('does not warn about a check when the existing downstream graph has none', () => {
    const preview = previewGitHubPreset(
      newLoopDefinition('no check'),
      'start',
      'issues-poll',
      setup,
    );
    expect(preview.issues).toEqual([]);
  });
});
