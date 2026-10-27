import {
  COMMAND_PREVIEW_MAX,
  type JsonValue,
  type ProgressItemStatus,
  type Usage,
} from '@graphgoblin/contracts';
import type {
  HarnessFailureEvidence,
  HarnessEvent,
  HarnessItem,
  HarnessItemType,
} from '@graphgoblin/engine';
import {
  describeError,
  isHarnessFailureCode,
  harnessFailureEvidence,
  harnessFailureRank,
  mergeHarnessFailure,
} from '@graphgoblin/engine';
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

export interface ClassifiedError extends HarnessFailureEvidence {
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
interface Unwrapped {
  status?: number;
  type?: string;
  param?: string;
  refused?: true;
  /** The text was a JSON provider error: an object with an `error` object or a numeric `status`. */
  structured?: true;
  message: string;
}

function unwrap(raw: string): Unwrapped {
  try {
    const parsed = JSON.parse(raw) as {
      status?: unknown;
      error?: { type?: unknown; message?: unknown; code?: unknown; param?: unknown };
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
        ...(typeof inner.param === 'string' && inner.param ? { param: inner.param } : {}),
        // The provider's explicit refusal of the request itself: HTTP 400 `invalid_request_error`.
        ...(parsed.status === 400 && inner.type === 'invalid_request_error'
          ? { refused: true as const }
          : {}),
        ...((typeof parsed.error === 'object' && parsed.error !== null) ||
        typeof parsed.status === 'number'
          ? { structured: true as const }
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
 * The error `@openai/codex-sdk` 0.160.0 throws when the CLI exits non-zero or on a signal, after
 * the event stream has ended (`CodexExec.run`): a plain `Error`, without typed metadata, whose
 * message is `Codex Exec exited with code <n>: <stderr>` or `… with signal <name>: <stderr>`.
 */
const PROCESS_EXIT_MESSAGE = /^Codex Exec exited with (?:code -?\d+|signal [A-Z0-9]+): /;

function isProcessExitWrapper(error: unknown): error is Error {
  return (
    error instanceof Error &&
    Object.getPrototypeOf(error) === Error.prototype &&
    !('code' in error) &&
    PROCESS_EXIT_MESSAGE.test(error.message)
  );
}

/** The CLI's stderr that the SDK's process-exit error carries after its fixed prefix. */
function exitWrapperPayload(error: Error): string {
  return error.message.replace(PROCESS_EXIT_MESSAGE, '');
}

/**
 * A structured provider error the CLI repeated on stderr, which the SDK's exit error carries after
 * its prefix (PR #426 audit scan 2). The whole payload is tried first, then each line from the last,
 * so a startup banner before the JSON does not hide it. Classifying from this structure, not from
 * the prefixed text, keeps a provider refusal from reaching the message heuristics.
 */
function wrappedProviderError(error: unknown): Unwrapped | undefined {
  if (!isProcessExitWrapper(error)) return undefined;
  const payload = exitWrapperPayload(error);
  for (const candidate of [payload, ...payload.split(/\r?\n/).reverse()]) {
    const text = candidate.trim();
    if (!text) continue;
    const unwrapped = unwrap(text);
    if (unwrapped.structured) return unwrapped;
  }
  return undefined;
}

/** A structured provider error on one stderr line, whole or after a prefix such as `ERROR: `. */
function lineProviderError(line: string): string | undefined {
  if (unwrap(line).structured) return line;
  const start = line.indexOf('{');
  const end = line.lastIndexOf('}');
  const inner = start > 0 && end > start ? line.slice(start, end + 1) : '';
  return inner && unwrap(inner).structured ? inner : undefined;
}

/**
 * Each piece of evidence in the stderr the SDK's exit error carries, classified on its own (PR #426
 * audit scan 3): a stderr that is one structured provider error as a whole, or else every line,
 * read from the structured provider error it holds when it holds one and as text otherwise. A
 * repeat of the stream's failure and a distinct cause beside it can then be told apart.
 */
function stderrEvidence(error: Error): ClassifiedError[] {
  const payload = exitWrapperPayload(error).trim();
  if (payload && unwrap(payload).structured) return [classifyCodexError(payload)];
  return payload
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => classifyCodexError(lineProviderError(line) ?? line));
}

/** Preserve recognized typed SDK failures; classify untyped failures from native messages. */
export function classifyCodexError(error: unknown): ClassifiedError {
  const metadata = harnessFailureEvidence(error);
  return {
    ...classifyNativeError(error),
    ...(metadata.submission ? { submission: metadata.submission } : {}),
  };
}

function classifyNativeError(error: unknown): ClassifiedError {
  // SDK factories can reject with typed metadata at either async boundary. Do not reduce
  // that evidence to a message; unknown codes still use native-message classification.
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    isHarnessFailureCode(error.code)
  ) {
    return {
      code: error.code,
      message: describeError(error),
      retriable: 'retriable' in error && error.retriable === true,
    };
  }
  const raw = describeError(error);
  const { status, type, param, refused, message } = wrappedProviderError(error) ?? unwrap(raw);
  // The provider refused the turn's request as invalid, for example an effort the model does not
  // accept (final integrated check F2, LP-5). Model, effort, options, schema and prompt all come
  // from the run's pinned definition, so the same request is refused again: a pinned argument
  // refusal, never resumable (#243, #244). The structured status and type decide this before any
  // message heuristic below, whatever the provider's text says, and its message is kept.
  if (refused)
    return {
      code: 'HARNESS_ARGUMENTS_REJECTED',
      message: `The provider refused the request (HTTP 400${param ? `, ${param}` : ''}): ${message}`,
      retriable: false,
    };
  const text = `${type ?? ''} ${message}`.toLowerCase();
  if (/error: (?:unexpected argument|unknown option|invalid value)/.test(text))
    return {
      code: 'HARNESS_ARGUMENTS_REJECTED',
      message: 'Codex rejected the turn arguments',
      retriable: false,
    };
  if (
    /(?:no rollout found|session (?:not found|does not exist)|thread (?:not found|does not exist)|failed to (?:load|find) (?:session|rollout))/.test(
      text,
    )
  )
    return {
      code: 'HARNESS_SESSION_MISSING',
      message: 'The recorded Codex conversation was not found',
      retriable: false,
    };
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
  return {
    code: transient ? 'HARNESS_TRANSPORT_FAILED' : 'HARNESS_TURN_FAILED',
    message,
    retriable: transient,
  };
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
 *   failure. `turn.failed` is the failure signal. Top-level errors, `turn.failed` and thrown failures share the evidence precedence;
 *   successful turns tolerate nonfatal top-level diagnostics.
 * - The SDK's process-exit error (`Codex Exec exited with code 1: <stderr>`) only wraps a failure
 *   the stream already reported, and the CLI's stderr is usually just its startup banner. Once the
 *   stream has reported an error or `turn.failed` for an unfinished turn, that exact wrapper never
 *   replaces the stream's evidence while it classifies as generic (lowest rank). Every other
 *   thrown error, such as a protocol parse failure, joins the fold as usual. The wrapper's stderr
 *   is compared piece by piece (each line, read from the provider error it holds when it holds
 *   one): a piece that exactly repeats evidence the stream reported (code, message, retry and
 *   submission) adds nothing, while every other typed piece joins the fold in order, so a
 *   distinct cause beside a repeat still counts (PR #426 audit scans 2 and 3). This holds while
 *   the stream's evidence is fatal, even after `turn.completed`.
 */
export class TurnAccumulator {
  private submitted = false;
  private finalText = '';
  private usage: Usage = ZERO_USAGE;
  private readonly items: HarnessItem[] = [];
  private failure: ClassifiedError | undefined;
  private fatal = false;
  private completed = false;
  /** What the stream itself reported as failing: each classification and structured text. */
  private readonly streamReports: ClassifiedError[] = [];
  /** The stream reported `turn.failed` or a terminal/pinned error, so the turn failed. */
  private streamFatal = false;
  sessionId: string | undefined;

  constructor(private readonly mode: 'fresh' | 'resumed') {}

  push(event: ThreadEvent | { type: string }): HarnessEvent[] {
    const ev = event as ThreadEvent;
    switch (ev.type) {
      case 'thread.started':
        this.sessionId = ev.thread_id;
        return [{ type: 'session', sessionId: ev.thread_id, mode: this.mode }];
      case 'turn.started':
        if (this.submitted) return [];
        this.submitted = true;
        return [{ type: 'submitted', marker: 'codex.turn.started' }];
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
        this.add(this.report(ev.error, true), false);
        return [];
      case 'error':
        // Native top-level errors and turn.failed use the same evidence fold. A completed
        // turn may tolerate diagnostics, but terminal/pinned refusals are not diagnostics.
        this.add(this.report(ev, false), true);
        return [];
      default:
        return [];
    }
  }

  /** Classify a failure the stream reported and remember it, to recognise a later repeat. */
  private report(error: unknown, failed: boolean): ClassifiedError {
    const classified = classifyCodexError(error);
    this.streamReports.push(classified);
    this.streamFatal ||= failed || harnessFailureRank(classified) >= 4;
    return classified;
  }

  /** Exactly the evidence the stream already reported: code, message, retry and submission. */
  private repeatsStream(piece: ClassifiedError): boolean {
    return this.streamReports.some(
      (reported) =>
        reported.code === piece.code &&
        reported.message === piece.message &&
        reported.retriable === piece.retriable &&
        reported.submission === piece.submission,
    );
  }

  /**
   * Whether the stream itself reported this turn's failure: fatal evidence such as `turn.failed`
   * or a pinned refusal, whatever the completion flag says, or any reported error of an unfinished
   * turn.
   */
  private streamFailed(): boolean {
    return this.streamFatal || (!this.completed && this.streamReports.length > 0);
  }

  /** Record a failure raised outside the event stream (a thrown SDK or process error). */
  fail(error: unknown): void {
    if (!isProcessExitWrapper(error)) {
      // Any other thrown error, such as a protocol parse failure, is evidence of its own.
      this.add(classifyCodexError(error), false);
      return;
    }
    // The SDK's exit error carries the CLI's stderr. Each typed cause there that the stream did
    // not already report joins the fold in order, so ranking and the later-observation rule
    // apply to it; an exact repeat of the stream's evidence adds nothing (#243).
    const fresh = stderrEvidence(error).filter(
      (piece) => harnessFailureRank(piece) > 1 && !this.repeatsStream(piece),
    );
    for (const piece of fresh) this.add(piece, false);
    if (fresh.length) return;
    if (this.streamFailed()) {
      // A generic wrapper of the failure the stream reported: the process failed, nothing more.
      this.fatal = true;
      return;
    }
    this.add(classifyCodexError(error), false);
  }

  private add(next: ClassifiedError, diagnostic: boolean): void {
    this.failure = mergeHarnessFailure(this.failure, next);
    this.fatal ||= !diagnostic || harnessFailureRank(next) >= 4;
  }

  finish(): TurnOutcome {
    const failure =
      this.completed && !this.fatal
        ? undefined
        : (this.failure ??
          (!this.completed
            ? classifyCodexError('the Codex event stream ended before the turn completed')
            : undefined));
    return {
      finalText: this.finalText,
      usage: this.usage,
      items: [...this.items],
      completed: this.completed && !failure,
      ...(failure ? { failure } : {}),
    };
  }
}
