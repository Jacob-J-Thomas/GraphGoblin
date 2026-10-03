import type { ContextThread, Message } from '@graphgoblin/contracts';

/**
 * The view templates and expressions see. Everything in the thread is visible except artifact
 * contents, which the thread never holds anyway (only references). A few shortcuts are added.
 */
export interface ThreadView extends ContextThread {
  trigger: ContextThread['invocation']['trigger'];
  lastMessage?: Message;
  lastAssistantMessage?: Message;
}

export function threadView(thread: ContextThread): ThreadView {
  const lastMessage = thread.messages.at(-1);
  const lastAssistantMessage = [...thread.messages].reverse().find((m) => m.role === 'assistant');
  return {
    ...thread,
    trigger: thread.invocation.trigger,
    ...(lastMessage ? { lastMessage } : {}),
    ...(lastAssistantMessage ? { lastAssistantMessage } : {}),
  };
}

/** Rough token estimate: four characters per token. Replaceable later. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(message: Message): number {
  return estimateTokens(message.content) + 4;
}

export function estimateThreadTokens(thread: ContextThread): number {
  return thread.messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}
