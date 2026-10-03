import jsonata from 'jsonata';
import { ExpressionError } from './errors.js';
import { unsafeRegexReason } from './regex-safety.js';

type Compiled = ReturnType<typeof jsonata>;

const cache = new Map<string, Compiled>();
const CACHE_LIMIT = 512;

export interface ExpressionOptions {
  /** Wall-clock limit for one evaluation. */
  timeoutMs?: number;
  /** Maximum recursion depth of the evaluator. */
  maxDepth?: number;
  /** Extra bindings available as `$name`. */
  bindings?: Record<string, unknown>;
}

/** jsonata throws plain objects with a `message`, not Error instances. */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String(error.message);
  }
  return String(error);
}

/**
 * The first regex literal in a parsed expression that fails the static safety check. JSONata has
 * no way to build a regex from a string, so literals are the only regexes an expression can run;
 * a native regex never returns to the evaluator's hooks, so the time budget cannot stop it
 * (ADV-007).
 */
function unsafeRegexIn(
  node: unknown,
  seen = new Set<object>(),
): { source: string; reason: string } | undefined {
  if (typeof node !== 'object' || node === null || seen.has(node)) return undefined;
  seen.add(node);
  if (node instanceof RegExp) {
    const reason = unsafeRegexReason(node.source, node.flags);
    return reason ? { source: node.source, reason } : undefined;
  }
  for (const value of Object.values(node)) {
    const found = unsafeRegexIn(value, seen);
    if (found) return found;
  }
  return undefined;
}

/** Compile and check an expression. `cached: false` gives a private instance (for `$eval`). */
function compile(expression: string, cached = true): Compiled {
  const hit = cached ? cache.get(expression) : undefined;
  if (hit) return hit;
  let compiled: Compiled;
  try {
    compiled = jsonata(expression);
  } catch (error) {
    throw new ExpressionError(`expression failed to compile: ${describeError(error)}`, {
      expression,
    });
  }
  const unsafe = unsafeRegexIn(compiled.ast());
  if (unsafe) {
    throw new ExpressionError(
      `expression uses the regular expression /${unsafe.source}/, which can run without bound: ${unsafe.reason}`,
      { expression },
    );
  }
  if (!cached) return compiled;
  if (cache.size >= CACHE_LIMIT) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(expression, compiled);
  return compiled;
}

/**
 * JSONata's `$eval` compiles a string at run time, which would bypass the regex check above. It
 * is replaced by this binding, which compiles the string through the same checks and evaluates it
 * with the same budgets and bindings. Without a focus argument it evaluates against the caller's
 * context (JSONata passes it as `this` to a bound function), as JSONata's own `$eval` does.
 */
function checkedEval(options: ExpressionOptions) {
  return async function (this: unknown, source: unknown, focus?: unknown): Promise<unknown> {
    if (source === undefined) return undefined;
    if (typeof source !== 'string') throw new ExpressionError('$eval takes a string expression');
    const expression = source;
    return run(compile(expression, false), expression, focus === undefined ? this : focus, options);
  };
}

async function run(
  expr: Compiled,
  expression: string,
  input: unknown,
  options: ExpressionOptions,
): Promise<unknown> {
  timebox(expr, options.timeoutMs ?? 2000, options.maxDepth ?? 200);
  try {
    const result: unknown = await expr.evaluate(input, {
      ...options.bindings,
      eval: checkedEval(options),
    });
    return result;
  } catch (error) {
    if (error instanceof ExpressionError) throw error;
    throw new ExpressionError(`expression failed: ${describeError(error)}`, { expression });
  }
}

/**
 * Time-box an evaluation. Pattern from the JSONata documentation: entry and exit hooks
 * count depth and check elapsed time, throwing when either budget is exceeded.
 * jsonata 2.x keys these hooks by symbol, not by the string names older docs show.
 */
const ENTRY_HOOK = Symbol.for('jsonata.__evaluate_entry');
const EXIT_HOOK = Symbol.for('jsonata.__evaluate_exit');

type HookAssign = (name: string | symbol, value: unknown) => void;

function timebox(expr: Compiled, timeoutMs: number, maxDepth: number): void {
  let depth = 0;
  const start = Date.now();
  const check = (): void => {
    if (depth > maxDepth) {
      throw new ExpressionError(`expression exceeded max depth ${maxDepth}`);
    }
    if (Date.now() - start > timeoutMs) {
      throw new ExpressionError(`expression exceeded ${timeoutMs}ms`);
    }
  };
  const assign = expr.assign.bind(expr) as unknown as HookAssign;
  assign(ENTRY_HOOK, () => {
    depth += 1;
    check();
  });
  assign(EXIT_HOOK, () => {
    depth -= 1;
    check();
  });
}

/** Evaluate a JSONata expression against an input. Undefined results become `undefined`. */
export async function evaluateExpression(
  expression: string,
  input: unknown,
  options: ExpressionOptions = {},
): Promise<unknown> {
  return run(compile(expression), expression, input, options);
}

/** Evaluate and coerce to boolean using JSONata truthiness. */
export async function evaluatePredicate(
  expression: string,
  input: unknown,
  options: ExpressionOptions = {},
): Promise<boolean> {
  const value = await evaluateExpression(expression, input, options);
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(value);
}

/** Compile only, to surface syntax errors at authoring time. Returns null when valid. */
export function checkExpression(expression: string): string | null {
  try {
    compile(expression);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
