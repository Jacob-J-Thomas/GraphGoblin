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
import { MutationError } from './errors.js';
import { evaluateExpression, evaluatePredicate } from './expression.js';
import { validateJson } from './json-schema.js';
import { applyPatch } from './patch.js';
import { getAtPointer, pointerStartsWith } from './pointer.js';
import { unsafeRegexReason } from './regex-safety.js';
import { renderTemplate } from './template.js';
import { estimateMessageTokens, threadView } from './thread-view.js';

/** Regions of the thread that mutation operations may write. The engine owns the rest. */
export const MUTABLE_REGIONS = [
  '/vars',
  '/messages',
  '/artifacts',
  '/outputs',
  '/lastOutput',
] as const;

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

export interface MutationResult {
  thread: ContextThread;
  patch: JsonPatch;
  /** Set when a coerce operation needs the engine to repair before continuing. */
  pending?: RepairRequest;
  /** Index of the first operation not yet applied (equals ops.length when complete). */
  appliedThrough: number;
}

function assertMutable(path: string): void {
  if (!MUTABLE_REGIONS.some((region) => pointerStartsWith(path, region))) {
    throw new MutationError(
      `path "${path}" is not in a mutable region (${MUTABLE_REGIONS.join(', ')})`,
    );
  }
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
): Promise<JsonValue> {
  switch (source.kind) {
    case 'literal':
      return source.value;
    case 'template':
      return renderTemplate(source.template, view);
    case 'expression':
      return asJson(await evaluateExpression(source.jsonata, view));
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
): Promise<number[]> {
  const out: number[] = [];
  for (const [index, item] of items.entries()) {
    if (await evaluatePredicate(where, item, { bindings: { thread: view, index } }))
      out.push(index);
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
): Promise<MutationPlan> {
  const view = threadView(thread) as unknown as Record<string, unknown>;

  switch (op.op) {
    case 'set': {
      assertMutable(op.path);
      const value = await resolveValue(op.value, view);
      const exists = getAtPointer(thread, op.path).found;
      return { kind: 'patch', patch: [{ op: exists ? 'replace' : 'add', path: op.path, value }] };
    }
    case 'delete': {
      assertMutable(op.path);
      if (!getAtPointer(thread, op.path).found) return { kind: 'patch', patch: [] };
      return { kind: 'patch', patch: [{ op: 'remove', path: op.path }] };
    }
    case 'append-message': {
      const content = await renderTemplate(op.content, view);
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
        const content = await renderTemplate(injected.content, view);
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
        ? await selectIndices(thread.messages, op.where, view)
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
      const indices = await selectIndices(items, op.where, view);
      return { kind: 'patch', patch: removeIndices(`/${op.target}`, indices) };
    }
    case 'replace': {
      const re = compileRegex(op.pattern, op.flags);
      if (op.target === 'messages') {
        const indices = op.where
          ? await selectIndices(thread.messages, op.where, view)
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
      const regexes = op.patterns.map((p) => compileRegex(p, 'g'));
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
      assertMutable(op.target);
      const source = getAtPointer(thread, op.source);
      const value = source.found ? source.value : undefined;
      const validation = validateJson(op.jsonSchema, value);
      if (validation.ok) {
        const exists = getAtPointer(thread, op.target).found;
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
): Promise<MutationResult> {
  let current = thread;
  const combined: PatchOperation[] = [];
  for (let i = startAt; i < ops.length; i += 1) {
    const op = ops[i] as MutationOperation;
    const plan = await planMutation(current, op, ctx, i);
    if (plan.kind === 'repair') {
      return { thread: current, patch: combined, pending: plan.request, appliedThrough: i };
    }
    current = applyPatch(current, plan.patch);
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
