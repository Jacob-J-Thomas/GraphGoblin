import { describe, expect, it } from 'vitest';
import { ExpressionError } from './errors.js';
import { checkExpression, evaluateExpression, evaluatePredicate } from './expression.js';

describe('evaluateExpression', () => {
  it('evaluates against input and bindings', async () => {
    expect(await evaluateExpression('a + b', { a: 1, b: 2 })).toBe(3);
    expect(await evaluateExpression('$x * 2', {}, { bindings: { x: 21 } })).toBe(42);
    expect(await evaluateExpression('{ "k": vars.topic }', { vars: { topic: 'loops' } })).toEqual({
      k: 'loops',
    });
  });

  it('returns undefined for missing paths', async () => {
    expect(await evaluateExpression('nope.deeper', {})).toBeUndefined();
  });

  it('throws ExpressionError on compile failures', async () => {
    await expect(evaluateExpression('a +', {})).rejects.toBeInstanceOf(ExpressionError);
    await expect(evaluateExpression('a +', {})).rejects.toThrow(/failed to compile/);
  });

  it('throws ExpressionError on runtime failures', async () => {
    await expect(evaluateExpression('$error("bad")', {})).rejects.toThrow(/expression failed: bad/);
  });

  it('stops runaway non-tail recursion at the depth budget', async () => {
    const runaway = '($f := function($n) { 1 + $f($n + 1) }; $f(0))';
    await expect(
      evaluateExpression(runaway, {}, { maxDepth: 20, timeoutMs: 5000 }),
    ).rejects.toThrow(/max depth/);
  });

  it('stops runaway tail recursion at the time budget', async () => {
    const runaway = '($f := function($n) { $f($n + 1) }; $f(0))';
    await expect(evaluateExpression(runaway, {}, { timeoutMs: 150 })).rejects.toThrow(
      /exceeded 150ms/,
    );
  });

  it('caches compiled expressions across calls', async () => {
    expect(await evaluateExpression('1 + 1', {})).toBe(2);
    expect(await evaluateExpression('1 + 1', {})).toBe(2);
  });

  it('evicts when the cache is full', async () => {
    for (let i = 0; i < 520; i += 1) {
      expect(await evaluateExpression(`${i} + 0`, {})).toBe(i);
    }
  });
});

describe('evaluatePredicate', () => {
  it('applies JSONata truthiness', async () => {
    expect(await evaluatePredicate('true', {})).toBe(true);
    expect(await evaluatePredicate('false', {})).toBe(false);
    expect(await evaluatePredicate('nope', {})).toBe(false);
    expect(await evaluatePredicate('[]', {})).toBe(false);
    expect(await evaluatePredicate('[1]', {})).toBe(true);
    expect(await evaluatePredicate('{}', {})).toBe(false);
    expect(await evaluatePredicate('{"a": 1}', {})).toBe(true);
    expect(await evaluatePredicate('0', {})).toBe(false);
    expect(await evaluatePredicate('"x"', {})).toBe(true);
    expect(await evaluatePredicate('null', {})).toBe(false);
  });
});

describe('checkExpression', () => {
  it('returns null when valid and a message otherwise', () => {
    expect(checkExpression('a.b')).toBeNull();
    expect(checkExpression('a +')).toMatch(/compile/);
  });
});
