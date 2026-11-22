import { ChatLoopInputSchema, JsonValueSchema, type ContextThread } from '@graphgoblin/contracts';
import {
  renderTemplate,
  threadView,
  SYSTEM_CHAT_TEXT_PROMPT,
  SYSTEM_CHAT_SCRIPT_PROMPT,
  SYSTEM_CHAT_SUBLOOP_PROMPT,
} from '@graphgoblin/domain';
import { RunFailureError } from '../errors.js';
import type { HarnessPort } from '../ports.js';

type Window = Awaited<ReturnType<NonNullable<HarnessPort['contextWindow']>>>;
const canonicalPrompts = new Set([
  SYSTEM_CHAT_TEXT_PROMPT,
  SYSTEM_CHAT_SCRIPT_PROMPT,
  SYSTEM_CHAT_SUBLOOP_PROMPT,
]);

function overflow(): never {
  throw new RunFailureError(
    'INFERENCE_CONTEXT_LIMIT',
    'The complete prompt exceeds this Ollama context allocation, including instructions and reply reserve. Shorten the current message or workflow prompt, start a new conversation, or choose another qualified model. Required input was not submitted or truncated.',
    { resumable: false },
  );
}

/** Trim only a known history slot, never an arbitrary rendered prompt or the stored thread. */
export async function admitInferencePrompt(options: {
  prompt: string;
  template: string;
  thread: ContextThread;
  allowHistoryTrim: boolean;
  window: Window;
}) {
  const { window } = options;
  const parsed = ChatLoopInputSchema.safeParse(options.thread.invocation.trigger.payload);
  const history = parsed.success ? parsed.data.history : undefined;
  const paired =
    history !== undefined &&
    history.length % 2 === 0 &&
    history.every((entry, index) => entry.role === (index % 2 === 0 ? 'user' : 'assistant'));
  const canTrim = options.allowHistoryTrim && canonicalPrompts.has(options.template) && paired;
  const pairs = paired ? history.length / 2 : 0;
  const report = (retainedHistoryPairs: number) => ({
    profile: window.profile,
    contextTokens: window.contextTokens,
    outputReserveTokens: window.outputReserveTokens,
    retainedHistoryPairs,
    omittedHistoryPairs: pairs - retainedHistoryPairs,
  });
  if (window.fits(options.prompt)) return { prompt: options.prompt, context: report(pairs) };
  if (!canTrim || !parsed.success) overflow();
  const candidateThread = structuredClone(options.thread);
  candidateThread.invocation.trigger.payload = JsonValueSchema.parse({
    ...parsed.data,
    history: [],
  });
  let prompt = await renderTemplate(options.template, { ...threadView(candidateThread) });
  // Authored instructions and required current/normalized input must fit on their own.
  if (!window.fits(prompt)) overflow();
  let retained = 0;
  for (let count = 1; count <= pairs; count += 1) {
    candidateThread.invocation.trigger.payload = JsonValueSchema.parse({
      ...parsed.data,
      history: parsed.data.history.slice(-count * 2),
    });
    const candidate = await renderTemplate(options.template, { ...threadView(candidateThread) });
    if (!window.fits(candidate)) break;
    prompt = candidate;
    retained = count;
  }
  return { prompt, context: report(retained) };
}
