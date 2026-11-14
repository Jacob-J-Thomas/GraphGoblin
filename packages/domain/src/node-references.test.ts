import { describe, expect, it } from 'vitest';
import { LoopDefinitionSchema, type LoopDefinitionInput } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { evaluateExpression, renderTemplate, validateLoop } from './index.js';
import { renameLoopNode } from './index.js';

function returning(returns: string): LoopDefinitionInput {
  const definition = minimalLoop();
  return {
    ...definition,
    nodes: definition.nodes.map((node) =>
      node.kind === 'exit' ? { ...node, config: { ...node.config, returns } } : node,
    ),
  };
}

function referenceIssues(definition: LoopDefinitionInput) {
  return validateLoop(LoopDefinitionSchema.parse(definition)).filter((issue) =>
    issue.code.startsWith('NODE_REFERENCE_'),
  );
}

describe('known node references', () => {
  it('reports known missing local identities and preserves foreign outputs as warnings', () => {
    const issues = referenceIssues(
      returning('[gates.missing.passes, counters.nodeVisits.missing, outputs.parentWork.value]'),
    );
    expect(issues).toEqual([
      expect.objectContaining({
        severity: 'error',
        nodeId: 'done',
        path: 'config.returns',
        message: expect.stringContaining('gates.missing'),
      }),
      expect.objectContaining({
        severity: 'error',
        nodeId: 'done',
        path: 'config.returns',
        message: expect.stringContaining('counters.nodeVisits.missing'),
      }),
      expect.objectContaining({
        severity: 'warning',
        nodeId: 'done',
        path: 'config.returns',
        message: expect.stringContaining('outputs.parentWork'),
      }),
    ]);
  });

  it('allows direct presence probes without making the probed identity mandatory', () => {
    const definition = returning('$exists(gates.missing) ? 1 : 0');
    definition.settings = {
      workingDirectory: {
        kind: 'template',
        template:
          '{% if gates.missing %}/have{% elsif counters.nodeVisits.lost %}/also{% endif %}{% unless gates.other %}/empty{% endunless %}',
      },
    };
    const issues = referenceIssues(definition);
    expect(issues).toHaveLength(4);
    expect(issues.map((issue) => issue.severity)).toEqual(Array(4).fill('warning'));
    expect(referenceIssues(returning('$exists(gates.missing.passes + 1)'))).toMatchObject([
      { severity: 'error' },
    ]);
  });

  it('rewrites structural edges, static JSONata and Liquid together, retaining other bytes', async () => {
    const definition = returning(
      '[outputs.start.value, "outputs.start", {"start": counters.nodeVisits.start}]',
    );
    definition.settings = {
      workingDirectory: {
        kind: 'template',
        template:
          '💡\r\n{% if outputs.start %}{{ outputs["start"].value }}{% endif %} literal start {% raw %}{{ outputs.start }}{% endraw %}',
      },
    };
    const original = structuredClone(definition);
    const result = renameLoopNode(definition, 'start', 'start-new');
    expect(result.kind).toBe('renamed');
    if (result.kind !== 'renamed') throw new Error(result.kind);
    expect(result.definition.nodes.find((node) => node.id === 'start-new')).toBeDefined();
    expect(result.definition.edges[0]?.from.node).toBe('start-new');
    expect(definition).toEqual(original);
    const exit = result.definition.nodes.find((node) => node.kind === 'exit');
    const source = exit?.config.returns;
    expect(source).toContain('"outputs.start"');
    expect(source).toContain('"start":');
    expect(
      await evaluateExpression(source!, {
        outputs: { 'start-new': { value: 'present' } },
        counters: { nodeVisits: { 'start-new': 2 } },
      }),
    ).toEqual(['present', 'outputs.start', { start: 2 }]);
    const directory = result.definition.settings?.workingDirectory;
    if (directory?.kind !== 'template') throw new Error('missing fixture template');
    expect(
      await renderTemplate(directory.template, {
        outputs: { 'start-new': { value: 'present' } },
      }),
    ).toBe('💡\r\npresent literal start {{ outputs.start }}');
    expect(referenceIssues(result.definition)).toEqual([]);
  });
});

