import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { minimalLoop, sampleThread } from '@graphgoblin/contracts/testing';
import { applyPatch } from '@graphgoblin/domain';
import { describe, expect, it } from 'vitest';
import { event, TS } from '../__fixtures__/fake-api.js';
import {
  patchDiff,
  describeEvent,
  formatProbability,
  nodeName,
  routeName,
  cancellationSummary,
} from './projections.js';

describe('exact recorded execution projections (#255)', () => {
  it('shows each appended value, including null and nested arrays, independently of the final array', () => {
    const before = sampleThread();
    before.vars = { items: ['already present'] };
    const patch = [
      { op: 'add' as const, path: '/vars/items/-', value: null },
      { op: 'add' as const, path: '/vars/items/-', value: { nested: [1, false, 'α'] } },
      { op: 'add' as const, path: '/vars/items/-', value: ['nested array'] },
    ];
    const after = applyPatch(before, patch);
    expect(patchDiff(before, after, patch).map((line) => line.after)).toEqual([
      null,
      { nested: [1, false, 'α'] },
      ['nested array'],
    ]);
    expect(before.vars['items']).toEqual(['already present']);
  });

  it('shows each append to messages and a variable list as absent before and its recorded value after (#385)', () => {
    const seed = { id: 'm0', role: 'note', content: 'seed', nodeId: 'prep', ts: TS };
    const before = applyPatch(sampleThread(), [
      { op: 'add' as const, path: '/messages/-', value: seed },
      { op: 'add' as const, path: '/vars/list', value: ['seed'] },
    ]);
    const first = { ...seed, id: 'm1', content: 'first appended' };
    const second = { ...seed, id: 'm2', content: 'second appended' };
    const patch = [
      { op: 'add' as const, path: '/messages/-', value: first },
      { op: 'add' as const, path: '/messages/-', value: second },
      { op: 'add' as const, path: '/vars/list/-', value: { nested: [1, ['deep', null]] } },
      { op: 'add' as const, path: '/vars/list/-', value: ['inner', ['array']] },
    ];
    const after = applyPatch(before, patch);
    // A final-array shortcut would show the last message for both appends.
    expect(after.messages.slice(-3).map((message) => message.id)).toEqual(['m0', 'm1', 'm2']);
    expect(patchDiff(before, after, patch)).toEqual([
      { op: 'add', path: '/messages/-', before: undefined, after: first },
      { op: 'add', path: '/messages/-', before: undefined, after: second },
      {
        op: 'add',
        path: '/vars/list/-',
        before: undefined,
        after: { nested: [1, ['deep', null]] },
      },
      { op: 'add', path: '/vars/list/-', before: undefined, after: ['inner', ['array']] },
    ]);
  });

  it('keeps the before and after of the completed patch for operations other than add', () => {
    const before = sampleThread();
    before.vars = { list: ['a', 'b'], name: 'old', object: { '-': 'dash' } };
    const patch = [
      { op: 'replace' as const, path: '/vars/name', value: 'new' },
      { op: 'remove' as const, path: '/vars/list/0' },
      { op: 'replace' as const, path: '/vars/object/-', value: 'replaced dash' },
    ];
    expect(patchDiff(before, applyPatch(before, patch), patch)).toEqual([
      { op: 'replace', path: '/vars/name', before: 'old', after: 'new' },
      { op: 'remove', path: '/vars/list/0', before: 'a', after: 'b' },
      { op: 'replace', path: '/vars/object/-', before: 'dash', after: 'replaced dash' },
    ]);
  });

  it('resolves escaped append parents and keeps an object property named dash literal', () => {
    const before = sampleThread();
    before.vars = { 'a/b~c': [1], object: { '-': 'old' } };
    const patch = [
      { op: 'add' as const, path: '/vars/a~1b~0c/-', value: 2 },
      { op: 'add' as const, path: '/vars/object/-', value: 'new' },
    ];
    expect(patchDiff(before, applyPatch(before, patch), patch).map((line) => line.after)).toEqual([
      2,
      'new',
    ]);
  });

  it('names the pinned node and authored route beside their stable IDs in the timeline', () => {
    const definition = LoopDefinitionSchema.parse({
      ...minimalLoop(),
      nodes: [
        {
          id: 'decide',
          kind: 'decision',
          label: 'Original decision',
          config: {
            kind: 'llm',
            harness: 'codex',
            model: { mode: 'inherit' },
            effort: { mode: 'inherit' },
            instructions: 'Choose',
            routes: [
              { id: 'ship', label: 'Original ship' },
              { id: 'hold', label: 'Original hold' },
            ],
          },
        },
      ],
    });
    const decision = event('run', 1, 'decision.made', {
      nodeId: 'decide',
      portId: 'ship',
      diagnostics: [],
      provenance: {
        kind: 'llm',
        provider: 'codex',
        classifierId: null,
        model: 'model',
        effort: 'high',
      },
      observation: {
        kind: 'route',
        routeId: 'ship',
        confidence: 0.9123456789012345,
        reasoning: null,
      },
    });
    expect(describeEvent(decision, definition)).toContain('Original ship (ship)');
    expect(describeEvent(decision, definition)).toContain('91.23%');
    expect(
      describeEvent(
        event('run', 2, 'node.started', {
          nodeId: 'decide',
          kind: 'decision',
          attempt: 1,
          configHash: 'x',
        }),
        definition,
      ),
    ).toContain('Original decision (decide)');
  });
});

