import type {
  ContextThread,
  JsonValue,
  Message,
  MessageRole,
  MessageSelection,
  CollectionSelection,
  NodeOutput,
  PatchOperation,
  Usage,
  JsonSchema,
  RepairPolicy,
  Effort,
} from '@graphgoblin/contracts';
import {
  evaluatePredicate,
  formatPointer,
  renderTemplate,
  threadView,
  validateJson,
  type MutationContext,
  type RepairRequest,
} from '@graphgoblin/domain';
import { applyMutations, completeRepair, applyPatch } from '@graphgoblin/domain';
import type { MutationOperation, NodeKind } from '@graphgoblin/contracts';
import { RunFailureError } from '../errors.js';
import type { NodeContext } from '../handler.js';

export function toJson(value: unknown): JsonValue {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

/** Try to parse text as JSON; return the text itself when it is not JSON. */
export function jsonOrText(text: string): JsonValue {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  try {
    return JSON.parse(trimmed) as JsonValue;
  } catch {
    return text;
  }
}

/** Patch operations that record a node's output in `/outputs/<nodeId>` and `/lastOutput`. */
export function outputPatch(
  thread: ContextThread,
  nodeId: string,
  value: JsonValue,
  at: string,
  schemaRef?: string,
): PatchOperation[] {
  const output: NodeOutput = { nodeId, value, at, ...(schemaRef ? { schemaRef } : {}) };
  const outputJson = toJson(output);
  return [
    {
      op: Object.prototype.hasOwnProperty.call(thread.outputs, nodeId) ? 'replace' : 'add',
      path: formatPointer(['outputs', nodeId]),
      value: outputJson,
    },
    { op: thread.lastOutput ? 'replace' : 'add', path: '/lastOutput', value: outputJson },
  ];
}

export function messagePatch(message: Message): PatchOperation {
  return { op: 'add', path: '/messages/-', value: toJson(message) };
}

export function makeMessage<K extends NodeKind>(
  ctx: NodeContext<K>,
  role: MessageRole,
  content: string,
  tags?: string[],
): Message {
  return {
    id: ctx.services.newId(),
    role,
    content,
    nodeId: ctx.node.id,
    ts: ctx.services.now(),
    ...(tags ? { tags } : {}),
  };
}

export function addUsage(a: Usage, b: Partial<Usage>): Usage {
  return {
    inputTokens: a.inputTokens + (b.inputTokens ?? 0),
    outputTokens: a.outputTokens + (b.outputTokens ?? 0),
    cachedInputTokens: a.cachedInputTokens + (b.cachedInputTokens ?? 0),
    reasoningOutputTokens: a.reasoningOutputTokens + (b.reasoningOutputTokens ?? 0),
  };
}

export function usagePatch(thread: ContextThread, usage: Partial<Usage>): PatchOperation[] {
  return [
    {
      op: 'replace',
      path: '/counters/usage',
      value: toJson(addUsage(thread.counters.usage, usage)),
    },
  ];
}

export async function selectMessages(
  messages: readonly Message[],
  selection: MessageSelection | undefined,
  view: Record<string, unknown>,
): Promise<Message[]> {
  if (selection === undefined || selection === 'all') return [...messages];
  if (selection === 'none') return [];
  if (selection === 'last')
    return messages.length ? [messages[messages.length - 1] as Message] : [];
  if (typeof selection === 'number')
    return messages.slice(Math.max(0, messages.length - selection));
  const out: Message[] = [];
  for (const [index, message] of messages.entries()) {
    if (await evaluatePredicate(selection.where, message, { bindings: { thread: view, index } }))
      out.push(message);
  }
  return out;
}

export async function selectCollection<T>(
  items: readonly T[],
  selection: CollectionSelection | undefined,
  view: Record<string, unknown>,
): Promise<T[]> {
  if (selection === undefined || selection === 'all') return [...items];
  if (selection === 'none') return [];
  const out: T[] = [];
  for (const [index, item] of items.entries()) {
    if (await evaluatePredicate(selection.where, item, { bindings: { thread: view, index } }))
      out.push(item);
  }
  return out;
}

export function mutationContext<K extends NodeKind>(ctx: NodeContext<K>): MutationContext {
  return { nodeId: ctx.node.id, newId: () => ctx.services.newId(), now: () => ctx.services.now() };
}

/** Combine the run's abort signal with an optional timeout. */
export function withTimeout(
  signal: AbortSignal,
  timeoutSeconds: number | undefined,
  onTimeout: () => Error,
): { signal: AbortSignal; dispose: () => void; timedOut: () => boolean } {
  if (timeoutSeconds === undefined)
    return { signal, dispose: () => undefined, timedOut: () => false };
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(onTimeout());
  }, timeoutSeconds * 1000);
  const forward = (): void => controller.abort(signal.reason);
  if (signal.aborted) forward();
  else signal.addEventListener('abort', forward, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', forward);
    },
    timedOut: () => timedOut,
  };
}

