import { describe, expect, it, vi } from 'vitest';
import {
  CURRENT_DEFINITION_FORMAT,
  LoopDefinitionSchema,
  NodeConfigSchemas,
  type LoopDefinition,
  type LoopDefinitionInput,
} from '@graphgoblin/contracts';
import { kitchenSinkLoop } from '@graphgoblin/contracts/testing';
import { validateLoop } from './graph.js';
import { authoredFields, findAuthoredSources } from './syntax.js';
import * as template from './template.js';

function loop(nodes: LoopDefinitionInput['nodes'], settings?: LoopDefinitionInput['settings']) {
  return LoopDefinitionSchema.parse({
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name: 'syntax',
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      ...nodes,
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges: [],
    ...(settings ? { settings } : {}),
  });
}

const SOURCE_CODES: ReadonlySet<string> = new Set(['TEMPLATE_INVALID', 'EXPRESSION_INVALID']);

/** Graph validation's diagnostics for authored sources, apart from every other issue. */
function sourceDiagnostics(def: LoopDefinition) {
  return validateLoop(def).filter((issue) => SOURCE_CODES.has(issue.code));
}

/** The parser's own words after a diagnostic's location. */
const problem = (message: string) => message.slice(message.indexOf(': ') + 2);

describe('authored source diagnostics in graph validation', () => {
  it.each(['', ' '])('allows empty and whitespace required templates (%j)', (source) => {
    const def = loop([
      {
        id: 'run',
        kind: 'script',
        label: 'Run',
        config: { command: 'cut', args: ['-d', source, '-f1'] },
      },
      { id: 'ask', kind: 'inference', label: 'Ask', config: { prompt: { template: source } } },
      {
        id: 'beat',
        kind: 'heartbeat',
        label: 'Beat',
        config: {
          intervalSeconds: 5,
          maxBeats: 1,
          probe: { kind: 'http', url: 'https://example.com', headers: { Empty: source } },
        },
      },
      {
        id: 'note',
        kind: 'mutate',
        label: 'Note',
        config: {
          operations: [
            { op: 'set', path: '/vars/value', value: { kind: 'template', template: source } },
            { op: 'append-message', role: 'note', content: source },
          ],
        },
      },
    ]);
    expect(sourceDiagnostics(def)).toEqual([]);
  });

  it('rejects a whitespace required expression with an expression-specific message', () => {
    const def = loop([
      {
        id: 'note',
        kind: 'mutate',
        label: 'Note',
        config: {
          operations: [
            { op: 'set', path: '/vars/value', value: { kind: 'expression', jsonata: ' ' } },
          ],
        },
      },
    ]);
    expect(sourceDiagnostics(def)).toEqual([
      {
        code: 'EXPRESSION_INVALID',
        severity: 'error',
        message:
          'expression at node "note" operations.0.value.jsonata: ' +
          'expression is required; a blank expression is not valid',
        nodeId: 'note',
        path: 'config.operations.0.value.jsonata',
      },
    ]);
  });

  it.each([' ', '\t\n', ' '])(
    'rejects blank expressions before execution (%j), without changing contracts parsing',
    (source) => {
      const def = loop([
        {
          id: 'beat',
          kind: 'heartbeat',
          label: 'Beat',
          config: { intervalSeconds: 5, until: source },
        },
        { id: 'ask', kind: 'inference', label: 'Ask', config: { prompt: { template: source } } },
      ]);
      expect(sourceDiagnostics(def)).toEqual([
        {
          code: 'EXPRESSION_INVALID',
          severity: 'error',
          message:
            'expression at node "beat" until: ' +
            'expression is required; a blank expression is not valid',
          nodeId: 'beat',
          path: 'config.until',
        },
      ]);
    },
  );

  it('finds no problems in the kitchen-sink loop', () => {
    const def = LoopDefinitionSchema.parse(kitchenSinkLoop());
    expect(sourceDiagnostics(def)).toEqual([]);
  });

  it('reports templates and expressions that do not parse, wherever they are nested', () => {
    const def = loop(
      [
        {
          id: 'ask',
          kind: 'inference',
          label: 'Ask',
          config: { prompt: { template: 'Hi {% if x %}' } },
        },
        {
          id: 'pick-question',
          kind: 'decision',
          label: 'Question',
          config: {
            kind: 'classifier',
            model: 'jev',
            question: '{{ broken',
            answer: {
              type: 'choice',
              options: [
                { id: 'a', label: 'A', criteria: 'A' },
                { id: 'b', label: 'B', criteria: 'B' },
              ],
            },
          },
        },
        {
          id: 'pick',
          kind: 'decision',
          label: 'Pick',
          config: {
            kind: 'expression',
            jsonata: '1 +',
            routes: [
              { id: 'a', label: 'a', criteria: 'A' },
              { id: 'b', label: 'b', criteria: 'B' },
            ].map(({ id, label }) => ({ id, label })),
          },
        },
        {
          id: 'run',
          kind: 'script',
          label: 'Run',
          config: { command: 'node', args: ['ok', '{{ broken'] },
        },
        {
          id: 'sub',
          kind: 'subloop',
          label: 'Sub',
          config: {
            loopRef: { loopId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
            input: { mode: 'project', vars: { a: '$x(' } },
          },
        },
        {
          id: 'note',
          kind: 'mutate',
          label: 'Note',
          config: { operations: [{ op: 'append-message', role: 'note', content: '{{' }] },
        },
      ],
      { workingDirectory: { kind: 'template', template: '{% endif %}' } },
    );
    const issues = sourceDiagnostics(def);
    expect(issues.map((i) => [i.code, i.nodeId])).toEqual([
      ['TEMPLATE_INVALID', undefined],
      ['TEMPLATE_INVALID', 'ask'],
      ['TEMPLATE_INVALID', 'pick-question'],
      ['EXPRESSION_INVALID', 'pick'],
      ['TEMPLATE_INVALID', 'run'],
      ['EXPRESSION_INVALID', 'sub'],
      ['TEMPLATE_INVALID', 'note'],
    ]);
    // Each blocks publication.
    expect(issues.map((i) => i.severity)).toEqual(Array(7).fill('error'));
    expect(issues[0]).not.toHaveProperty('nodeId');
    expect(issues[1]?.message).toMatch(/^template at node "ask" prompt\.template: /);
    // Each names its field, so the editor can count and focus it.
    expect(issues.map((i) => i.path)).toEqual([
      'settings.workingDirectory.template',
      'config.prompt.template',
      'config.question',
      'config.jsonata',
      'config.args.1',
      'config.input.vars.a',
      'config.operations.0.content',
    ]);
    expect(issues[0]?.message).toMatch(/^template at loop settings workingDirectory\.template: /);
    expect(issues[4]?.message).toMatch(/^template at node "run" args\.1: /);
    expect(issues[5]?.message).toMatch(/^expression at node "sub" input\.vars\.a: /);
  });

  it('reads the branch each discriminant selects, at its nested path, also beside an invalid sibling', () => {
    const def = loop([
      {
        id: 'wait',
        kind: 'wait',
        label: 'Wait',
        config: { mode: 'signal', name: 'ready', filter: '1 +' },
      },
      {
        id: 'beat',
        kind: 'heartbeat',
        label: 'Beat',
        config: {
          intervalSeconds: 5,
          maxBeats: 1,
          probe: {
            kind: 'http',
            url: 'https://example.com/{{',
            headers: { Fine: '{{ vars.token }}', Trace: '{% endif %}' },
          },
          until: 'probe.status = 200',
        },
      },
      {
        id: 'note',
        kind: 'mutate',
        label: 'Note',
        config: {
          operations: [
            { op: 'append-message', role: 'note', content: 'Fine {{ vars.value }}' },
            { op: 'set', path: '/vars/value', value: { kind: 'template', template: '{{' } },
            { op: 'set', path: '/vars/other', value: { kind: 'expression', jsonata: '$x(' } },
            { op: 'set', path: '/vars/fine', value: { kind: 'expression', jsonata: 'vars.value' } },
          ],
        },
      },
    ]);
    const located = () =>
      sourceDiagnostics(def).map(({ code, nodeId, path, message }) => [
        code,
        nodeId,
        path,
        message.slice(0, message.indexOf(': ')),
      ]);
    const expected = [
      ['EXPRESSION_INVALID', 'wait', 'config.filter', 'expression at node "wait" filter'],
      ['TEMPLATE_INVALID', 'beat', 'config.probe.url', 'template at node "beat" probe.url'],
      [
        'TEMPLATE_INVALID',
        'beat',
        'config.probe.headers.Trace',
        'template at node "beat" probe.headers.Trace',
      ],
      [
        'TEMPLATE_INVALID',
        'note',
        'config.operations.1.value.template',
        'template at node "note" operations.1.value.template',
      ],
      [
        'EXPRESSION_INVALID',
        'note',
        'config.operations.2.value.jsonata',
        'expression at node "note" operations.2.value.jsonata',
      ],
    ];
    expect(located()).toEqual(expected);

    // A draft can hold a sibling that does not parse yet. The discriminant alone still selects
    // the branch, so its typed source is neither hidden nor moved.
    const wait = def.nodes.find((node) => node.id === 'wait');
    if (wait?.kind !== 'wait' || wait.config.mode !== 'signal') throw new Error('missing wait');
    wait.config.name = '';
    expect(LoopDefinitionSchema.safeParse(def).success).toBe(false);
    expect(located()).toEqual(expected);
  });

  it('analyzes an unchanged source once and reports it at each place it appears', () => {
    const parse = vi.spyOn(template, 'parseAuthoredTemplate');
    try {
      const source = 'Cache identity {% if unclosed %}';
      const def = loop(
        [{ id: 'ask', kind: 'inference', label: 'Ask', config: { prompt: { template: source } } }],
        { workingDirectory: { kind: 'template', template: source } },
      );
      const first = sourceDiagnostics(def);
      expect(first.map(({ code, nodeId, path }) => [code, nodeId, path])).toEqual([
        ['TEMPLATE_INVALID', undefined, 'settings.workingDirectory.template'],
        ['TEMPLATE_INVALID', 'ask', 'config.prompt.template'],
      ]);
      expect(parse).toHaveBeenCalledTimes(1);
      expect(problem(first[1]!.message)).toBe(problem(first[0]!.message));

      // Validating an equal draft again reuses the facts and gives the same diagnostics.
      expect(sourceDiagnostics(structuredClone(def))).toEqual(first);
      expect(parse).toHaveBeenCalledTimes(1);
    } finally {
      parse.mockRestore();
    }
  });

  it('reports one problem for a source in fields with different reference scopes', () => {
    const source = '$cacheScope(';
    const def = loop([
      {
        id: 'hook',
        kind: 'trigger',
        label: 'Hook',
        config: { type: 'event', eventType: 'work', dedupeKey: source },
      },
      {
        id: 'beat',
        kind: 'heartbeat',
        label: 'Beat',
        config: { intervalSeconds: 5, until: source },
      },
      {
        id: 'note',
        kind: 'mutate',
        label: 'Note',
        config: { operations: [{ op: 'drop', target: 'messages', where: source }] },
      },
    ]);
    const issues = sourceDiagnostics(def);
    // A trigger's source has no reference scope; the others have their own.
    expect(issues.map(({ code, nodeId, path }) => [code, nodeId, path])).toEqual([
      ['EXPRESSION_INVALID', 'hook', 'config.dedupeKey'],
      ['EXPRESSION_INVALID', 'beat', 'config.until'],
      ['EXPRESSION_INVALID', 'note', 'config.operations.0.where'],
    ]);
    expect(new Set(issues.map(({ message }) => problem(message))).size).toBe(1);
  });
});

describe('the authored field walker that validation and renaming share', () => {
  it.each([
    [
      'an invalid sibling',
      { mode: 'signal', name: '', filter: '1 +' },
      [{ kind: 'expression', source: '1 +', segments: ['filter'] }],
    ],
    [
      'an invalid sibling in another branch',
      { mode: 'input', prompt: '{{', exposeTo: [] },
      [{ kind: 'template', source: '{{', segments: ['prompt'] }],
    ],
    ['an unknown discriminant', { mode: 'later', name: 'ready', filter: '1 +' }, []],
    ['a discriminant of another type', { mode: 1, name: 'ready', filter: '1 +' }, []],
    ['no discriminant', { name: 'ready', filter: '1 +', prompt: '{{' }, []],
  ])('selects a branch by its discriminant alone, given %s', (_, config, found) => {
    expect(authoredFields(NodeConfigSchemas.wait, config)).toEqual(found);
  });
});

describe('authored source discovery', () => {
  it('skips absent values and union branches that do not match', () => {
    expect(findAuthoredSources(NodeConfigSchemas.exit, null)).toEqual([]);
    expect(
      findAuthoredSources(NodeConfigSchemas.exit, {
        returns: 'none',
        destinations: [],
      }),
    ).toEqual([]);
    expect(findAuthoredSources(NodeConfigSchemas.exit, { returns: '$.a' })).toEqual([
      { kind: 'expression', source: '$.a', path: 'returns' },
    ]);
    expect(findAuthoredSources(NodeConfigSchemas.exit, { returns: 42 })).toEqual([]);
  });
});