describe('probabilities, labels and lifecycle evidence (#255)', () => {
  it.each([
    [null, 'Not recorded'],
    [0, '0%'],
    [1, '100%'],
    [0.8765432109876543, '87.65%'],
    [0.000001, '<0.01%'],
    [0.999999, '>99.99%'],
    [0.0001, '0.01%'],
    [0.9999, '99.99%'],
  ] as const)(
    'formats %s without pretending a tiny probability is zero or one',
    (value, expected) => {
      expect(formatProbability(value)).toBe(expected);
    },
  );
  it('labels unavailable nodes and routes without inventing authored names', () => {
    const definition = LoopDefinitionSchema.parse(minimalLoop());
    expect(nodeName(undefined, 'gone')).toBe('gone');
    expect(nodeName(definition, 'gone')).toBe('gone (label not recorded)');
    expect(nodeName(definition, definition.nodes[0]!.id)).toContain(definition.nodes[0]!.label);
    expect(routeName(definition, 'gone', 'route')).toBe('route');
    const gate = LoopDefinitionSchema.parse({
      ...definition,
      nodes: [
        {
          id: 'gate',
          kind: 'decision',
          label: 'Gate',
          config: {
            kind: 'expression',
            jsonata: '"yes"',
            routes: [
              { id: 'yes', label: 'Yes' },
              { id: 'no', label: 'No' },
            ],
          },
        },
      ],
    });
    expect(routeName(gate, 'gate', 'missing')).toBe('missing (label not recorded)');
    expect(routeName(gate, 'gate', 'limit-reached')).toBe('Limit reached (limit-reached)');
  });
  it.each(['user', 'system', 'run'] as const)(
    'uses only the recorded %s cancellation request before its terminal event',
    (kind) => {
      const events = [
        event('run', 1, 'run.cancel_requested', { actor: { kind, id: 'recorded-actor' } }),
        event('run', 2, 'run.cancelled', {}),
        event('run', 3, 'run.cancel_requested', { actor: { kind: 'user', id: 'later' } }),
      ];
      expect(cancellationSummary(events)).toBe(
        'Cancelled by ' + kind + ' recorded-actor (request #1; cancellation #2).',
      );
      expect(cancellationSummary(events.slice(0, 1))).toBeUndefined();
      expect(cancellationSummary([events[1]!])).toBe('Cancelled; actor not recorded.');
    },
  );
  it('retains distinct provider and deadline failures rather than calling either cancellation', () => {
    for (const code of ['HARNESS_TRANSPORT_FAILED', 'RUN_DEADLINE_EXCEEDED'] as const) {
      const failure = event('run', 1, 'run.failed', {
        failure: { code, message: 'Exact recorded cause', resumable: false },
      });
      expect(describeEvent(failure)).toBe(code + ': Exact recorded cause');
      expect(cancellationSummary([failure])).toBeUndefined();
    }
  });
});

it('does not attribute a later cancellation to a request from before resume (#255)', () => {
  expect(
    cancellationSummary([
      event('run', 1, 'run.cancel_requested', { actor: { kind: 'user', id: 'earlier' } }),
      event('run', 2, 'run.resumed', { actor: { kind: 'user', id: 'resumer' } }),
      event('run', 3, 'run.cancelled', {}),
    ]),
  ).toBe('Cancelled; actor not recorded.');
});
