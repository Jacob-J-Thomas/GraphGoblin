import {
  COMMAND_PREVIEW_MAX,
  type JsonValue,
  type ProgressItemStatus,
  type Usage,
} from '@graphgoblin/contracts';
import type { HarnessEvent, HarnessItem, HarnessItemType } from '@graphgoblin/engine';
import type { ThreadEvent, ThreadItem } from '@openai/codex-sdk';

/**
 * Translation from Codex's JSONL thread events (as typed by `@openai/codex-sdk`) to the engine's
 * `HarnessEvent` model. Pure functions plus one small accumulator; no I/O. See
 * docs/06-harness-integration.md and docs/research/codex-sdk.md for the verified event shapes.
 */

const SUMMARY_MAX = 200;
/** Command output kept in an item's `detail`; transcripts store items, so cap what they carry. */
const OUTPUT_MAX = 16 * 1024;

export const ZERO_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  reasoningOutputTokens: 0,
};

const ITEM_TYPES: Record<string, HarnessItemType> = {
  agent_message: 'message',
  reasoning: 'reasoning',
  command_execution: 'command',
  file_change: 'file-change',
  mcp_tool_call: 'tool-call',
  web_search: 'search',
  error: 'error',
};

/** Collapse whitespace to one line and cap the length. */
export function oneLine(text: string, max = SUMMARY_MAX): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 3)}...` : line;
}

type LooseItem = ThreadItem | ({ id: string; type: string } & Record<string, unknown>);

function summarize(item: LooseItem): string {
  const it = item as Record<string, unknown> & { type: string };
  const str = (key: string): string => (typeof it[key] === 'string' ? it[key] : '');
  switch (it.type) {
    case 'agent_message':
    case 'reasoning':
      return oneLine(str('text'));
    case 'command_execution': {
      const exit = typeof it.exit_code === 'number' ? ` (exit ${it.exit_code})` : '';
      return oneLine(`${str('command')}${exit}`);
    }
    case 'file_change': {
      const changes = Array.isArray(it.changes)
        ? (it.changes as { kind?: unknown; path?: unknown }[])
        : [];
      const text = changes.map((c) => `${String(c.kind)} ${String(c.path)}`).join(', ');
      return oneLine(it.status === 'failed' ? `${text} (failed)` : text);
    }
    case 'mcp_tool_call': {
      const error = it.error as { message?: unknown } | undefined;
      const suffix = error ? ` failed: ${String(error.message)}` : '';
      return oneLine(`${str('server')}.${str('tool')}${suffix}`);
    }
    case 'web_search':
      return oneLine(str('query'));
    case 'error':
      return oneLine(str('message'));
    case 'todo_list': {
      const items = Array.isArray(it.items) ? (it.items as { completed?: unknown }[]) : [];
      const done = items.filter((t) => t.completed === true).length;
      return `todo list: ${done}/${items.length} done`;
    }
    default:
      return it.type;
  }
}

/** Preserve allowlisted SDK state and keep command progress fields independent of the summary. */
function itemMetadata(
  item: LooseItem,
): Pick<HarnessItem, 'commandPreview' | 'exitCode' | 'status'> {
  const raw = item as Record<string, unknown>;
  const command = typeof raw.command === 'string' ? raw.command : '';
  const isCommand = item.type === 'command_execution';
  const exitCode =
    isCommand && typeof raw.exit_code === 'number' && Number.isInteger(raw.exit_code)
      ? raw.exit_code
      : undefined;
  const status: ProgressItemStatus | undefined =
    raw.status === 'failed' || (exitCode !== undefined && exitCode !== 0)
      ? 'failed'
      : raw.status === 'completed' || exitCode === 0
        ? 'ok'
        : raw.status === 'in_progress' || raw.status === 'running'
          ? 'running'
          : isCommand
            ? 'running'
            : undefined;
  return {
    ...(isCommand ? { commandPreview: oneLine(command, COMMAND_PREVIEW_MAX) } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(status !== undefined ? { status } : {}),
  };
}

/** Convert a value to JSON, dropping anything that does not survive a round trip. */
function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

/** Map one Codex item to a `HarnessItem` with a one-line summary and the raw item as `detail`. */
export function normalizeItem(item: LooseItem): HarnessItem {
  const raw = { ...(item as Record<string, unknown>) };
  if (typeof raw.aggregated_output === 'string' && raw.aggregated_output.length > OUTPUT_MAX) {
    raw.aggregated_output = `${raw.aggregated_output.slice(0, OUTPUT_MAX)}\n[truncated]`;
  }
  return {
    id: item.id,
    type: ITEM_TYPES[item.type] ?? 'other',
    summary: summarize(item),
    ...itemMetadata(item),
    detail: toJson(raw),
  };
}

/** Codex's snake_case usage to the contract's camelCase `Usage`. Missing counters are zero. */
export function mapUsage(usage: Partial<Record<string, unknown>> | null | undefined): Usage {
  const n = (key: string): number => {
    const v = usage?.[key];
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : 0;
  };
  return {
    inputTokens: n('input_tokens'),
    outputTokens: n('output_tokens'),
    cachedInputTokens: n('cached_input_tokens'),
    reasoningOutputTokens: n('reasoning_output_tokens'),
  };
}

export interface ClassifiedError {
  /** One of the `HARNESS_*` codes below; the engine's `classifyHarnessError` keys off them. */
  code: string;
  message: string;
  retriable: boolean;
}

/**
 * Codex reports API failures as a message that is often itself JSON, for example
 * `{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"..."}}`.
 * Unwrap it so the code and message are useful.
 */
function unwrap(raw: string): { status?: number; type?: string; message: string } {
  try {
    const parsed = JSON.parse(raw) as {
      status?: unknown;
      error?: { type?: unknown; message?: unknown; code?: unknown };
      message?: unknown;
    };
    if (parsed && typeof parsed === 'object') {
      const inner = parsed.error ?? {};
      const message =
        typeof inner.message === 'string'
          ? inner.message
          : typeof parsed.message === 'string'
            ? parsed.message
            : raw;
      return {
        ...(typeof parsed.status === 'number' ? { status: parsed.status } : {}),
        ...(typeof inner.type === 'string'
          ? { type: inner.type }
          : typeof inner.code === 'string'
            ? { type: inner.code }
            : {}),
        message,
      };
    }
  } catch {
    // not JSON
  }
  return { message: raw };
}

/**
 * Classify a Codex failure. Codes are chosen so the engine's `classifyHarnessError` maps them:
 * anything containing `quota` becomes `HARNESS_QUOTA_EXHAUSTED`, anything containing `auth`
 * becomes `HARNESS_NOT_AUTHENTICATED`, everything else `HARNESS_TURN_FAILED`.
 */
export function classifyCodexError(raw: string): ClassifiedError {
  const { status, type, message } = unwrap(raw);
  const text = `${type ?? ''} ${message}`.toLowerCase();
  if (
    status === 429 ||
    /usage[_ ]limit|quota|rate[_ ]limit|too many requests|insufficient_quota/.test(text)
  ) {
    // Rate limits clear on their own; an exhausted subscription quota does not within a run.
    const retriable = !/usage[_ ]limit|quota/.test(text);
    return { code: 'HARNESS_QUOTA_EXHAUSTED', message, retriable };
  }
  if (
    status === 401 ||
    status === 403 ||
    /not logged in|unauthori[sz]ed|authenticat|login|invalid api key|token (has )?expired/.test(
      text,
    )
  ) {
    return { code: 'HARNESS_NOT_AUTHENTICATED', message, retriable: false };
  }
  if (/enoent|not recognized as an internal|unable to locate codex/.test(text)) {
    return { code: 'HARNESS_NOT_INSTALLED', message, retriable: false };
  }
  const transient =
    (status !== undefined && status >= 500) ||
    /stream disconnected|timed? ?out|econnreset|network|overloaded|temporarily unavailable/.test(
      text,
    );
  return { code: 'HARNESS_TURN_FAILED', message, retriable: transient };
}

export interface TurnOutcome {
  finalText: string;
  usage: Usage;
  items: HarnessItem[];
  /** Set when the turn failed (`turn.failed`, or a fatal stream error with no completion). */
  failure?: ClassifiedError;
  completed: boolean;
}

/**
 * Stateful translation of one turn's event stream. `push` returns the `HarnessEvent`s to emit for
 * each Codex event; `finish` closes the turn and reports the outcome.
 *
 * - `thread.started` becomes a `session` event, immediately, so the engine can persist the id.
 * - Items are emitted on `item.completed` only; `item.started` and `item.updated` are progress
 *   noise for a node-level view and would duplicate entries.
 * - An `error` item (for example a configuration deprecation warning) is a normal item, not a
 *   failure. `turn.failed` is the failure signal. A top-level `error` event is remembered and only
 *   counts as the failure if the turn never completes (Codex also emits it before `turn.failed`).
 */
export class TurnAccumulator {
  private finalText = '';
  private usage: Usage = ZERO_USAGE;
  private readonly items: HarnessItem[] = [];
  private failure: ClassifiedError | undefined;
  private streamError: string | undefined;
  private completed = false;
  sessionId: string | undefined;

  constructor(private readonly mode: 'fresh' | 'resumed') {}

  push(event: ThreadEvent | { type: string }): HarnessEvent[] {
    const ev = event as ThreadEvent;
    switch (ev.type) {
      case 'thread.started':
        this.sessionId = ev.thread_id;
        return [{ type: 'session', sessionId: ev.thread_id, mode: this.mode }];
      case 'item.completed': {
        const item = normalizeItem(ev.item);
        this.items.push(item);
        if (ev.item.type === 'agent_message') this.finalText = ev.item.text;
        return [{ type: 'item', item }];
      }
      case 'turn.completed':
        this.completed = true;
        this.usage = mapUsage(ev.usage);
        return [{ type: 'usage', usage: this.usage }, { type: 'turn-complete' }];
      case 'turn.failed':
        this.failure = classifyCodexError(ev.error.message);
        return [];
      case 'error':
        this.streamError = ev.message;
        return [];
      default:
        return [];
    }
  }

  /** Record a failure raised outside the event stream (a thrown SDK or process error). */
  fail(message: string): void {
    this.failure ??= classifyCodexError(message);
  }

  finish(): TurnOutcome {
    let failure = this.failure;
    if (!failure && !this.completed) {
      failure = classifyCodexError(
        this.streamError ?? 'the Codex event stream ended before the turn completed',
      );
    }
    return {
      finalText: this.finalText,
      usage: this.usage,
      items: [...this.items],
      completed: this.completed && !failure,
      ...(failure ? { failure } : {}),
    };
  }
}
