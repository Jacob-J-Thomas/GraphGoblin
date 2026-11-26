import type {
  ContextThread,
  JsonPatch,
  JsonValue,
  Message,
  MessageRole,
  MutationOperation,
  PatchOperation,
  RepairPolicy,
  JsonSchema,
} from '@graphgoblin/contracts';
import { MutationError, PatchError } from './errors.js';
import {
  observeExpression,
  observePredicate,
  type ExpressionObservation,
  type ExpressionReason,
} from './expression.js';
import { validateJson, type SchemaValidation } from './json-schema.js';
import { applyPatch, assertMutablePath } from './patch.js';
import { getAtPointer } from './pointer.js';
import { unsafeRegexReason } from './regex-safety.js';
import { observeTemplate, type TemplateFact } from './template.js';
import { estimateMessageTokens, threadView } from './thread-view.js';

export interface MutationContext {
  /** Node performing the mutation; stamped on created messages. */
  nodeId: string;
  /** Deterministic id source for created messages. */
  newId: () => string;
  /** Deterministic clock. */
  now: () => string;
}

/** A coerce operation whose value failed validation and may be repaired by the engine. */
export interface RepairRequest {
  opIndex: number;
  source: string;
  target: string;
  jsonSchema: JsonSchema;
  repair: RepairPolicy;
  value: unknown;
  errors: string[];
}

export type MutationPlan =
  { kind: 'patch'; patch: JsonPatch } | { kind: 'repair'; request: RepairRequest };

/** Optional error mapping for callers that report authored operation failures. */
export type MutationFailureMapper = (
  error: unknown,
  index: number,
  operation: MutationOperation['op'],
) => unknown;

export type MutationFact =
  | { kind: 'expression'; reason: ExpressionReason; itemIndex?: number }
  | { kind: 'template'; fact: TemplateFact; itemIndex?: number }
  | { kind: 'regex' | 'target' | 'patch' };

export type MutationFactMapper = (
  fact: MutationFact,
  index: number,
  operation: MutationOperation['op'],
) => unknown;

type Rethrow = (error: unknown, fact?: MutationFact) => never;

function authored<T>(operation: () => T, rethrow: Rethrow, kind: 'target' | 'regex'): T {
  try {
    return operation();
  } catch (error) {
    return rethrow(
      error,
      error instanceof MutationError || error instanceof PatchError ? { kind } : undefined,
    );
  }
}

async function renderValue(
  source: string,
  view: Record<string, unknown>,
  rethrow: Rethrow,
  itemIndex?: number,
) {
  const result = await observeTemplate(source, view);
  return result.ok
    ? result.value
    : rethrow(result.error, {
        kind: 'template',
        fact: result.fact,
        ...(itemIndex === undefined ? {} : { itemIndex }),
      });
}

function evaluated<T>(result: ExpressionObservation<T>, rethrow: Rethrow, itemIndex?: number): T {
  if (result.ok) return result.value;
  return rethrow(
    result.error,
    result.reason
      ? {
          kind: 'expression',
          reason: result.reason,
          ...(itemIndex === undefined ? {} : { itemIndex }),
        }
      : undefined,
  );
}

export interface MutationResult {
  thread: ContextThread;
  patch: JsonPatch;
  /** Set when a coerce operation needs the engine to repair before continuing. */
  pending?: RepairRequest;
  /** Index of the first operation not yet applied (equals ops.length when complete). */
  appliedThrough: number;
}

function asJson(value: unknown): JsonValue {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

/** Messages built by makeMessage never contain undefined; this only satisfies the JSON type. */
function messageJson(message: Message): JsonValue {
  return message as unknown as JsonValue;
}

async function resolveValue(
  source: Extract<MutationOperation, { op: 'set' }>['value'],
  view: Record<string, unknown>,
  rethrow: Rethrow,
): Promise<JsonValue> {
  switch (source.kind) {
    case 'literal':
      return source.value;
    case 'template':
      return renderValue(source.template, view, rethrow);
    case 'expression':
      return asJson(
        evaluated(await observeExpression(source.jsonata, view).catch(rethrow), rethrow),
      );
  }
}

function makeMessage(
  ctx: MutationContext,
  role: MessageRole,
  content: string,
  tags: string[] | undefined,
): Message {
  return {
    id: ctx.newId(),
    role,
    content,
    nodeId: ctx.nodeId,
    ts: ctx.now(),
    ...(tags ? { tags } : {}),
  };
}

async function selectIndices(
  items: readonly unknown[],
  where: string,
  view: Record<string, unknown>,
  rethrow: Rethrow,
): Promise<number[]> {
  const out: number[] = [];
  for (const [index, item] of items.entries()) {
    const result = await observePredicate(where, item, { bindings: { thread: view, index } }).catch(
      rethrow,
    );
    if (evaluated(result, rethrow, index)) out.push(index);
  }
  return out;
}

function removeIndices(base: string, indices: number[]): PatchOperation[] {
  return [...indices].sort((a, b) => b - a).map((i) => ({ op: 'remove', path: `${base}/${i}` }));
}

function replaceInString(text: string, re: RegExp, replacement: string): string {
  return text.replace(re, replacement);
}

function walkStrings(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => walkStrings(v, fn));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      out[k] = walkStrings(v, fn);
    return out;
  }
  return value;
}