describe('reference scopes and source boundaries', () => {
  function renamed(definition: LoopDefinitionInput, next = 'true') {
    const result = renameLoopNode(definition, 'start', next);
    if (result.kind !== 'renamed') throw new Error(result.kind);
    return result;
  }

  function expressionOf(definition: LoopDefinitionInput) {
    return definition.nodes.find((node) => node.kind === 'exit')?.config.returns;
  }

  it.each([
    ['outputs.start.value', 'outputs."true".value'],
    ['$.outputs.start.value', '$.outputs."true".value'],
    ['outputs. "st\\u0061rt".value', 'outputs. "true".value'],
    ["outputs /* start */ . 'start'.value", "outputs /* start */ . 'true'.value"],
    [
      'outputs.' + String.fromCharCode(96) + 'start' + String.fromCharCode(96),
      'outputs.' + String.fromCharCode(96) + 'true' + String.fromCharCode(96),
    ],
    ['rows.($.outputs.start.value)', 'rows.($.outputs.start.value)'],
    ['rows.($$.outputs.start.value)', 'rows.($$.outputs."true".value)'],
    ['rows[$$.outputs.start.value]', 'rows[$$.outputs."true".value]'],
    ['rows[outputs.start.value]', 'rows[outputs.start.value]'],
    ['rows^(outputs.start.value)', 'rows^(outputs.start.value)'],
    ['(function(){outputs.start.value})()', '(function(){outputs."true".value})()'],
    ['rows.(function(){outputs.start.value})()', 'rows.(function(){outputs.start.value})()'],
    ['rows^($$.outputs.start.value)', 'rows^($$.outputs."true".value)'],
    ['$lookup(outputs,"st\\u0061rt").value', '$lookup(outputs,"true").value'],
    [
      '($lookup := function($x,$key){ $key }; $lookup(vars,"start"))',
      '($lookup := function($x,$key){ $key }; $lookup(vars,"start"))',
    ],
    ['($$ := $fixture; $$.outputs.start.value)', '($$ := $fixture; $$.outputs.start.value)'],
    ['trigger.nodeId = "start"', 'trigger.nodeId = "start"'],
    ['outputs.starting.value', 'outputs.starting.value'],
  ])('rewrites only a parsed local reference in %s', (before, after) => {
    expect(expressionOf(renamed(returning(before)).definition)).toBe(after);
  });

  it.each([
    ['$exists(gates.missing.passes)', 'warning'],
    ['gates.missing ~> $exists()', 'warning'],
    ['$exists($lookup(gates,"missing"))', 'warning'],
    ['$exists($lookup(gates,"missing").passes)', 'warning'],
    ['$exists((gates.missing))', 'warning'],
    ['$exists((gates.missing; 1))', 'error'],
    ['($exists := function($x){false}; $exists(gates.missing))', 'error'],
    ['$exists(gates.missing[$which])', 'error'],
    ['gates.missing ~> $exists(gates.other)', 'error'],
    ['gates.missing ? gates.missing.passes : 0', 'error'],
    ['gates.start.passes', 'error'],
    ['counters.nodeVisits.done', undefined],
  ])('classifies the actual identity use in %s', (source, severity) => {
    const issues = referenceIssues(returning(source));
    if (severity === undefined) expect(issues).toEqual([]);
    else expect(issues).toContainEqual(expect.objectContaining({ severity }));
  });

  it('explains dynamic and opaque identity use without editing source, literals or provenance comparisons', () => {
    const source =
      '[$lookup(outputs, vars.key), outputs[$picked], $eval("outputs.start"), trigger.nodeId = "start"]';
    const result = renamed(returning(source));
    expect(expressionOf(result.definition)).toBe(source);
    expect(result.repairedReferences).toBe(1);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'NODE_REFERENCE_UNCERTAIN',
        nodeId: 'done',
        path: 'config.returns',
      }),
    ]);
    expect(referenceIssues(returning('"outputs.start" & "gates.missing"'))).toEqual([]);
  });

  it('identifies the runtime-supplied thread only in signal predicates and heartbeat', () => {
    const before = returning('none');
    before.nodes.push(
      {
        id: 'signal',
        label: 'Signal',
        kind: 'wait',
        config: { mode: 'signal', name: 'ready', filter: 'outputs.start or $thread.outputs.start' },
      },
      {
        id: 'shadow',
        label: 'Shadow',
        kind: 'wait',
        config: {
          mode: 'signal',
          name: 'ready',
          filter: '$map(rows,function($thread){$thread.outputs.start})',
        },
      },
      {
        id: 'pulse',
        label: 'Pulse',
        kind: 'heartbeat',
        config: {
          intervalSeconds: 5,
          until: 'probe.outputs.start or thread.outputs.start',
          probe: {
            kind: 'http',
            url: 'https://test.invalid',
            headers: { 'X.Trace/~': '{{ outputs.start.value }}' },
          },
        },
      },
      {
        id: 'event',
        label: 'Event',
        kind: 'trigger',
        config: { type: 'event', eventType: 'event', dedupeKey: 'outputs.start' },
      },
      {
        id: 'child',
        label: 'Child',
        kind: 'subloop',
        config: {
          loopRef: { loopId: '01ARZ3NDEKTSV4RRFFQ69G5AV' },
          input: { mode: 'project', vars: { arg: 'outputs.start.value' } },
          output: {
            mode: 'custom',
            custom: { patch: 'parent.outputs.start and child.outputs.start ? [] : []' },
            vars: { strategy: 'explicit', map: { childValue: 'outputs.start' } },
          },
        },
      },
    );
    const result = renamed(before, 'changed');
    expect(result.definition.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'signal',
          config: expect.objectContaining({
            filter: 'outputs.start or $thread.outputs.changed',
          }),
        }),
        expect.objectContaining({
          id: 'shadow',
          config: expect.objectContaining({
            filter: '$map(rows,function($thread){$thread.outputs.start})',
          }),
        }),
        expect.objectContaining({
          id: 'pulse',
          config: expect.objectContaining({
            until: 'probe.outputs.start or thread.outputs.changed',
            probe: expect.objectContaining({
              headers: { 'X.Trace/~': '{{ outputs.changed.value }}' },
            }),
          }),
        }),
        expect.objectContaining({
          id: 'event',
          config: expect.objectContaining({ dedupeKey: 'outputs.start' }),
        }),
        expect.objectContaining({
          id: 'child',
          config: expect.objectContaining({
            input: { mode: 'project', vars: { arg: 'outputs.changed.value' } },
            output: expect.objectContaining({
              custom: { patch: 'parent.outputs.changed and child.outputs.start ? [] : []' },
              vars: { strategy: 'explicit', map: { childValue: 'outputs.start' } },
            }),
          }),
        }),
      ]),
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: 'shadow', path: 'config.filter' }),
        expect.objectContaining({ message: expect.stringContaining('generated patches') }),
      ]),
    );
  });

  it('uses typed pointer slots and preserves unrelated decoded segments and arbitrary JSON', () => {
    const definition = returning('outputs.start.value');
    definition.nodes.push({
      id: 'mutate',
      label: 'Mutate',
      kind: 'mutate',
      config: {
        operations: [
          {
            op: 'set',
            path: '/outputs/start/value/a~1b~0c/start',
            value: {
              kind: 'literal',
              value: { path: '/outputs/start/value', start: 'outputs.start' },
            },
          },
          {
            op: 'coerce',
            source: '/counters/nodeVisits/start',
            jsonSchema: {},
            target: '/vars/start',
          },
          { op: 'delete', path: '/vars/start' },
        ],
      },
    });
    const result = renamed(definition, 'fresh-id');
    const mutated = result.definition.nodes.find((node) => node.kind === 'mutate');
    expect(mutated?.config.operations).toMatchObject([
      {
        path: '/outputs/fresh-id/value/a~1b~0c/start',
        value: {
          value: {
            path: '/outputs/start/value',
            start: 'outputs.start',
          },
        },
      },
      { source: '/counters/nodeVisits/fresh-id', target: '/vars/start' },
      { path: '/vars/start' },
    ]);
    expect(result.repairedReferences).toBe(4);
    expect(result.warnings).toEqual([]);
  });

  it.each(['/outputs/start', '/outputs/changed', '/outputs'])(
    'preserves ambiguous output references when an authored operation can own the slot %s',
    (path) => {
      const definition = returning('[outputs.start, counters.nodeVisits.start]');
      definition.nodes.push({
        id: 'mutate',
        kind: 'mutate',
        label: 'Mutate',
        config: {
          operations: [{ op: 'set', path, value: { kind: 'literal', value: {} } }],
        },
      });
      const result = renamed(definition, 'changed');
      expect(expressionOf(result.definition)).toBe('[outputs.start, counters.nodeVisits.changed]');
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          nodeId: 'done',
          path: 'config.returns',
        }),
      );
    },
  );

  it('preserves Liquid locals and dynamic keys while repairing supported filters and escaped keys', async () => {
    const definition = returning('none');
    const before =
      '{{ outputs["st\\u0061rt"].value | default: outputs.start.value }} ' +
      '{% for outputs in vars.items %}{{ outputs.start }}{% endfor %} {{ outputs[vars.key] }}';
    definition.settings = { workingDirectory: { kind: 'template', template: before } };
    let result = renamed(definition, 'node-id');
    expect(result.definition.settings?.workingDirectory).toEqual({
      kind: 'template',
      template: before
        .replace('"st\\u0061rt"', '"node-id"')
        .replace('default: outputs.start', 'default: outputs.node-id'),
    });
    expect(result.warnings).toHaveLength(1);

    const captured =
      '{% if vars.condition %}{% capture outputs %}text{% endcapture %}{% endif %}{{ outputs.start }}';
    definition.settings.workingDirectory = { kind: 'template', template: captured };
    result = renamed(definition, 'node-id');
    expect(result.definition.settings?.workingDirectory).toEqual({
      kind: 'template',
      template: captured,
    });
    expect(result.warnings).toHaveLength(1);
    expect(
      await renderTemplate(captured, { outputs: { start: 42 }, vars: { condition: false } }),
    ).toBe('42');
  });

  it('repairs a typed source in a discriminated editor branch with another invalid field', () => {
    const definition = returning('none');
    definition.nodes.push({
      id: 'wait',
      kind: 'wait',
      label: 'Signal',
      config: { mode: 'signal', name: '', filter: '$thread.counters.nodeVisits.start' },
    });
    const result = renamed(definition, 'changed');
    expect(result.definition.nodes.at(-1)).toMatchObject({
      config: { mode: 'signal', name: '', filter: '$thread.counters.nodeVisits.changed' },
    });
  });

  it('warns on a Liquid loop else which can fall back to a shadowed global', async () => {
    const definition = returning('none');
    const template =
      '{% for outputs in vars.rows %}{{ outputs.start }}{% else %}{{ outputs.start }}{% endfor %}';
    definition.settings = { workingDirectory: { kind: 'template', template } };
    const result = renamed(definition);
    expect(result.definition.settings?.workingDirectory).toEqual({ kind: 'template', template });
    expect(result.warnings).toHaveLength(1);
    expect(
      await renderTemplate(template, { vars: { rows: [] }, outputs: { start: 'global' } }),
    ).toBe('global');
  });

  it('does not treat a dynamic access as a direct Liquid presence probe', () => {
    const definition = returning('none');
    definition.settings = {
      workingDirectory: {
        kind: 'template',
        template: '{% if gates.missing[vars.key] %}yes{% endif %}',
      },
    };
    expect(referenceIssues(definition)).toMatchObject([{ severity: 'error' }]);
  });

  it('returns refusal without mutating invalid identity, and retains syntax issues for malformed source', () => {
    const definition = returning('outputs.start +');
    expect(renameLoopNode(definition, 'absent', 'new')).toEqual({ kind: 'missing-node' });
    expect(renameLoopNode(definition, 'start', 'start')).toEqual({ kind: 'unchanged' });
    expect(renameLoopNode(definition, 'start', 'not valid')).toEqual({ kind: 'invalid-id' });
    expect(renameLoopNode(definition, 'start', 'done')).toEqual({ kind: 'duplicate-id' });
    const result = renamed(definition, 'working');
    expect(result.warnings).toContainEqual(expect.objectContaining({ nodeId: 'done' }));
    expect(validateLoop(LoopDefinitionSchema.parse(result.definition))).toMatchObject([
      { code: 'EXPRESSION_INVALID', severity: 'error' },
    ]);
    definition.nodes.push(definition.nodes[0]!);
    expect(renameLoopNode(definition, 'start', 'new')).toEqual({ kind: 'ambiguous-node' });
  });
});
