// SCRIPTED HarnessPort for QA. Ancestry: original 01 drivers/lib/harness.mjs (67922078…, copied
// byte-exact to ancestry/harness.original-copy.mjs). 02 amendments: sessionId always resolves (as
// the repository FakeHarness does), behaviours can match by prompt, abort rejects held results,
// error events reject the result, and every port call is counted separately from native sinks.

export class ScriptedHarness {
  constructor(id = 'codex') {
    this.id = id;
    this.plan = [];
    this.counters = { starts: 0, resumes: 0, syncThrows: 0, resultsResolved: 0, resultsRejected: 0, cancels: 0, cancelRejects: 0, contextWindow: 0 };
    this.calls = [];
    this.sessionSeq = 0;
    this.contextWindowImpl = undefined;
    this.held = [];
  }
  reset() {
    this.plan = [];
    for (const k of Object.keys(this.counters)) this.counters[k] = 0;
    this.calls = [];
    this.contextWindowImpl = undefined;
    this.held = [];
  }
  /** Behaviours are consumed in order; an entry with `match(prompt)` is used only when it matches. */
  script(...behaviours) {
    this.plan.push(...behaviours);
  }
  snapshot() {
    return { ...this.counters, calls: this.calls.map((c) => ({ ...c })) };
  }
  preflight() {
    return Promise.resolve({ state: 'ready', ok: true, version: 'qa-scripted', authenticated: true, problems: [] });
  }
  get contextWindow() {
    if (!this.contextWindowImpl) return undefined;
    return (request, signal) => {
      this.counters.contextWindow += 1;
      return this.contextWindowImpl(request, signal);
    };
  }
  start(request, signal) {
    return this.#open('start', undefined, request, signal);
  }
  resume(sessionId, request, signal) {
    return this.#open('resume', sessionId, request, signal);
  }
  #pick(prompt) {
    const i = this.plan.findIndex((b) => (b.match ? b.match(prompt) : true));
    if (i < 0) return { kind: 'ok' };
    return this.plan.splice(i, 1)[0];
  }
  #open(kind, resumeId, request, signal) {
    if (kind === 'start') this.counters.starts += 1;
    else this.counters.resumes += 1;
    const prompt = request?.turn?.prompt;
    const b = this.#pick(prompt);
    const call = { kind, resumeId, prompt, cwd: request?.workingDirectory, model: request?.model, effort: request?.effort, outputSchema: request?.turn?.outputSchema !== undefined, behaviour: b.kind, t: Date.now() };
    this.calls.push(call);
    if (b.kind === 'throwSync') {
      this.counters.syncThrows += 1;
      throw b.error;
    }
    const sessionId = resumeId ?? `qa-${this.id}-session-${++this.sessionSeq}`;
    const counters = this.counters;
    const announce = b.session !== false;
    const accepted = b.accepted ?? (b.kind === 'ok' || b.kind === 'hold');
    let release;
    const gate = b.kind === 'hold' ? new Promise((resolve) => (release = resolve)) : Promise.resolve();
    if (b.kind === 'hold') this.held.push({ release: () => release(), call });
    const items = [{ id: 'i1', type: 'message', summary: b.finalText ?? 'OK' }];
    const events = (async function* () {
      if (announce) yield { type: 'session', sessionId, mode: resumeId ? 'resumed' : 'fresh' };
      if (accepted) yield { type: 'submitted', marker: 'fake.accepted' };
      for (const item of items) yield { type: 'item', item };
      if (b.kind === 'errorEvent') {
        yield { type: 'error', code: b.code, message: b.message, retriable: b.retriable ?? false, submission: b.submission ?? 'delivery-uncertain' };
        return;
      }
      if (b.kind === 'iteratorThrow') throw b.error;
      if (b.kind === 'ok' || b.kind === 'hold') {
        yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, reasoningOutputTokens: 0 } };
        yield { type: 'turn-complete' };
      }
    })();
    const result = (async () => {
      await Promise.race([
        gate,
        new Promise((resolve) => {
          if (signal?.aborted) resolve();
          signal?.addEventListener('abort', () => resolve(), { once: true });
        }),
      ]);
      if (signal?.aborted) {
        counters.resultsRejected += 1;
        throw new DOMException('aborted', 'AbortError');
      }
      if (b.kind === 'rejectAfterHandle' || b.kind === 'iteratorThrow') {
        counters.resultsRejected += 1;
        throw b.error;
      }
      if (b.kind === 'errorEvent') {
        counters.resultsRejected += 1;
        throw Object.assign(new Error(b.message), { code: b.code, retriable: b.retriable ?? false });
      }
      counters.resultsResolved += 1;
      return {
        finalText: b.finalText ?? 'OK',
        ...(b.structured !== undefined ? { structured: b.structured } : {}),
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, reasoningOutputTokens: 0 },
        items,
      };
    })();
    result.catch(() => undefined);
    return {
      sessionId: Promise.resolve(sessionId),
      events,
      result,
      cancel: () => {
        counters.cancels += 1;
        if (b.cancelError) {
          counters.cancelRejects += 1;
          return Promise.reject(b.cancelError);
        }
        return Promise.resolve();
      },
    };
  }
}
