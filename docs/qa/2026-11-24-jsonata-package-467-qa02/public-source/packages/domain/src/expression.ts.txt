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
function compile(
  expression: string,
  cached = true,
  failed?: (reason: 'compile' | 'unsafe-regex') => void,
): Compiled {
  const hit = cached ? cache.get(expression) : undefined;
  if (hit) return hit;
  let compiled: Compiled;
  try {
    compiled = jsonata(expression);
  } catch (error) {
    failed?.('compile');
    throw new ExpressionError(`expression failed to compile: ${describeError(error)}`, {
      expression,
    });
  }
  const unsafe = unsafeRegexIn(compiled.ast());
  if (unsafe) {
    failed?.('unsafe-regex');
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

/** A JSONata native function value, as `$eval` evaluates to. */
interface JsonataFunction {
  _jsonata_function: true;
  implementation: (this: unknown, ...args: unknown[]) => unknown;
  signature?: unknown;
}

let builtinEval: Promise<JsonataFunction> | undefined;

/**
 * JSONata's `$eval` compiles a string at run time, which would bypass the regex check above. It
 * is shadowed by this binding: the string is first compiled through the same checks (an unsafe
 * regex or a syntax error throws), then handed to JSONata's own `$eval` implementation. That runs
 * in the caller's environment, so lexical variables and functions stay visible and the nested
 * evaluation shares the caller's depth and deadline budget (the hooks live in that environment).
 */
const CHECKED_EVAL: JsonataFunction = {
  _jsonata_function: true,
  async implementation(this: unknown, source: unknown, focus?: unknown): Promise<unknown> {
    if (typeof source === 'string') compile(source, false);
    builtinEval ??= jsonata('$eval').evaluate({}) as Promise<JsonataFunction>;
    const builtin = await builtinEval;
    try {
      return await builtin.implementation.apply(this, [source, focus]);
    } catch (error) {
      // JSONata's $eval wraps a failure in a new error that embeds the inner message; nested
      // evals would grow it exponentially. Normalise at every boundary: keep the innermost
      // cause, and bound the message.
      throw normaliseEvalError(error);
    }
  },
};

/** Longest error message an expression failure carries. */
const MAX_ERROR_MESSAGE = 1000;

function bounded(message: string): string {
  return message.length > MAX_ERROR_MESSAGE
    ? `${message.slice(0, MAX_ERROR_MESSAGE)}… (${message.length - MAX_ERROR_MESSAGE} more characters)`
    : message;
}

/** The single, bounded error a failed nested `$eval` reports: its innermost cause. */
function normaliseEvalError(error: unknown): ExpressionError {
  let cause = error;
  while (
    !(cause instanceof ExpressionError) &&
    typeof cause === 'object' &&
    cause !== null &&
    'error' in cause &&
    cause.error !== undefined
  ) {
    cause = cause.error;
  }
  if (cause instanceof ExpressionError) return cause;
  return new ExpressionError(`$eval failed: ${bounded(describeError(cause))}`);
}

export type ExpressionReason =
  'compile' | 'unsafe-regex' | 'depth' | 'time' | 'evaluation-rejected';

export type ExpressionObservation<T> =
  { ok: true; value: T } | { ok: false; error: unknown; reason?: ExpressionReason };

function legacyError(error: unknown, expression: string): ExpressionError {
  return error instanceof ExpressionError
    ? error
    : new ExpressionError(`expression failed: ${bounded(describeError(error))}`, { expression });
}

/** Only a concrete invocation can produce a reason. Preparing bindings has no such evidence. */
export async function observeExpression(
  expression: string,
  input: unknown,
  options: ExpressionOptions = {},
): Promise<ExpressionObservation<unknown>> {
  let compileReason: 'compile' | 'unsafe-regex' | undefined;
  let expr: Compiled;
  try {
    expr = compile(expression, true, (reason) => {
      compileReason = reason;
    });
  } catch (error) {
    return { ok: false, error, ...(compileReason ? { reason: compileReason } : {}) };
  }
  let limit: { error: ExpressionError; reason: 'time' | 'depth' } | undefined;
  let bindings: Record<string, unknown>;
  try {
    bindings = {
      ...options.bindings,
      eval: CHECKED_EVAL,
      ...evaluationHooks(options.timeoutMs ?? 2000, options.maxDepth ?? 200, (error, reason) => {
        limit = { error, reason };
      }),
    };
  } catch (error) {
    return { ok: false, error: legacyError(error, expression) };
  }
  try {
    const value: unknown = await expr.evaluate(input, bindings);
    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      error: legacyError(error, expression),
      reason: limit && limit.error === error ? limit.reason : 'evaluation-rejected',
    };
  }
}

/**
 * Count nested calls and check elapsed time in one invocation, including checked $eval.
 * The pinned JSONata patch binds the hooks in that invocation's frame and finishes
 * sibling evaluations before starting the next.
 */
const ENTRY_HOOK = Symbol.for('jsonata.__evaluate_entry');
const EXIT_HOOK = Symbol.for('jsonata.__evaluate_exit');

function evaluationHooks(
  timeoutMs: number,
  maxDepth: number,
  onLimit: (error: ExpressionError, reason: 'depth' | 'time') => void,
): Record<symbol, () => void> {
  let depth = 0;
  const start = Date.now();
  const check = (): void => {
    if (depth > maxDepth) {
      const error = new ExpressionError(`expression exceeded max depth ${maxDepth}`);
      onLimit(error, 'depth');
      throw error;
    }
    if (Date.now() - start > timeoutMs) {
      const error = new ExpressionError(`expression exceeded ${timeoutMs}ms`);
      onLimit(error, 'time');
      throw error;
    }
  };
  return {
    [ENTRY_HOOK]: () => {
      depth += 1;
      check();
    },
    [EXIT_HOOK]: () => {
      depth -= 1;
      check();
    },
  };
}

/** Evaluate a JSONata expression against an input. Undefined results become `undefined`. */
export async function evaluateExpression(
  expression: string,
  input: unknown,
  options: ExpressionOptions = {},
): Promise<unknown> {
  const result = await observeExpression(expression, input, options);
  if (!result.ok) throw result.error;
  return result.value;
}

/** Predicate coercion: missing/null are false, nonempty collections pass, scalars use Boolean. */
export async function evaluatePredicate(
  expression: string,
  input: unknown,
  options: ExpressionOptions = {},
): Promise<boolean> {
  const result = await observePredicate(expression, input, options);
  if (!result.ok) throw result.error;
  return result.value;
}

export async function observePredicate(
  expression: string,
  input: unknown,
  options: ExpressionOptions = {},
): Promise<ExpressionObservation<boolean>> {
  const result = await observeExpression(expression, input, options);
  if (!result.ok) return result;
  // Coercion can run user code on a general JS value. Its exception stays outside attribution.
  return { ok: true, value: predicateValue(result.value) };
}

function predicateValue(value: unknown): boolean {
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

/** The same parsed and safety-checked syntax used for evaluation. Inspect without modifying it. */
export function expressionAst(source: string): unknown {
  return compile(source).ast();
}
