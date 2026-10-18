import { describe, expect, it } from 'vitest';
import { V3LoopDefinitionSchema, type V3LoopDefinition } from '@graphgoblin/contracts';
import { evaluateExpression, evaluatePredicate } from '../expression.js';
import { convertDefinitionV3ToV4, type DefinitionResolutions } from './index.js';
import { filterId, filterNeedsReplacement, filterRouteExpression } from './filters.js';

function frozen(filter = 'action = "opened"'): V3LoopDefinition {
  return V3LoopDefinitionSchema.parse({
    schemaVersion: 3,
    name: 'Stored filter',
    settings: { maxIterations: 20 },
    nodes: [
      {
        id: 'hook',
        kind: 'trigger',
        label: 'Hook',
        config: { subtype: 'event', eventType: 'ready', filter },
      },
      {
        id: 'done',
        kind: 'exit',
        label: 'Effectful exit',
        config: { return: { mapping: '"sent"', channels: [{ kind: 'log' }] } },
      },
    ],
    edges: [
      {
        id: 'successor',
        from: { node: 'hook', port: 'out' },
        to: { node: 'done' },
        ui: { route: [200] },
      },
    ],
  });
}
const convert = (
  source = frozen(),
  resolutions: DefinitionResolutions = {},
  version = 'version-one',
) => convertDefinitionV3ToV4(source, resolutions, version);

describe('predicate coercion parity', () => {
  it.each([
    ['missing', 'missing', {}, false],
    ['null', 'null', {}, false],
    ['true', 'true', {}, true],
    ['false', 'false', {}, false],
    ['zero', '0', {}, false],
    ['negative zero', '$', -0, false],
    ['NaN', '$', NaN, false],
    ['arithmetic NaN', '0/0', {}, false],
    ['infinity', '1/0', {}, true],
    ['negative infinity', '-1/0', {}, true],
    ['infinite input', '$', Infinity, true],
    ['negative infinite input', '$', -Infinity, true],
    ['non-finite array', '[1/0,0/0]', {}, true],
    ['non-finite object', '{"a":1/0}', {}, true],
    ['positive', '2', {}, true],
    ['negative', '-2', {}, true],
    ['empty string', '""', {}, false],
    ['nonempty string', '"false"', {}, true],
    ['empty array', '[]', {}, false],
    ['nonempty array', '[0]', {}, true],
    ['empty object', '{}', {}, false],
    ['nonempty object', '{"a":0}', {}, true],
    ['false member', '[false]', {}, true],
    ['null member', '[null]', {}, true],
    ['false property', '{"a":false}', {}, true],
    ['nested empty array', '[[]]', {}, true],
    ['nested false array', '[[false]]', {}, true],
    ['empty sequence', '[1,2][false]', {}, false],
    ['singleton false sequence', '[false,true][$ = false]', {}, false],
    ['multi false sequence', '[false,false][$ = false]', {}, true],
    ['singleton object sequence', '[{}][true]', {}, false],
    ['lambda', 'function($x){$x}', {}, true],
    ['builtin', '$sum', {}, true],
    ['regex function', '/a/', {}, true],
    ['function array', '[function($x){$x}]', {}, true],
  ])('%s', async (_name, source, payload, expected) => {
    expect(await evaluatePredicate(String(source), payload)).toBe(expected);
    expect(
      await evaluateExpression(filterRouteExpression(String(source)), {
        invocation: { trigger: { payload } },
      }),
    ).toBe(expected ? 'pass' : 'ignore');
  });
  it.each([
    ['$exists := function($x){false}', true],
    ['$count := function($x){0}', true],
    ['$keys := function($x){[]}', true],
    ['$length := function($x){0}', true],
    ['$type := function($x){"null"}', true],
    ['$exists := false', false],
    ['$count := [false]', true],
    ['$keys := {"a":false}', true],
    ['$length := "ready"', true],
    ['$type := null', false],
    ['($exists := function($x){false}; [false])', true],
    ['($count := function($x){0}; [])', false],
    ['(($exists := function($x){false}); ($length := function($x){0}; "ready"))', true],
  ])('isolates source bindings during coercion: %s', async (source, expected) => {
    expect(await evaluatePredicate(String(source), {})).toBe(expected);
    expect(
      await evaluateExpression(filterRouteExpression(String(source)), {
        invocation: { trigger: { payload: {} } },
      }),
    ).toBe(expected ? 'pass' : 'ignore');
  });
  it('creates a separate JSONata frame for a parenthesized eval call', async () => {
    const source = JSON.stringify('$exists := function($x){false}');
    // Characterize this JSONata version: eval alone mutates its caller, but a block contains it.
    expect(await evaluateExpression(`($v := $eval(${source}); $exists(null))`, {})).toBe(false);
    expect(
      await evaluateExpression(`($v := ($eval(${source})); [$exists(null), $type($v)])`, {}),
    ).toEqual([true, 'function']);
  });
  it('quotes source exactly and retains guarded eval, regex/depth/deadline failures', async () => {
    const source = 'text = "quoted \\" line\\n"';
    expect(filterRouteExpression(source)).toContain(JSON.stringify(source));
    for (const expression of [
      '$error("broken")',
      '$eval("$match(\\"aa\\", /(a+)+$/)")',
      '($f:=function(){ $f() };$f())',
    ])
      await expect(
        evaluateExpression(
          filterRouteExpression(expression),
          { invocation: { trigger: { payload: {} } } },
          { maxDepth: 15 },
        ),
      ).rejects.toThrow();
    await expect(
      evaluateExpression(
        filterRouteExpression('$sum([1..1000])'),
        { invocation: { trigger: { payload: {} } } },
        { timeoutMs: -1 },
      ),
    ).rejects.toThrow();
  });
});

