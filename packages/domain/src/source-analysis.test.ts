import { describe, expect, it, vi } from 'vitest';
import { LoopDefinitionSchema, type LoopDefinitionInput } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { validateLoop, renameLoopNode } from './index.js';
import { sourceAnalysis } from './source-analysis.js';
import * as template from './template.js';

function definition(returns: string, triggerId = 'start'): LoopDefinitionInput {
  const loop = minimalLoop();
  return {
    ...loop,
    nodes: loop.nodes.map((node) =>
      node.kind === 'trigger'
        ? { ...node, id: triggerId }
        : node.kind === 'exit'
          ? { ...node, config: { ...node.config, returns } }
          : node,
    ),
    edges: loop.edges.map((edge) => ({ ...edge, from: { ...edge.from, node: triggerId } })),
  };
}

function validate(input: LoopDefinitionInput) {
  return validateLoop(LoopDefinitionSchema.parse(input));
}

describe('source-only analysis reuse', () => {
  it('parses each distinct template once cold and only the changed source on a warm edit', () => {
    const parse = vi.spyOn(template, 'parseAuthoredTemplate');
    try {
      const first = definition('outputs.start.value');
      first.settings = {
        workingDirectory: {
          kind: 'template',
          template: 'fresh cache fixture {{ outputs.start.value }}',
        },
      };
      expect(validate(first)).toEqual([]);
      expect(parse).toHaveBeenCalledTimes(1);

      const moved = structuredClone(first);
      moved.nodes[0]!.ui = { x: 10, y: 20 };
      expect(validate(moved)).toEqual([]);
      expect(parse).toHaveBeenCalledTimes(1);

      moved.settings = {
        workingDirectory: {
          kind: 'template',
          template: 'edited cache fixture {{ outputs.start.value }}',
        },
      };
      expect(validate(moved)).toEqual([]);
      expect(parse).toHaveBeenCalledTimes(2);
    } finally {
      parse.mockRestore();
    }
  });

  it('rechecks output ownership and missing IDs across loops using the same analyzed source', () => {
    const source = '[outputs.start.value, counters.nodeVisits.start]';
    expect(validate(definition(source))).toEqual([]);

    const foreign = definition(source, 'different');
    const issues = validate(foreign);
    expect(issues).toMatchObject([
      { code: 'NODE_REFERENCE_OUTPUT_UNVERIFIED', severity: 'warning', nodeId: 'done' },
      { code: 'NODE_REFERENCE_MISSING', severity: 'error', nodeId: 'done' },
    ]);
    issues.length = 0;
    expect(validate(foreign)).toHaveLength(2);

    const custom = structuredClone(foreign);
    custom.nodes.push({
      kind: 'mutate',
      id: 'write',
      label: 'Write',
      config: {
        operations: [{ op: 'set', path: '/outputs/start', value: { kind: 'literal', value: {} } }],
      },
    });
    custom.edges[0]!.to.node = 'write';
    custom.edges.push({ id: 'next', from: { node: 'write', port: 'out' }, to: { node: 'done' } });
    expect(validate(custom)).toMatchObject([{ code: 'NODE_REFERENCE_MISSING', severity: 'error' }]);
  });

  it('keeps the language and the actual JSONata scope distinct for identical source', () => {
    const source = 'thread.gates.missing.passes';
    expect(sourceAnalysis('expression', source, 'thread').sites).toEqual([]);
    expect(sourceAnalysis('expression', source, 'heartbeat').sites).toMatchObject([
      { id: 'missing' },
    ]);
    expect(sourceAnalysis('expression', source, 'parent').sites).toEqual([]);
    expect(sourceAnalysis('template', source, 'heartbeat').sites).toEqual([]);
    const cached = sourceAnalysis('expression', source, 'heartbeat');
    expect(cached.sites).toMatchObject([{ id: 'missing' }]);
    expect(Object.isFrozen(cached)).toBe(true);
    expect(Object.isFrozen(cached.sites)).toBe(true);
    expect(Object.isFrozen(cached.sites[0])).toBe(true);
    expect(Object.isFrozen(cached.sites[0]?.span)).toBe(true);
  });

  it('preserves out-of-scope syntax errors before locally actionable reference issues', () => {
    const loop = definition('counters.nodeVisits.missing');
    loop.settings = { workingDirectory: { kind: 'template', template: '{% noSuchCacheTag %}' } };
    loop.nodes[0] = {
      kind: 'trigger',
      id: 'start',
      label: 'Start',
      config: { type: 'event', eventType: 'work', dedupeKey: 'gates.missing +' },
    };
    expect(validate(loop)).toMatchObject([
      { code: 'TEMPLATE_INVALID', path: 'settings.workingDirectory.template' },
      { code: 'EXPRESSION_INVALID', path: 'config.dedupeKey', nodeId: 'start' },
      { code: 'NODE_REFERENCE_MISSING', path: 'config.returns', nodeId: 'done' },
    ]);
    expect(validate(loop)).toEqual(validate(structuredClone(loop)));
  });

  it('uses the same facts for different rename targets and keeps uncertainty and escaping', () => {
    const loop = definition('[outputs."st\\u0061rt".value, $lookup(outputs, vars.key)]');
    expect(validate(loop)).toMatchObject([{ code: 'NODE_REFERENCE_UNCERTAIN' }]);
    for (const id of ['new-id', 'true']) {
      const renamed = renameLoopNode(loop, 'start', id);
      expect(renamed.kind).toBe('renamed');
      if (renamed.kind !== 'renamed') throw new Error(renamed.kind);
      expect(renamed.definition.nodes.find((node) => node.kind === 'exit')?.config.returns).toBe(
        '[outputs."' + id + '".value, $lookup(outputs, vars.key)]',
      );
      expect(renamed.warnings).toMatchObject([{ code: 'NODE_REFERENCE_UNCERTAIN' }]);
    }
  });

  it('evicts least recently reused facts at both the entry and retained size bounds', () => {
    // Small plain templates exercise the count bound without reaching the size bound.
    const first = sourceAnalysis('template', 'count limit anchor', 'thread');
    for (let i = 0; i < 1024; i += 1) sourceAnalysis('template', 'count-' + i, 'thread');
    expect(sourceAnalysis('template', 'count limit anchor', 'thread')).not.toBe(first);

    const older = sourceAnalysis('template', 'size limit anchor', 'thread');
    const recent = sourceAnalysis('template', 'size limit newer anchor', 'thread');
    const text = 'x'.repeat(7000); // ~14 KiB per entry stays within the per-entry limit.
    for (let i = 0; i < 90; i += 1) {
      sourceAnalysis('template', text + i, 'thread');
      expect(sourceAnalysis('template', 'size limit newer anchor', 'thread')).toBe(recent);
    }
    expect(sourceAnalysis('template', 'size limit anchor', 'thread')).not.toBe(older);
  });

  it('analyzes oversized text and oversized span lists without retaining them or evicting small facts', () => {
    const small = sourceAnalysis('template', 'small bypass control', 'thread');
    const long = 'x'.repeat(8200) + '{{ gates.missing.passes }}';
    const dense = '{{ gates.missing.passes }}'.repeat(100);
    const templates = [long, dense];
    for (const source of templates) {
      const first = sourceAnalysis('template', source, 'thread');
      const second = sourceAnalysis('template', source, 'thread');
      expect(second).not.toBe(first);
      expect(second.problem).toBeNull();
      expect(second.sites.map(({ map, id }) => ({ map, id }))).toEqual(
        Array(source === dense ? 100 : 1).fill({ map: 'gates', id: 'missing' }),
      );
    }
    expect(sourceAnalysis('template', 'small bypass control', 'thread')).toBe(small);
  });
});