export const DEFAULT_REPAIR_PROMPT = [
  'A value was expected to match a JSON Schema but did not.',
  'Return only a corrected JSON value that satisfies the schema. Do not explain.',
  '',
  'Schema:',
  '{{ schema }}',
  '',
  'Value:',
  '{{ value }}',
  '',
  'Validation errors:',
  '{% for e in errors %}- {{ e }}',
  '{% endfor %}',
].join('\n');

/**
 * Repair a value through the structured-completion port until it satisfies the schema or the
 * policy is exhausted. Returns the repaired value, the raw value when `continue-raw` applies,
 * or throws OUTPUT_SCHEMA_MISMATCH.
 */
export async function repairValue<K extends NodeKind>(
  ctx: NodeContext<K>,
  input: {
    value: unknown;
    schema: JsonSchema;
    errors: string[];
    repair: RepairPolicy;
    model?: string;
    effort?: Effort;
  },
): Promise<{ value: JsonValue; repaired: boolean }> {
  const { repair } = input;
  let errors = input.errors;
  if (repair.enabled && repair.maxAttempts > 0) {
    const structured = ctx.ports.structured;
    if (!structured) {
      throw new RunFailureError(
        'DECIDER_UNAVAILABLE',
        'schema repair needs a structured completion provider and none is configured',
        { nodeId: ctx.node.id },
      );
    }
    const { model, effort } = ctx.services.resolveModel(input.model, input.effort);
    for (let attempt = 1; attempt <= repair.maxAttempts; attempt += 1) {
      const prompt = await renderTemplate(repair.prompt ?? DEFAULT_REPAIR_PROMPT, {
        ...threadView(ctx.thread),
        schema: JSON.stringify(input.schema, null, 2),
        value: JSON.stringify(input.value ?? null, null, 2),
        errors,
        attempt,
      });
      const completion = await structured.complete(
        { prompt, schema: input.schema, model, effort },
        ctx.signal,
      );
      const validation = validateJson(input.schema, completion.value);
      if (validation.ok) return { value: toJson(completion.value), repaired: true };
      errors = validation.errors;
    }
  }
  if (repair.onFailure === 'continue-raw') return { value: toJson(input.value), repaired: false };
  throw new RunFailureError(
    'OUTPUT_SCHEMA_MISMATCH',
    `value does not match the required schema: ${errors.join('; ')}`,
    {
      nodeId: ctx.node.id,
      details: { errors, value: toJson(input.value) },
    },
  );
}

/** Run a mutation list, repairing coerce failures through the structured port as the policy allows. */
export async function runMutations<K extends NodeKind>(
  ctx: NodeContext<K>,
  thread: ContextThread,
  ops: readonly MutationOperation[],
): Promise<{ thread: ContextThread; patch: PatchOperation[] }> {
  const mctx = mutationContext(ctx);
  let current = thread;
  const patch: PatchOperation[] = [];
  let startAt = 0;
  for (;;) {
    const result = await applyMutations(current, ops, mctx, startAt);
    current = result.thread;
    patch.push(...result.patch);
    if (!result.pending) return { thread: current, patch };
    const pending: RepairRequest = result.pending;
    const repaired = await repairValue(ctx, {
      value: pending.value,
      schema: pending.jsonSchema,
      errors: pending.errors,
      repair: pending.repair,
    });
    if (repaired.repaired) {
      const done = completeRepair(current, pending, repaired.value);
      current = done.thread;
      patch.push(...done.patch);
    } else {
      const op: PatchOperation = {
        op: hasPath(current, pending.target) ? 'replace' : 'add',
        path: pending.target,
        value: repaired.value,
      };
      current = applyPatch(current, [op]);
      patch.push(op);
    }
    startAt = pending.opIndex + 1;
  }
}

/** Whether a JSON pointer resolves inside a document. Exported for tests. */
export function hasPath(doc: unknown, pointer: string): boolean {
  let current: unknown = doc;
  for (const token of pointer
    .split('/')
    .slice(1)
    .map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (Array.isArray(current)) {
      const i = Number(token);
      if (!Number.isInteger(i) || i >= current.length) return false;
      current = current[i];
    } else if (current && typeof current === 'object') {
      if (!Object.prototype.hasOwnProperty.call(current, token)) return false;
      current = (current as Record<string, unknown>)[token];
    } else {
      return false;
    }
  }
  return true;
}