describe('stored trigger filter graphs', () => {
  it.each(['hmac-sha256', 'hmac-sha256-body'])(
    'separates %s decoding review from per-version filter review',
    async (scheme) => {
      const source = frozen('[false]');
      source.nodes[0] = V3LoopDefinitionSchema.parse({
        ...source,
        nodes: [
          {
            ...source.nodes[0],
            config: {
              subtype: 'webhook',
              signature: { scheme, secretRef: 'hook-key' },
              filter: '[false]',
              dedupeKey: 'id',
            },
          },
          source.nodes[1],
        ],
      }).nodes[0]!;
      const result = await convert(source);
      expect(result).toMatchObject({ ok: true, ready: false });
      expect(
        result.reviewItems.filter((item) => item.status === 'pending').map((item) => item.kind),
      ).toEqual(['webhook-json-decoding', 'trigger-filter']);
      const resolutions: DefinitionResolutions = Object.fromEntries(
        result.reviewItems
          .filter((item) => item.status === 'pending')
          .map((item) => [
            item.id,
            { action: 'approve', hash: item.hash, reason: 'Reviewed both changes.' },
          ]),
      );
      expect(await convert(source, resolutions)).toMatchObject({ ok: true, ready: true });
    },
  );
  it('avoids collisions across existing node and edge IDs, including 64-character trigger IDs', async () => {
    const source = frozen();
    source.nodes.push({
      id: 'hook-check',
      kind: 'trigger',
      label: 'Other',
      ui: { x: 0, y: 0 },
      config: { subtype: 'manual', exposeTo: ['ui'] },
    });
    source.edges.push({
      id: 'hook-restore',
      from: { node: 'hook-check', port: 'out' },
      to: { node: 'done', port: 'in' },
    });
    const result = await convert(source);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nodes.map((node) => node.id)).toEqual(
        expect.arrayContaining(['hook-check-2', 'hook-restore-2']),
      );
    }
    const long = frozen();
    long.nodes[0]!.id = 'a'.repeat(64);
    long.edges[0]!.from.node = long.nodes[0]!.id;
    const converted = await convert(long);
    expect(converted.ok).toBe(true);
    if (converted.ok)
      expect(converted.value.nodes.every((node) => node.id.length <= 64)).toBe(true);
  });
  it('generates a deterministic reviewed graph, retains identities, restores exact output and never reuses an effectful exit', async () => {
    const source = frozen();
    const before = structuredClone(source);
    const result = await convert(source);
    expect(source).toEqual(before);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ready).toBe(false);
    const item = result.reviewItems.find((entry) => entry.kind === 'trigger-filter')!;
    expect(item.reason).toMatch(/quiet run.*after acknowledgement.*Keys.*Extra visits/);
    expect(item.reason).toContain('successor');
    expect(result.value.nodes.find((node) => node.id === 'hook')?.config).not.toHaveProperty(
      'filter',
    );
    expect(result.value.edges.find((edge) => edge.id === 'successor')).toEqual({
      id: 'successor',
      from: { node: 'hook-restore', port: 'out' },
      to: { node: 'done', port: 'in' },
    });
    expect(result.value.nodes.find((node) => node.id === 'hook-quiet-exit')?.config).toEqual({
      outcome: 'success',
      returns: 'none',
      destinations: [],
    });
    expect(result.value.nodes.find((node) => node.id === 'done')?.config).toMatchObject({
      returns: '"sent"',
      destinations: [{ kind: 'log' }],
    });
    const output = { value: { exact: [false, null] }, source: 'hook' };
    expect(
      await evaluateExpression('$lookup(outputs, "hook")', { outputs: { hook: output } }),
    ).toEqual(output);
    expect(await convert(source)).toEqual(result);
    const approved = await convert(source, {
      [item.id]: { action: 'approve', hash: item.hash, reason: 'Reviewed timing and visits.' },
    });
    expect(approved).toMatchObject({ ok: true, ready: true, value: result.value });
  });
  it('binds approval to the entire source, generated fragment and exact stored version', async () => {
    const source = frozen();
    const result = await convert(source);
    const item = result.reviewItems.find((entry) => entry.kind === 'trigger-filter')!;
    const resolutions: DefinitionResolutions = {
      [item.id]: { action: 'approve', hash: item.hash, reason: 'Reviewed.' },
    };
    expect(await convert(source, resolutions, 'version-two')).toMatchObject({ ok: false });
    expect(await convert({ ...source, name: 'changed' }, resolutions)).toMatchObject({ ok: false });
    expect(await convertDefinitionV3ToV4(source)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'V4_FILTER_VERSION_REQUIRED' }),
      ]),
    });
  });
  it('accepts an owned valid replacement fragment and explicit removal, but rejects empty reasons and invalid replacements', async () => {
    const source = frozen();
    const result = await convert(source);
    const item = result.reviewItems.find((entry) => entry.kind === 'trigger-filter')!;
    const fragment = structuredClone(item.proposedValue) as {
      nodes: { config: unknown }[];
      edges: unknown[];
    };
    fragment.nodes[0]!.config = {
      kind: 'expression',
      jsonata: '"pass"',
      routes: [
        { id: 'pass', label: 'Pass' },
        { id: 'ignore', label: 'Ignore' },
      ],
    };
    const resolution = {
      action: 'replace' as const,
      hash: item.hash,
      reason: 'Owner supplied policy.',
      value: fragment,
    };
    expect(await convert(source, { [item.id]: resolution })).toMatchObject({
      ok: true,
      ready: true,
    });
    for (const value of [
      {},
      { nodes: [], edges: [] },
      { ...fragment, edges: [] },
      { ...fragment, nodes: [...fragment.nodes, fragment.nodes[0]] },
      {
        ...fragment,
        nodes: [{ id: 'done', kind: 'exit', label: 'Reuse', config: { returns: 'none' } }],
      },
    ])
      expect(await convert(source, { [item.id]: { ...resolution, value } })).toMatchObject({
        ok: false,
      });
    const removal = {
      action: 'remove' as const,
      hash: item.hash,
      reason: 'Approve broader input acceptance and all effects.',
    };
    const removed = await convert(source, { [item.id]: removal });
    expect(removed).toMatchObject({ ok: true, ready: true });
    if (removed.ok) {
      expect(removed.value.nodes).toHaveLength(2);
      expect(removed.value.edges[0]?.ui).toEqual({ route: [200] });
    }
    expect(await convert(source, { [item.id]: { ...removal, reason: ' ' } })).toMatchObject({
      ok: false,
    });
    expect(await convert(source, { [item.id]: { ...removal, value: null } })).toMatchObject({
      ok: false,
    });
  });
  it.each([
    '$headers.event = "ready"',
    '$now()',
    '$millis()',
    '$random()',
    '$shuffle([1,2])',
    '$eval("true")',
    '$external',
    '$$',
    '$$.action',
    '($alias := $headers; $alias.event)',
  ])(
    'requires a reviewed replacement for %s, never approval of a missing proposal',
    async (expression) => {
      const source = frozen(expression);
      const result = await convert(source);
      const item = result.reviewItems.find((entry) => entry.kind === 'trigger-filter')!;
      expect(item.proposedValue).toBeNull();
      expect(
        await convert(source, {
          [item.id]: { action: 'approve', hash: item.hash, reason: 'Cannot approve.' },
        }),
      ).toMatchObject({ ok: false });
      const baseline = await convert(frozen());
      const value = baseline.reviewItems.find(
        (entry) => entry.kind === 'trigger-filter',
      )!.proposedValue;
      expect(
        await convert(source, {
          [item.id]: {
            action: 'replace',
            hash: item.hash,
            reason: 'Supplied explicit replacement.',
            value,
          },
        }),
      ).toMatchObject({ ok: true, ready: true });
    },
  );
  it.each([
    'true',
    'action = "opened"',
    '$count(items) > 0',
    '($a := action; $a = "opened")',
    '$map(items, function($x){$x.ready})',
  ])('recognizes payload-only source %s', (source) =>
    expect(filterNeedsReplacement(source)).toBe(false),
  );
  it.each(['items@$x[$x.ready]', 'items#$i[$i = 0]'])(
    'conservatively requires replacement for deterministic context/position binding: %s',
    async (expression) => {
      expect(await evaluatePredicate(expression, { items: [{ ready: true }] })).toBe(true);
      expect(filterNeedsReplacement(expression)).toBe(true);
      const result = await convert(frozen(expression));
      expect(result.reviewItems.find((item) => item.kind === 'trigger-filter')).toMatchObject({
        proposedValue: null,
        status: 'pending',
      });
    },
  );
  it.each(['several', 'missing', 'wrong port', 'no outgoing'])(
    'refuses %s successor topology',
    async (kind) => {
      const source = frozen();
      if (kind === 'several') source.edges.push({ ...source.edges[0]!, id: 'second' });
      if (kind === 'missing') source.edges[0]!.to.node = 'absent';
      if (kind === 'wrong port') source.edges[0]!.from.port = 'other';
      if (kind === 'no outgoing') source.edges = [];
      expect(await convert(source)).toMatchObject({
        ok: false,
        issues: expect.arrayContaining([expect.objectContaining({ code: 'V4_FILTER_REFUSED' })]),
      });
    },
  );
  it('resolves long Slug collisions, reports exhaustion, and refuses wrapper/node/edge bounds', async () => {
    const used = new Set(['a'.repeat(64), 'a'.repeat(62) + '-2']);
    expect(filterId(used, 'a'.repeat(64) + '-check')).toBe('a'.repeat(62) + '-3');
    const full = new Set<string>();
    for (let i = 0; i <= 2500; i++) full.add(i ? `hook-${i + 1}` : 'hook');
    expect(filterId(full, 'hook')).toBeNull();
    expect(await convert(frozen('"' + 'a'.repeat(99_998) + '"'))).toMatchObject({ ok: false });
    for (const dimension of ['nodes', 'edges']) {
      const source = frozen();
      if (dimension === 'nodes')
        for (let i = 0; i < 496; i++)
          source.nodes.push({
            id: `extra-${i}`,
            kind: 'trigger',
            label: 'Extra',
            ui: { x: 0, y: 0 },
            config: { subtype: 'manual', exposeTo: ['ui'] },
          });
      else {
        source.nodes.push({
          id: 'other',
          kind: 'trigger',
          label: 'Other',
          ui: { x: 0, y: 0 },
          config: { subtype: 'manual', exposeTo: ['ui'] },
        });
        for (let i = 0; i < 1997; i++)
          source.edges.push({
            id: `extra-${i}`,
            from: { node: 'other', port: 'out' },
            to: { node: 'done', port: 'in' },
          });
      }
      expect(await convert(source)).toMatchObject({
        ok: false,
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: 'V4_FILTER_REFUSED',
            message: 'Filter graph exceeds 500 nodes or 2,000 edges.',
          }),
        ]),
      });
    }
  });
});
