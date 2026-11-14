import { describe, expect, it } from 'vitest';
import { LoopDefinitionSchema, type LoopDefinitionInput } from '@graphgoblin/contracts';
import { everyFieldLoop, FIXTURE_IDS, minimalLoop } from '@graphgoblin/contracts/testing';
import { evaluateExpression, isPublishable, renderTemplate, validateLoop } from './index.js';
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

  it.each([
    [
      '$lookup(outputs, outputs./* key source */start.value).value',
      '$lookup(outputs, outputs./* key source */"true".value).value',
      'chosen',
    ],
    [
      'rows[$lookup($$.outputs, outputs.start.value & $$.outputs.start.value).value = "chosen"].id',
      'rows[$lookup($$.outputs, outputs.start.value & $$.outputs."true".value).value = "chosen"].id',
      2,
    ],
  ] as const)(
    'repairs nested thread references in a computed lookup key %s',
    async (before, after, value) => {
      const rows = [
        { id: 1, outputs: { start: { value: 'a-' } } },
        { id: 2, outputs: { start: { value: 'b-' } } },
      ];
      const outputs = { choice: { value: 'chosen' }, 'b-choice': { value: 'chosen' } };
      const result = renamed(returning(before));
      const expression = expressionOf(result.definition);
      expect(expression).toBe(after);
      expect(result.repairedReferences).toBe(2);
      expect(result.warnings).toMatchObject([
        { code: 'NODE_REFERENCE_UNCERTAIN', nodeId: 'done', path: 'config.returns' },
      ]);
      expect(
        await evaluateExpression(before, {
          rows,
          outputs: { ...outputs, start: { value: 'choice' } },
        }),
      ).toBe(value);
      expect(
        await evaluateExpression(expression!, {
          rows,
          outputs: { ...outputs, true: { value: 'choice' } },
        }),
      ).toBe(value);
    },
  );

  it.each([
    ['$lookup(outputs, $string(counters.nodeVisits.missing))', 'counters.nodeVisits.missing'],
    ['$exists($lookup(outputs, gates.missing.passes))', 'gates.missing'],
    ['$lookup(outputs, "start"[$$.gates.missing])', 'gates.missing'],
  ])('blocks publication for a required read inside a lookup key %s', (source, key) => {
    const definition = returning(source);
    expect(isPublishable(LoopDefinitionSchema.parse(definition))).toBe(false);
    expect(referenceIssues(definition)).toMatchObject([
      {
        code: 'NODE_REFERENCE_MISSING',
        severity: 'error',
        nodeId: 'done',
        path: 'config.returns',
        message: expect.stringContaining(key),
      },
      { code: 'NODE_REFERENCE_UNCERTAIN', severity: 'warning' },
    ]);
  });

  it('keeps an explicit presence probe inside a computed lookup key optional', async () => {
    const source = '$lookup(outputs, $exists(gates.missing) ? "start" : "choice").value';
    const definition = returning(source);
    expect(isPublishable(LoopDefinitionSchema.parse(definition))).toBe(true);
    expect(referenceIssues(definition)).toMatchObject([
      {
        code: 'NODE_REFERENCE_OPTIONAL_MISSING',
        severity: 'warning',
        nodeId: 'done',
        path: 'config.returns',
        message: expect.stringContaining('gates.missing'),
      },
      { code: 'NODE_REFERENCE_UNCERTAIN', severity: 'warning' },
    ]);
    const result = renamed(definition);
    expect(expressionOf(result.definition)).toBe(source);
    expect(result.repairedReferences).toBe(1);
    expect(await evaluateExpression(source, { outputs: { choice: { value: 'chosen' } } })).toBe(
      'chosen',
    );
  });

  it('keeps a vars-based lookup key dynamic and non-blocking', async () => {
    const source = '$lookup(outputs, vars.key).value';
    const definition = returning(source);
    expect(isPublishable(LoopDefinitionSchema.parse(definition))).toBe(true);
    expect(referenceIssues(definition)).toMatchObject([
      {
        code: 'NODE_REFERENCE_UNCERTAIN',
        severity: 'warning',
        nodeId: 'done',
        path: 'config.returns',
      },
    ]);
    const result = renamed(definition);
    expect(expressionOf(result.definition)).toBe(source);
    expect(result.repairedReferences).toBe(1);
    expect(
      await evaluateExpression(source, {
        outputs: { start: { value: 'chosen' } },
        vars: { key: 'start' },
      }),
    ).toBe('chosen');
  });

  it.each(['decide', 'classifier-decision'])(
    'uses the message item and $thread in the %s decision selector',
    (id) => {
      const fixture = everyFieldLoop().nodes.find((node) => node.id === id);
      if (fixture?.kind !== 'decision' || fixture.config.kind === 'expression')
        throw new Error('missing decision fixture');
      const before = returning('none');
      const where =
        'outputs.start or gates.local or $$.counters.nodeVisits.local or ' +
        '$thread.outputs.start.value or $thread.gates.missing.passes or $thread.counters.nodeVisits.removed';
      fixture.config.context = { messages: { where } };
      before.nodes.push(fixture);
      before.edges = [
        { id: 'to-decision', from: { node: 'start', port: 'out' }, to: { node: id } },
        { id: 'to-exit', from: { node: id, port: 'good' }, to: { node: 'done' } },
        { id: 'repeat', from: { node: id, port: 'bad' }, to: { node: id } },
        { id: 'at-limit', from: { node: id, port: 'limit-reached' }, to: { node: 'done' } },
      ];
      const result = renamed(before, 'changed');
      expect(result.definition.nodes.at(-1)).toMatchObject({
        config: {
          context: {
            messages: {
              where:
                'outputs.start or gates.local or $$.counters.nodeVisits.local or ' +
                '$thread.outputs.changed.value or $thread.gates.missing.passes or $thread.counters.nodeVisits.removed',
            },
          },
        },
      });
      expect(result.repairedReferences).toBe(2);
      expect(result.warnings).toEqual([]);
      const parsed = LoopDefinitionSchema.parse(result.definition);
      expect(validateLoop(parsed).filter((issue) => issue.severity === 'error')).toEqual(
        ['gates.missing', 'counters.nodeVisits.removed'].map<unknown>((key) =>
          expect.objectContaining({
            code: 'NODE_REFERENCE_MISSING',
            severity: 'error',
            nodeId: id,
            path: 'config.context.messages.where',
            message: expect.stringContaining(key),
          }),
        ),
      );
      expect(isPublishable(parsed)).toBe(false);
    },
  );

  it('uses the parent thread for a child variable named where and binds selectors to their own thread', () => {
    const before = returning('none');
    const selector = { where: 'outputs.start or $thread.outputs.start.value' };
    before.nodes.push({
      id: 'child',
      label: 'Child',
      kind: 'subloop',
      config: {
        loopRef: { loopId: FIXTURE_IDS.childLoop },
        input: {
          mode: 'project',
          vars: { where: 'outputs.start.value or $thread.outputs.start or gates.missing.passes' },
          messages: selector,
          artifacts: selector,
        },
        output: {
          mode: 'merge',
          vars: { strategy: 'explicit', map: { where: 'gates.childGate' } },
          messages: { where: '$thread.outputs.start or $thread.gates.childGate' },
          artifacts: { where: '$thread.outputs.start or $thread.counters.nodeVisits.childOnly' },
        },
      },
    });
    const result = renamed(before, 'changed');
    const selected = { where: 'outputs.start or $thread.outputs.changed.value' };
    expect(result.definition.nodes.at(-1)).toMatchObject({
      config: {
        input: {
          vars: { where: 'outputs.changed.value or $thread.outputs.start or gates.missing.passes' },
          messages: selected,
          artifacts: selected,
        },
        output: {
          vars: { strategy: 'explicit', map: { where: 'gates.childGate' } },
          messages: { where: '$thread.outputs.start or $thread.gates.childGate' },
          artifacts: { where: '$thread.outputs.start or $thread.counters.nodeVisits.childOnly' },
        },
      },
    });
    expect(result.repairedReferences).toBe(4);
    expect(result.warnings).toEqual([]);
    expect(referenceIssues(result.definition)).toEqual([
      expect.objectContaining({
        code: 'NODE_REFERENCE_MISSING',
        severity: 'error',
        nodeId: 'child',
        path: 'config.input.vars.where',
        message: expect.stringContaining('gates.missing'),
      }),
    ]);
  });

  it('preserves item scope in mutate operations and inference transforms', () => {
    const before = returning('none');
    const where = 'outputs.start or $thread.outputs.start.value';
    before.nodes.push(
      {
        id: 'mutate',
        kind: 'mutate',
        label: 'Mutate',
        config: { operations: [{ op: 'drop', target: 'messages', where }] },
      },
      {
        id: 'infer',
        kind: 'inference',
        label: 'Infer',
        config: {
          prompt: { template: '{{ outputs.start.value }}' },
          input: [{ op: 'drop', target: 'messages', where }],
          output: { transforms: [{ op: 'drop', target: 'artifacts', where }] },
        },
      },
    );
    const result = renamed(before, 'changed');
    const predicate = { where: 'outputs.start or $thread.outputs.changed.value' };
    expect(result.definition.nodes.slice(-2)).toMatchObject([
      { config: { operations: [predicate] } },
      {
        config: {
          prompt: { template: '{{ outputs.changed.value }}' },
          input: [predicate],
          output: { transforms: [predicate] },
        },
      },
    ]);
    expect(result.repairedReferences).toBe(5);
    expect(result.warnings).toEqual([]);
    expect(referenceIssues(result.definition)).toEqual([]);
  });

  it.each([
    [
      '$distinct(rows)[id = $$.outputs.start.value].id',
      '$distinct(rows)[id = $$.outputs."true".value].id',
      2,
    ],
    [
      '(rows)[outputs.start.value = $$.outputs.start.value].id',
      '(rows)[outputs.start.value = $$.outputs."true".value].id',
      2,
    ],
    [
      '(rows ~> $distinct())[id = $$.outputs.start.value].id',
      '(rows ~> $distinct())[id = $$.outputs."true".value].id',
      2,
    ],
    [
      'rows.$distinct($)[id = $$.outputs.start.value].id',
      'rows.$distinct($)[id = $$.outputs."true".value].id',
      2,
    ],
    [
      'rows.($distinct($))[id = $$.outputs.start.value].id',
      'rows.($distinct($))[id = $$.outputs."true".value].id',
      2,
    ],
    [
      '$distinct(rows){"k": $$.outputs.start.value, "local": $sum($.outputs.start.value)}',
      '$distinct(rows){"k": $$.outputs."true".value, "local": $sum($.outputs.start.value)}',
      { k: 2, local: 3 },
    ],
    [
      '(rows){"k": $$.outputs.start.value, "local": $sum(outputs.start.value)}',
      '(rows){"k": $$.outputs."true".value, "local": $sum(outputs.start.value)}',
      { k: 2, local: 3 },
    ],
    ['[rows]{"k": $$.outputs.start.value}', '[rows]{"k": $$.outputs."true".value}', { k: 2 }],
    ['rows^(id)[id = $$.outputs.start.value].id', 'rows^(id)[id = $$.outputs."true".value].id', 2],
    [
      '$distinct(rows)[id = ($$.outputs /* keep */ .start.value ?? 0)].id',
      '$distinct(rows)[id = ($$.outputs /* keep */ ."true".value ?? 0)].id',
      2,
    ],
  ] as const)(
    'repairs each evaluated filter or group key once in %s',
    async (before, after, value) => {
      const rows = [
        { id: 1, outputs: { start: { value: 1 } } },
        { id: 2, outputs: { start: { value: 2 } } },
      ];
      const result = renamed(returning(before));
      expect(expressionOf(result.definition)).toBe(after);
      expect(result.repairedReferences).toBe(2);
      expect(result.warnings).toEqual([]);
      expect(await evaluateExpression(before, { rows, outputs: { start: { value: 2 } } })).toEqual(
        value,
      );
      expect(await evaluateExpression(after, { rows, outputs: { true: { value: 2 } } })).toEqual(
        value,
      );
    },
  );

  it.each([
    ['$distinct(rows)[$$.gates.missing.passes > 1]', false, ['gates.missing']],
    [
      '$distinct(rows){"k": $$.counters.nodeVisits.missing}',
      false,
      ['counters.nodeVisits.missing'],
    ],
    ['$distinct(rows)[$exists($$.gates.missing)]', true, ['gates.missing']],
    ['$exists((gates.missing)[$$.gates.other])', false, ['gates.missing', 'gates.other']],
    ['$exists($lookup(gates,"missing")[$$.gates.other])', false, ['gates.missing', 'gates.other']],
  ] as const)('enforces the publication rule for %s', (source, optional, keys) => {
    const definition = returning(source);
    expect(isPublishable(LoopDefinitionSchema.parse(definition))).toBe(optional);
    const issues = referenceIssues(definition);
    expect(issues).toHaveLength(keys.length);
    for (const [index, key] of keys.entries()) {
      expect(issues[index]).toEqual(
        expect.objectContaining({
          code: optional ? 'NODE_REFERENCE_OPTIONAL_MISSING' : 'NODE_REFERENCE_MISSING',
          severity: optional ? 'warning' : 'error',
          nodeId: 'done',
          path: 'config.returns',
          message: expect.stringContaining(key),
        }),
      );
    }
  });

  it('warns about a shadowed original root within an evaluated filter', () => {
    const source = '($$ := $fixture; $distinct(rows)[id = $$.outputs.start.value])';
    const definition = returning(source);
    const result = renamed(definition);
    expect(expressionOf(result.definition)).toBe(source);
    expect(result.repairedReferences).toBe(1);
    const issue = expect.objectContaining({
      code: 'NODE_REFERENCE_UNCERTAIN',
      nodeId: 'done',
      path: 'config.returns',
    });
    expect(result.warnings).toEqual([issue]);
    expect(referenceIssues(definition)).toEqual([issue]);
  });

  it.each([
    'rows ~> $distinct()[$$.gates.missing and $$.outputs.start]',
    'rows ~> $distinct(){"k": $$.gates.missing, "value": $$.outputs.start}',
  ])(
    'warns on references in decorations skipped by JSONata function application %s',
    async (source) => {
      const definition = returning(source);
      const rows = [{ id: 1 }, { id: 2 }];
      expect(await evaluateExpression(source, { rows })).toEqual(rows);
      expect(isPublishable(LoopDefinitionSchema.parse(definition))).toBe(true);
      const issue = expect.objectContaining({
        code: 'NODE_REFERENCE_UNCERTAIN',
        nodeId: 'done',
        path: 'config.returns',
      });
      expect(referenceIssues(definition)).toEqual([issue]);
      const result = renamed(definition);
      expect(expressionOf(result.definition)).toBe(source);
      expect(result.repairedReferences).toBe(1);
      expect(result.warnings).toEqual([issue]);
    },
  );

  it('repairs evaluated function arguments while warning on its skipped filter', async () => {
    const source =
      'rows ~> $filter(function($row){$row.id = $$.outputs.start.value})[$$.outputs.start]';
    const expected =
      'rows ~> $filter(function($row){$row.id = $$.outputs."true".value})[$$.outputs.start]';
    const result = renamed(returning(source));
    expect(expressionOf(result.definition)).toBe(expected);
    expect(result.repairedReferences).toBe(2);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'NODE_REFERENCE_UNCERTAIN', path: 'config.returns' }),
    ]);
    const rows = [{ id: 1 }, { id: 2 }];
    expect(await evaluateExpression(expected, { rows, outputs: { true: { value: 2 } } })).toEqual({
      id: 2,
    });
  });

  it('keeps an applied presence probe optional when its function has a skipped predicate', () => {
    const definition = returning('gates.missing ~> $exists()[$$.gates.other]');
    expect(isPublishable(LoopDefinitionSchema.parse(definition))).toBe(true);
    expect(referenceIssues(definition).map(({ code }) => code)).toEqual([
      'NODE_REFERENCE_OPTIONAL_MISSING',
      'NODE_REFERENCE_UNCERTAIN',
    ]);
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
