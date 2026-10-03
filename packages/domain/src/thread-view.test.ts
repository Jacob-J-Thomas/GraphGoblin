import { describe, expect, it } from 'vitest';
import { sampleThread } from '@graphgoblin/contracts/testing';
import {
  estimateMessageTokens,
  estimateThreadTokens,
  estimateTokens,
  threadView,
} from './thread-view.js';

describe('threadView', () => {
  it('adds shortcuts', () => {
    const view = threadView(sampleThread());
    expect(view.trigger.kind).toBe('manual');
    expect(view.lastMessage?.id).toBe('m2');
    expect(view.lastAssistantMessage?.id).toBe('m2');
  });

  it('omits shortcuts when there are no messages', () => {
    const view = threadView(sampleThread({ messages: [] }));
    expect('lastMessage' in view).toBe(false);
    expect('lastAssistantMessage' in view).toBe(false);
  });
});

describe('token estimates', () => {
  it('estimates four characters per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    const thread = sampleThread();
    const perMessage = thread.messages.map((m) => estimateMessageTokens(m));
    expect(estimateThreadTokens(thread)).toBe(perMessage.reduce((a, b) => a + b, 0));
  });
});