function compileRegex(pattern: string, flags: string): RegExp {
  let re: RegExp;
  try {
    re = new RegExp(pattern, flags.includes('g') ? flags : `${flags}g`);
  } catch (error) {
    throw new MutationError(
      `invalid pattern "${pattern}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  // The same static check as JSONata regex literals: a native match cannot be interrupted.
  const unsafe = unsafeRegexReason(re.source, re.flags);
  if (unsafe) throw new MutationError(`pattern "${pattern}" can run without bound: ${unsafe}`);
  return re;
}

/** Plan a single operation as a patch against the given thread, without applying it. */
export async function planMutation(
  thread: ContextThread,
  op: MutationOperation,
  ctx: MutationContext,
  opIndex = 0,
  mapFailure?: MutationFailureMapper,
  mapFact?: MutationFactMapper,
): Promise<MutationPlan> {
  const view = threadView(thread) as unknown as Record<string, unknown>;
  const rethrow: Rethrow = (error, fact) => {
    if (fact && mapFact) throw mapFact(fact, opIndex, op.op);
    throw mapFailure ? mapFailure(error, opIndex, op.op) : error;
  };

  switch (op.op) {
    case 'set': {
      authored(() => assertMutablePath(op.path), rethrow, 'target');
      const value = await resolveValue(op.value, view, rethrow);
      const exists = authored(() => getAtPointer(thread, op.path), rethrow, 'target').found;
      return { kind: 'patch', patch: [{ op: exists ? 'replace' : 'add', path: op.path, value }] };
    }
    case 'delete': {
      authored(() => assertMutablePath(op.path), rethrow, 'target');
      if (!authored(() => getAtPointer(thread, op.path), rethrow, 'target').found)
        return { kind: 'patch', patch: [] };
      return { kind: 'patch', patch: [{ op: 'remove', path: op.path }] };
    }
    case 'append-message': {
      const content = await renderValue(op.content, view, rethrow);
      const message = makeMessage(ctx, op.role, content, op.tags);
      return {
        kind: 'patch',
        patch: [{ op: 'add', path: '/messages/-', value: messageJson(message) }],
      };
    }
    case 'inject': {
      const index =
        op.position === 'start'
          ? 0
          : op.position === 'end'
            ? thread.messages.length
            : Math.min(op.position, thread.messages.length);
      const patch: PatchOperation[] = [];
      for (const [offset, injected] of op.messages.entries()) {
        const content = await renderValue(injected.content, view, rethrow, offset);
        patch.push({
          op: 'add',
          path: `/messages/${index + offset}`,
          value: messageJson(makeMessage(ctx, injected.role, content, injected.tags)),
        });
      }
      return { kind: 'patch', patch };
    }
    case 'truncate': {
      const candidates = op.where
        ? await selectIndices(thread.messages, op.where, view, rethrow)
        : thread.messages.map((_, i) => i);
      const keep = new Set<number>();
      if (op.keep.first !== undefined)
        candidates.slice(0, op.keep.first).forEach((i) => keep.add(i));
      if (op.keep.last !== undefined)
        candidates.slice(Math.max(0, candidates.length - op.keep.last)).forEach((i) => keep.add(i));
      if (op.keep.maxEstimatedTokens !== undefined) {
        let budget = op.keep.maxEstimatedTokens;
        for (const i of [...candidates].reverse()) {
          const cost = estimateMessageTokens(thread.messages[i] as Message);
          if (cost > budget) break;
          budget -= cost;
          keep.add(i);
        }
      }
      const remove = candidates.filter((i) => !keep.has(i));
      return { kind: 'patch', patch: removeIndices('/messages', remove) };
    }
    case 'drop': {
      const items = op.target === 'messages' ? thread.messages : thread.artifacts;
      const indices = await selectIndices(items, op.where, view, rethrow);
      return { kind: 'patch', patch: removeIndices(`/${op.target}`, indices) };
    }
    case 'replace': {
      const re = authored(() => compileRegex(op.pattern, op.flags), rethrow, 'regex');
      if (op.target === 'messages') {
        const indices = op.where
          ? await selectIndices(thread.messages, op.where, view, rethrow)
          : thread.messages.map((_, i) => i);
        const patch: PatchOperation[] = [];
        for (const i of indices) {
          const message = thread.messages[i] as Message;
          const next = replaceInString(message.content, re, op.replacement);
          if (next !== message.content)
            patch.push({ op: 'replace', path: `/messages/${i}/content`, value: next });
        }
        return { kind: 'patch', patch };
      }
      const nextVars = walkStrings(thread.vars, (s) =>
        replaceInString(s, re, op.replacement),
      ) as JsonValue;
      return { kind: 'patch', patch: [{ op: 'replace', path: '/vars', value: nextVars }] };
    }
    case 'redact': {
      const regexes = op.patterns.map((pattern) =>
        authored(() => compileRegex(pattern, 'g'), rethrow, 'regex'),
      );
      const redact = (s: string): string =>
        regexes.reduce((acc, re) => acc.replace(re, op.replacement), s);
      const patch: PatchOperation[] = [];
      if (op.target === 'messages' || op.target === 'all') {
        thread.messages.forEach((message, i) => {
          const next = redact(message.content);
          if (next !== message.content)
            patch.push({ op: 'replace', path: `/messages/${i}/content`, value: next });
        });
      }
      if (op.target === 'vars' || op.target === 'all') {
        const nextVars = walkStrings(thread.vars, redact) as JsonValue;
        if (JSON.stringify(nextVars) !== JSON.stringify(thread.vars)) {
          patch.push({ op: 'replace', path: '/vars', value: nextVars });
        }
      }
      return { kind: 'patch', patch };
    }
    case 'coerce': {
      authored(() => assertMutablePath(op.target), rethrow, 'target');
      const source = authored(() => getAtPointer(thread, op.source), rethrow, 'target');
      const value = source.found ? source.value : undefined;
      // An authored schema that does not compile returns as validation errors and enters repair.
      // Anything validation throws carries no authored fact; only the ordinary mapper sees it.
      let validation: SchemaValidation;
      try {
        validation = validateJson(op.jsonSchema, value);
      } catch (error) {
        return rethrow(error);
      }
      if (validation.ok) {
        const exists = authored(() => getAtPointer(thread, op.target), rethrow, 'target').found;
        return {
          kind: 'patch',
          patch: [{ op: exists ? 'replace' : 'add', path: op.target, value: asJson(value) }],
        };
      }
      return {
        kind: 'repair',
        request: {
          opIndex,
          source: op.source,
          target: op.target,
          jsonSchema: op.jsonSchema,
          repair: op.repair,
          value,
          errors: validation.errors,
        },
      };
    }
  }
}

/**
 * Apply a list of operations in order. Stops at the first coerce that needs repair and reports
 * it in `pending` with `appliedThrough` pointing at that operation, so the engine can repair
 * and resume from there.
 */
export async function applyMutations(
  thread: ContextThread,
  ops: readonly MutationOperation[],
  ctx: MutationContext,
  startAt = 0,
  mapFailure?: MutationFailureMapper,
  mapFact?: MutationFactMapper,
): Promise<MutationResult> {
  let current = thread;
  const combined: PatchOperation[] = [];
  for (let i = startAt; i < ops.length; i += 1) {
    const op = ops[i] as MutationOperation;
    const plan = await planMutation(current, op, ctx, i, mapFailure, mapFact);
    if (plan.kind === 'repair') {
      return { thread: current, patch: combined, pending: plan.request, appliedThrough: i };
    }
    try {
      current = applyPatch(current, plan.patch);
    } catch (error) {
      if (mapFact && error instanceof PatchError) throw mapFact({ kind: 'patch' }, i, op.op);
      throw mapFailure ? mapFailure(error, i, op.op) : error;
    }
    combined.push(...plan.patch);
  }
  return { thread: current, patch: combined, appliedThrough: ops.length };
}

/** Write a repaired value to its target, producing the patch the engine records. */
export function completeRepair(
  thread: ContextThread,
  request: RepairRequest,
  repaired: JsonValue,
): { thread: ContextThread; patch: JsonPatch } {
  const validation = validateJson(request.jsonSchema, repaired);
  if (!validation.ok) {
    throw new MutationError(`repaired value still fails schema: ${validation.errors.join('; ')}`, {
      errors: validation.errors,
    });
  }
  const exists = getAtPointer(thread, request.target).found;
  const patch: JsonPatch = [
    { op: exists ? 'replace' : 'add', path: request.target, value: repaired },
  ];
  return { thread: applyPatch(thread, patch), patch };
}
