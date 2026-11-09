import { randomBytes } from 'node:crypto';
import { ollamaPolicyIssues, type OllamaConnection, type Usage } from '@graphgoblin/contracts';
import { readinessFailure } from '@graphgoblin/domain';
import type {
  HarnessEvent,
  HarnessItem,
  HarnessPort,
  HarnessPreflight,
  HarnessResult,
  HarnessSession,
  HarnessStartRequest,
} from '@graphgoblin/engine';
import { EventQueue } from '../claude/queue.js';
import {
  aborted,
  httpFailure,
  object,
  OllamaError,
  protocolError,
  requestJson,
  type OllamaFetch,
} from './http.js';
import {
  contextProfile,
  contextRuntimeVersion,
  contextOverflow,
  OLLAMA_CONTEXT_PROFILE,
} from './context.js';
import { OLLAMA_OFF_REASON, type OllamaDiscoveredModel } from './types.js';

export interface OllamaHarnessOptions {
  snapshot(): Promise<{ connection: OllamaConnection; models: OllamaDiscoveredModel[] }>;
  fetcher?: OllamaFetch;
  /** Final dispatch check and owner-disable signal; URL edits never retarget dispatched turns. */
  guard?: (connection: OllamaConnection) => Promise<{ signal: AbortSignal; check(): void }>;
  /** Local correlation handle only; never a resumable provider conversation. */
  sessionId?: () => string;
}
function correlationId(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let value = (BigInt(Date.now()) << 80n) | BigInt(`0x${randomBytes(10).toString('hex')}`);
  let id = '';
  for (let i = 0; i < 26; i += 1) {
    id = alphabet[Number(value & 31n)] + id;
    value >>= 5n;
  }
  return `ollama:${id}`;
}
function count(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw protocolError();
  return value;
}
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_LINE_BYTES = 1024 * 1024;
export class OllamaHarness implements HarnessPort {
  readonly id = 'ollama' as const;
  private readonly fetcher: OllamaFetch;
  private readonly runtimeProbes = new Map<string, Promise<unknown>>();
  private readonly contextProfiles = new Map<
    string,
    {
      expires: number;
      promise: Promise<ReturnType<typeof contextProfile>>;
      settled: boolean;
    }
  >();
  constructor(private readonly options: OllamaHarnessOptions) {
    this.fetcher = options.fetcher ?? fetch;
  }
  async preflight(): Promise<HarnessPreflight> {
    let ownerSignal: AbortSignal | undefined;
    try {
      const { connection } = await this.options.snapshot();
      if (!connection.enabled)
        return { state: 'unknown', ok: false, problems: [OLLAMA_OFF_REASON] };
      const guard = await this.options.guard?.(connection);
      ownerSignal = guard?.signal;
      guard?.check();
      const metadata = await requestJson(
        this.fetcher,
        connection.baseUrl,
        '/api/tags',
        ownerSignal ?? new AbortController().signal,
      );
      if (!object(metadata) || !Array.isArray(metadata.models)) throw protocolError();
      guard?.check();
      return { state: 'ready', ok: true, problems: [] };
    } catch (error) {
      if (
        ownerSignal?.aborted ||
        (error instanceof OllamaError && error.message === OLLAMA_OFF_REASON)
      )
        return { state: 'unknown', ok: false, problems: [OLLAMA_OFF_REASON] };
      const state =
        error instanceof OllamaError && error.code === 'HARNESS_NOT_AUTHENTICATED'
          ? 'auth'
          : error instanceof OllamaError && error.code === 'HARNESS_QUOTA_EXHAUSTED'
            ? 'quota'
            : error instanceof OllamaError &&
                ['HARNESS_PROTOCOL_ERROR', 'OLLAMA_DISCOVERY_INVALID'].includes(error.code)
              ? 'unknown'
              : 'transport';
      return readinessFailure('ollama', state);
    }
  }
  async contextWindow(request: HarnessStartRequest, signal: AbortSignal, refreshModel = false) {
    if (signal.aborted) throw aborted();
    if (request.effort !== 'none')
      throw new OllamaError(
        'HARNESS_CONTEXT_UNSUPPORTED',
        'This Ollama context profile supports explicit no-thinking mode only. Choose no thinking or another qualified harness; the requested effort was not changed.',
      );
    const { connection, models } = await this.options.snapshot();
    if (!connection.enabled)
      throw new OllamaError('HARNESS_INVALID_CONFIGURATION', OLLAMA_OFF_REASON);
    const model = models.find(
      (entry) => entry.model === request.model && entry.connectionRevision === connection.revision,
    );
    if (!model || !model.enabled || model.availability.state !== 'available')
      throw new OllamaError(
        'HARNESS_MODEL_UNAVAILABLE',
        'Ollama model is unavailable; refresh models and check the selected model',
      );
    const guard = await this.options.guard?.(connection);
    guard?.check();
    const metadataSignal = AbortSignal.any([
      AbortSignal.timeout(5000),
      ...(guard ? [guard.signal] : []),
    ]);
    const runtimeKey = `${connection.revision}:${connection.baseUrl}`;
    let runtime = this.runtimeProbes.get(runtimeKey);
    if (!runtime) {
      runtime = requestJson(this.fetcher, connection.baseUrl, '/api/version', metadataSignal);
      this.runtimeProbes.set(runtimeKey, runtime);
      const clear = () => {
        if (this.runtimeProbes.get(runtimeKey) === runtime) this.runtimeProbes.delete(runtimeKey);
      };
      void runtime.then(clear, clear);
    }
    const prepare = async () => {
      const version = await runtime;
      const runtimeVersion = contextRuntimeVersion(version);
      const key = `${connection.revision}:${model.digest}:${model.model}:${runtimeVersion}:${OLLAMA_CONTEXT_PROFILE}`;
      let cached = this.contextProfiles.get(key);
      if (!cached || cached.expires <= Date.now() || (refreshModel && cached.settled)) {
        // Coalesce model metadata by catalog digest/runtime/policy. Final dispatch refreshes
        // the live profile; every admission rechecks runtime version qualification.
        const promise = requestJson(this.fetcher, connection.baseUrl, '/api/show', metadataSignal, {
          model: model.model,
        }).then((detail) => contextProfile(detail, version));
        cached = { expires: Date.now() + 30_000, promise, settled: false };
        const entry = cached;
        void promise.then(
          () => {
            entry.settled = true;
          },
          () => undefined,
        );
        if (this.contextProfiles.size >= 256) this.contextProfiles.clear();
        this.contextProfiles.set(key, cached);
        void promise.catch(() => {
          if (this.contextProfiles.get(key)?.promise === promise) this.contextProfiles.delete(key);
        });
      }
      return cached.promise;
    };
    const prepared = prepare();
    let rejectAbort: (() => void) | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(aborted());
      signal.addEventListener('abort', rejectAbort, { once: true });
      if (signal.aborted) rejectAbort();
    });
    try {
      const profile = await Promise.race([prepared, cancelled]);
      return profile.window(request.turn.outputSchema);
    } finally {
      if (rejectAbort) signal.removeEventListener('abort', rejectAbort);
    }
  }
  start(request: HarnessStartRequest, signal: AbortSignal): HarnessSession {
    return this.session(request, signal);
  }
  resume(_sessionId: string, request: HarnessStartRequest, signal: AbortSignal): HarnessSession {
    return this.session(
      request,
      signal,
      new OllamaError(
        'HARNESS_SESSION_MISSING',
        'Ollama correlation handles cannot be resumed; explicitly start a fresh session',
        'session-missing',
      ),
    );
  }
  private session(
    request: HarnessStartRequest,
    signal: AbortSignal,
    refusal?: OllamaError,
  ): HarnessSession {
    const queue = new EventQueue<HarnessEvent>();
    const controller = new AbortController();
    let combined = AbortSignal.any([signal, controller.signal]);
    let ownerSignal: AbortSignal | undefined;
    let dispatched = false;
    const sessionId = (this.options.sessionId ?? correlationId)();
    const result = (async (): Promise<HarnessResult> => {
      try {
        if (refusal) throw refusal;
        if (combined.aborted) throw aborted();
        const issues = ollamaPolicyIssues({
          session: { policy: 'fresh' },
          harnessOptions: request.options,
          capabilities: request.capabilities,
          output: {},
        });
        if (issues.length)
          throw new OllamaError(
            'HARNESS_UNSUPPORTED_POLICY',
            issues[0]?.message ?? 'Ollama policy is unsupported',
          );
        const { connection, models } = await this.options.snapshot();
        if (!connection.enabled)
          throw new OllamaError('HARNESS_INVALID_CONFIGURATION', OLLAMA_OFF_REASON);
        const model = models.find(
          (entry) =>
            entry.model === request.model && entry.connectionRevision === connection.revision,
        );
        if (!model || model.availability.state !== 'available' || !model.enabled)
          throw new OllamaError(
            'HARNESS_MODEL_UNAVAILABLE',
            'Ollama model is unavailable; refresh models and check the selected model',
          );
        if (!request.effort || !model.efforts.includes(request.effort))
          throw new OllamaError(
            'HARNESS_INVALID_CONFIGURATION',
            'Selected Ollama thinking control is unsupported',
          );
        const think = model.thinkingByEffort[request.effort];
        if (request.effort !== 'none' && think !== request.effort)
          throw new OllamaError(
            'HARNESS_INVALID_CONFIGURATION',
            'Selected Ollama thinking control is unsupported',
          );
        if (request.effort === 'none' && think !== undefined && think !== false)
          throw new OllamaError(
            'HARNESS_INVALID_CONFIGURATION',
            'Selected Ollama thinking control is unsupported',
          );
        const guard = await this.options.guard?.(connection);
        ownerSignal = guard?.signal;
        if (ownerSignal) combined = AbortSignal.any([combined, ownerSignal]);
        guard?.check();
        if (combined.aborted) throw aborted();
        const context = await this.contextWindow(request, combined, true);
        if (!context.fits(request.turn.prompt)) throw contextOverflow();
        guard?.check();
        if (combined.aborted) throw aborted();
        queue.push({ type: 'session', sessionId, mode: 'fresh' });
        let response: Response;
        try {
          guard?.check();
          dispatched = true;
          response = await this.fetcher(`${connection.baseUrl}/api/chat`, {
            method: 'POST',
            redirect: 'error',
            signal: combined,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              model: model.model,
              messages: [{ role: 'user', content: request.turn.prompt }],
              stream: true,
              options: { num_ctx: context.contextTokens, num_predict: context.outputReserveTokens },
              ...(request.turn.outputSchema ? { format: request.turn.outputSchema } : {}),
              ...(think !== undefined ? { think } : {}),
            }),
          });
        } catch (error) {
          if (error instanceof OllamaError) throw error;
          if (combined.aborted) throw aborted();
          throw new OllamaError(
            'HARNESS_TRANSPORT_FAILED',
            'Ollama connection failed after dispatch; delivery is uncertain',
            'delivery-uncertain',
          );
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw httpFailure(response.status);
        }
        if (!response.body) throw protocolError();
        const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
        const cancelReader = () => {
          void reader.cancel().catch(() => undefined);
        };
        combined.addEventListener('abort', cancelReader, { once: true });
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let pending = '';
        let bytes = 0;
        let finalText = '';
        let done = false;
        let submitted = false;
        let usage: Usage = {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          reasoningOutputTokens: 0,
        };
        const frame = (line: string) => {
          if (!line.trim()) return;
          if (done || Buffer.byteLength(line) > MAX_LINE_BYTES)
            throw done
              ? protocolError()
              : new OllamaError(
                  'HARNESS_OUTPUT_LIMIT',
                  'Ollama response exceeds the framing limit',
                  'delivery-uncertain',
                );
          let value: unknown;
          try {
            value = JSON.parse(line);
          } catch {
            throw protocolError();
          }
          if (
            !object(value) ||
            'error' in value ||
            typeof value.done !== 'boolean' ||
            (value.model !== undefined && value.model !== model.model)
          )
            throw protocolError();
          const message = value.message;
          if (
            message !== undefined &&
            (!object(message) ||
              message.role !== 'assistant' ||
              typeof message.content !== 'string' ||
              (message.thinking !== undefined && typeof message.thinking !== 'string') ||
              (message.tool_calls !== undefined &&
                (!Array.isArray(message.tool_calls) || message.tool_calls.length > 0)))
          )
            throw protocolError();
          if (!message && !value.done) throw protocolError();
          if (!submitted) {
            queue.push({ type: 'submitted', marker: 'ollama.response' });
            submitted = true;
          }
          if (object(message)) finalText += message.content as string;
          if (Buffer.byteLength(finalText) > MAX_BYTES)
            throw new OllamaError(
              'HARNESS_OUTPUT_LIMIT',
              'Ollama answer exceeds the output limit',
              'delivery-uncertain',
            );
          if (value.done) {
            if (value.done_reason === 'length')
              throw new OllamaError(
                'HARNESS_OUTPUT_LIMIT',
                'Ollama reached the reserved reply limit; no partial reply was accepted',
                'delivery-uncertain',
              );
            usage = {
              inputTokens: count(value.prompt_eval_count),
              outputTokens: count(value.eval_count),
              cachedInputTokens: count(value.prompt_eval_cached_count),
              reasoningOutputTokens: 0,
            };
            done = true;
          }
        };
        try {
          while (true) {
            if (combined.aborted) throw aborted();
            const chunk = await reader.read();
            if (combined.aborted) throw aborted();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > MAX_BYTES)
              throw new OllamaError(
                'HARNESS_OUTPUT_LIMIT',
                'Ollama stream exceeds the output limit',
                'delivery-uncertain',
              );
            try {
              pending += decoder.decode(chunk.value, { stream: true });
            } catch {
              throw protocolError();
            }
            let newline = pending.indexOf('\n');
            while (newline >= 0) {
              frame(pending.slice(0, newline));
              pending = pending.slice(newline + 1);
              newline = pending.indexOf('\n');
            }
            if (Buffer.byteLength(pending) > MAX_LINE_BYTES)
              throw new OllamaError(
                'HARNESS_OUTPUT_LIMIT',
                'Ollama response exceeds the framing limit',
                'delivery-uncertain',
              );
          }
          try {
            pending += decoder.decode();
          } catch {
            throw protocolError();
          }
          frame(pending);
          if (!done) throw protocolError();
        } catch (error) {
          if (combined.aborted) throw aborted();
          if (error instanceof OllamaError) throw error;
          throw new OllamaError(
            'HARNESS_TRANSPORT_FAILED',
            'Ollama response disconnected; delivery is uncertain',
            'delivery-uncertain',
          );
        } finally {
          combined.removeEventListener('abort', cancelReader);
          await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
        const item: HarnessItem = {
          id: `${sessionId}:answer`,
          type: 'message',
          summary: finalText.slice(0, 200),
          detail: finalText.slice(0, 16_384),
        };
        queue.push({ type: 'item', item });
        queue.push({ type: 'usage', usage });
        queue.push({ type: 'turn-complete' });
        return { finalText, usage, items: [item] };
      } catch (error) {
        const failure =
          ownerSignal?.aborted && !signal.aborted && !controller.signal.aborted
            ? new OllamaError(
                'HARNESS_TURN_FAILED',
                dispatched
                  ? 'Ollama request closed because Ollama was turned off; remote computation may continue'
                  : 'Ollama inference was not submitted because Ollama was turned off',
                dispatched ? 'delivery-uncertain' : 'definitely-not-submitted',
              )
            : error;
        const timeoutReason = object(combined.reason) && combined.reason.code === 'HARNESS_TIMEOUT';
        const evidence =
          failure instanceof OllamaError
            ? failure
            : !dispatched && combined.aborted
              ? new OllamaError(
                  timeoutReason ? 'HARNESS_TIMEOUT' : 'HARNESS_TURN_FAILED',
                  timeoutReason
                    ? 'Ollama inference timed out before dispatch'
                    : 'Ollama inference was cancelled before dispatch',
                  'definitely-not-submitted',
                )
              : undefined;
        if (evidence)
          queue.push({
            type: 'error',
            code: evidence.code,
            message: evidence.message,
            retriable: evidence.retriable,
            submission: evidence.submission,
          });
        throw failure;
      } finally {
        queue.close();
      }
    })();
    // Consumers may subscribe to the event stream before awaiting the outcome.
    void result.catch(() => undefined);
    return {
      sessionId: Promise.resolve(sessionId),
      events: queue,
      result,
      cancel: async () => {
        controller.abort();
        await result.catch(() => undefined);
      },
    };
  }
}
