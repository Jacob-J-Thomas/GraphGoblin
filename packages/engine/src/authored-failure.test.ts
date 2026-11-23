import { describe, expect, it } from 'vitest';
import {
  authoredFailure,
  evaluateAuthored,
  nodeWorkingDirectory,
  predicateAuthored,
  renderAuthored,
} from './authored-failure.js';
import { boundedAuthoredCause } from './failure-publication.js';

describe('pinned authored fields on inert run data', () => {
  const site = { nodeId: 'parent', boundary: 'subloop.input.vars' as const, mapIndex: 1 };
  it.each([
    '$error("PRIVATE")',
    '($error("PRIVATE"))',
    'true ? $error(secret) : 1',
    '$assert(false, secret)',
    '$eval("a +")',
  ])('publishes only the fixed evaluator cause for %s', async (source) => {
    const error: unknown = await evaluateAuthored(site, source, { secret: 'PRIVATE' }).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({
      code: 'EXPRESSION_ERROR',
      message:
        'Subloop input variable mapping 2 failed. The expression could not evaluate this input. Check its input type and mapping.',
      options: {
        nodeId: 'parent',
        resumable: false,
        details: { boundary: site.boundary, mapIndex: 1, cause: { code: 'EXPRESSION_ERROR' } },
      },
    });
    expect(JSON.stringify(error)).not.toContain('PRIVATE');
    expect(await evaluateAuthored(site, 'false ? $error(secret) : 7', {})).toBe(7);
  });
  it('keeps compile and unsafe regex specific only for the top-level field (synthetic bypass of publish validation)', async () => {
    for (const [source, expected] of [
      ['a +', 'parsed'],
      ['/((a+)+)$/', 'unsafe'],
    ] as const) {
      await expect(evaluateAuthored(site, source, {})).rejects.toThrow(expected);
      await expect(evaluateAuthored(site, '$eval(text)', { text: source })).rejects.toThrow(
        'Check its input type',
      );
    }
  });
  it('does not convert preparation or truthiness failures into selector diagnostics', async () => {
    const options = {
      bindings: {
        get value() {
          throw new Error('read');
        },
      },
    };
    await expect(predicateAuthored(site, '1', {}, options)).rejects.toThrow(
      'expression failed: read',
    );
    const external = new Error('keys');
    const value = new Proxy(
      {},
      {
        ownKeys() {
          throw external;
        },
      },
    );
    await expect(predicateAuthored(site, '$value', {}, { bindings: { value } })).rejects.toBe(
      external,
    );
  });
  it('reports Liquid location without the source and consumes only a local workspace result', async () => {
    await expect(
      renderAuthored(
        { nodeId: 'test', boundary: 'script.args', argumentIndex: 2 },
        'ok\n{% PRIVATE %}',
        {},
      ),
    ).rejects.toThrow(
      'Script argument 3 failed. The template could not be parsed at line 2, column 1',
    );
    expect(nodeWorkingDirectory({ ok: true, directory: 'private' }, 'test')).toBe('private');
    expect(() => nodeWorkingDirectory({ ok: false, reason: 'empty-path' }, 'test')).toThrow(
      'Supply a nonempty directory',
    );
    expect(() => nodeWorkingDirectory({ ok: false, reason: { phase: 'render' } }, 'test')).toThrow(
      'Check its filters',
    );
    expect(boundedAuthoredCause('x'.repeat(1001))).toBe('x'.repeat(999) + '\u2026');
  });
  it('names the operation, kind and actual item in an inference transform', () => {
    expect(
      authoredFailure(
        {
          nodeId: 'i',
          boundary: 'inference.output.transforms',
          operationIndex: 1,
          operationKind: 'drop',
          itemIndex: 2,
        },
        { kind: 'expression', reason: 'depth' },
      ).toFailure(),
    ).toMatchObject({
      code: 'MUTATION_ERROR',
      resumable: false,
      message:
        'Inference output transform 2 (drop), item 3 failed. The expression exceeded its nesting limit. Reduce its recursion or nesting. GraphGoblin received the provider result before this step failed.',
      details: {
        phase: 'after-result',
        operationIndex: 1,
        itemIndex: 2,
        cause: { code: 'EXPRESSION_ERROR' },
      },
    });
  });
});
