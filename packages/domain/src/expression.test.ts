import { describe, expect, it, vi } from 'vitest';
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

  it.each([99, 100, 200])(
    'evaluates %i flat literal objects at the same depth as a projection',
    async (count) => {
      const rows = Array.from({ length: count }, (_, value) => ({ value }));
      expect(await evaluateExpression(JSON.stringify(rows), {})).toEqual(rows);
      const projection = await evaluateExpression('rows.{"value": value}', { rows });
      expect(Array.isArray(projection) && Array.from(projection)).toEqual(rows);
    },
  );

  it('does not count sibling object members as nested calls', async () => {
    const record = Object.fromEntries(Array.from({ length: 200 }, (_, n) => [`k${n}`, n]));
    expect(await evaluateExpression(JSON.stringify(record), {}, { maxDepth: 6 })).toEqual(record);
  });

  it('still limits genuinely nested literals and recursive evaluation cycles', async () => {
    const literal = `${'{"child":'.repeat(30)}42${'}'.repeat(30)}`;
    await expect(evaluateExpression(literal, {}, { maxDepth: 20 })).rejects.toThrow(/max depth 20/);
    const expression = '$eval(expr, $)';
    await expect(
      evaluateExpression(expression, { expr: expression }, { maxDepth: 20 }),
    ).rejects.toThrow(/max depth 20/);
  });

  it('isolates budgets and bindings when the same cached source runs concurrently', async () => {
    const expression = '($f := function($n) { $n = 0 ? $result : 1 + $f($n - 1) }; $f(10))';
    const strict = evaluateExpression(expression, {}, { maxDepth: 10, bindings: { result: 2 } });
    const loose = evaluateExpression(expression, {}, { maxDepth: 100, bindings: { result: 9 } });
    await Promise.all([
      expect(strict).rejects.toThrow(/max depth 10/),
      expect(loose).resolves.toBe(19),
    ]);
  });

  it('isolates deadlines when the same cached source runs concurrently', async () => {
    const expression = '($pause(); $value)';
    let release!: () => void;
    const pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      const short = evaluateExpression(
        expression,
        {},
        { timeoutMs: 10, bindings: { pause: () => pause, value: 'short' } },
      );
      const long = evaluateExpression(
        expression,
        {},
        { timeoutMs: 100, bindings: { pause: () => pause, value: 'long' } },
      );
      clock.mockReturnValue(1020);
      release();
      await Promise.all([
        expect(short).rejects.toThrow(/exceeded 10ms/),
        expect(long).resolves.toBe('long'),
      ]);
    } finally {
      clock.mockRestore();
    }
  });

  it('keeps one timestamp throughout an evaluation despite an interleaved call', async () => {
    vi.useFakeTimers();
    try {
      const expression = '($start := $millis(); $pause(); [$start, $millis()])';
      let release!: () => void;
      let started!: () => void;
      const pause = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      vi.setSystemTime(1000);
      const first = evaluateExpression(
        expression,
        {},
        {
          bindings: {
            pause: () => {
              started();
              return pause;
            },
          },
        },
      );
      await entered;
      vi.setSystemTime(1100);
      try {
        await expect(
          evaluateExpression(
            expression,
            {},
            {
              bindings: { pause: () => undefined },
            },
          ),
        ).resolves.toEqual([1100, 1100]);
      } finally {
        release();
      }
      await expect(first).resolves.toEqual([1000, 1000]);
    } finally {
      vi.useRealTimers();
    }
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
