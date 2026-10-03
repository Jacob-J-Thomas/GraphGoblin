import jsonata from 'jsonata';
import { ExpressionError } from './errors.js';

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

function compile(expression: string): Compiled {
  const hit = cache.get(expression);
  if (hit) return hit;
  let compiled: Compiled;
  try {
    compiled = jsonata(expression);
  } catch (error) {
    throw new ExpressionError(`expression failed to compile: ${describeError(error)}`, {
      expression,
    });
  }
  if (cache.size >= CACHE_LIMIT) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(expression, compiled);
  return compiled;
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
  const expr = compile(expression);
  timebox(expr, options.timeoutMs ?? 2000, options.maxDepth ?? 200);
  try {
    const result: unknown = await expr.evaluate(input, options.bindings ?? {});
    return result;
  } catch (error) {
    if (error instanceof ExpressionError) throw error;
    throw new ExpressionError(`expression failed: ${describeError(error)}`, { expression });
  }
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
