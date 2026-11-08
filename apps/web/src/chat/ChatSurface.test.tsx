import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordingState, VoiceSegment } from './recorder.js';
import { ChatSurface } from './ChatSurface.js';
import { ChatApiError } from './client.js';
import { conversation, mockChatClient, session, turn } from './__fixtures__/chat.js';
const media = vi.hoisted(() => {
  class Recorder {
    state: RecordingState = {
      status: 'idle',
      segments: [],
      totalDurationMs: 0,
      dirty: false,
      permission: 'unknown',
      unsupported: false,
      blob: undefined,
      error: undefined,
    };
    listeners = new Set<() => void>();
    frozen = false;
    stopPromise: Promise<void> | undefined;
    getSnapshot = () => this.state;
    subscribe = (listener: () => void) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    };
    set = (patch: Partial<RecordingState>) => {
      this.state = { ...this.state, ...patch };
      this.listeners.forEach((listener) => listener());
    };
    start = vi.fn(() => {
      this.set({ status: 'recording', dirty: true });
      return Promise.resolve();
    });
    stop = vi.fn(() => {
      if (this.stopPromise) return this.stopPromise;
      if (this.state.status !== 'recording') return Promise.resolve();
      this.set({ status: 'finalizing' });
      const work = (async () => {
        if (media.stopGate) await media.stopGate;
        const blob = Object.assign(new Blob(['wav'], { type: 'audio/wav' }), {
          arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
        });
        const segment: VoiceSegment = {
          id: crypto.randomUUID(),
          blob,
          durationMs: 5000,
          byteLength: 3,
        };
        this.set({
          status: 'ready',
          segments: [...this.state.segments, segment],
          totalDurationMs: this.state.totalDurationMs + 5000,
          dirty: true,
        });
      })();
      this.stopPromise = work;
      void work.then(() => {
        if (this.stopPromise === work) this.stopPromise = undefined;
      });
      return work;
    });
    freeze = vi.fn(async () => {
      await this.stop();
      this.frozen = true;
      return {
        blob: this.state.segments[0]!.blob,
        segments: this.state.segments,
        durationMs: this.state.totalDurationMs,
      };
    });
    removeSegment = (id: string) => {
      if (this.frozen) return;
      const segments = this.state.segments.filter((segment) => segment.id !== id);
      this.set({ segments, totalDurationMs: segments.length * 5000, dirty: segments.length > 0 });
    };
    discard = vi.fn(() =>
      this.set({ status: 'idle', segments: [], totalDurationMs: 0, dirty: false }),
    );
    thaw = vi.fn(() => {
      this.frozen = false;
    });
  }
  return {
    Recorder,
    drafts: new Map<string, Recorder>(),
    stopGate: undefined as Promise<void> | undefined,
    updateLocked: false,
  };
});
vi.mock('./recorder.js', () => ({
  getConversationRecorder: (key: string) => {
    if (!media.drafts.has(key)) media.drafts.set(key, new media.Recorder());
    return media.drafts.get(key)!;
  },
  moveConversationRecorder: (from: string, to: string) => {
    const recorder = media.drafts.get(from);
    if (recorder && !media.drafts.get(to)?.state.dirty) {
      media.drafts.set(to, recorder);
      media.drafts.delete(from);
      return true;
    }
    return false;
  },
  anyVoiceDraftDirty: () => [...media.drafts.values()].some((recorder) => recorder.state.dirty),
  subscribeVoiceDrafts: () => () => {},
}));
vi.mock('../pwa/chat-update-guard.js', () => ({
  getChatUpdateLocked: () => media.updateLocked,
  setChatSubmissionUnresolved: vi.fn(),
}));
const key = 'surface-chat';
const audioReady = { ...session, readiness: { text: { ready: true }, audio: { ready: true } } };
async function load(
  client = mockChatClient(),
  props: Partial<Parameters<typeof ChatSurface>[0]> = {},
) {
  const view = render(<ChatSurface client={client} storageKey={key} {...props} />);
  await waitFor(() => expect(client.session).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
  });
  return { client, ...view };
}
beforeEach(() => {
  media.drafts.clear();
  media.stopGate = undefined;
  media.updateLocked = false;
  vi.stubGlobal('crypto', webcrypto);
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:preview'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('shared composer', () => {
  it('removes attachments, sends text on coarse-pointer Enter, preserves Shift Enter and IME', async () => {
    const { client } = await load();
    expect(screen.queryByRole('button', { name: 'Attach audio' })).not.toBeInTheDocument();
    const textarea = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true });
    expect(client.send).not.toHaveBeenCalled();
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(await screen.findByText(turn.response!.reply)).toBeVisible();
    expect(client.send).toHaveBeenCalledOnce();
    expect(textarea).toHaveValue('');
    expect(screen.queryByRole('link', { name: 'Open run' })).not.toBeInTheDocument();
  });
  it('owner unconfigured Mic opens the guided setup while device shows quiet audience copy', async () => {
    const client = mockChatClient();
    client.session.mockResolvedValue({
      ...session,
      readiness: {
        text: { ready: true },
        audio: { ready: false, code: 'CHAT_AUDIO_UNAVAILABLE', message: 'chat-normalize missing' },
      },
    });
    const setup = vi.fn();
    const view = await load(client, { owner: true, onSetupVoice: setup });
    fireEvent.click(screen.getByRole('button', { name: 'Record voice message' }));
    expect(setup).toHaveBeenCalledOnce();
    expect(screen.queryByText(/chat-normalize/)).not.toBeInTheDocument();
    view.unmount();
    await load(client);
    fireEvent.click(screen.getByRole('button', { name: 'Record voice message' }));
    expect(screen.getByRole('status')).toHaveTextContent('Voice messages are off for this device.');
  });
  it('retains Stop, appends another segment, and sends caption plus all finalized recording once', async () => {
    const client = mockChatClient();
    client.session.mockResolvedValue(audioReady);
    await load(client);
    const textarea = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(textarea, { target: { value: 'Caption' } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Record voice message' }));
    expect(textarea).toHaveFocus();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Stop recording' }));
    expect(client.upload).not.toHaveBeenCalled();
    expect(screen.getByRole('list', { name: 'Voice recordings' }).children).toHaveLength(1);
    expect(screen.getByText(/reloading or closing loses them/)).toBeVisible();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add more voice' }));
    let finish!: () => void;
    media.stopGate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Finalizing recording…')).toBeVisible();
    expect(client.upload).not.toHaveBeenCalled();
    act(() => finish());
    await waitFor(() => expect(client.send).toHaveBeenCalledOnce());
    const recorder = media.drafts.get(`${key}/${conversation.id}`)!;
    expect(recorder.freeze).toHaveBeenCalledOnce();
    expect(client.send.mock.calls[0]![1].input).toMatchObject({
      kind: 'audio',
      caption: 'Caption',
    });
    expect(client.upload).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Voice recordings' })).not.toBeInTheDocument(),
    );
    expect(textarea).toHaveValue('');
  });
  it('removal and whole draft discard require explicit confirmation and preserve typed caption', async () => {
    const client = mockChatClient();
    client.session.mockResolvedValue(audioReady);
    await load(client);
    const textarea = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(textarea, { target: { value: 'Keep this' } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Record voice message' }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Stop recording' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove recording 1' }));
    expect(screen.getByRole('list', { name: 'Voice recordings' }).children).toHaveLength(1);
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Confirm delete recording 1',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Record voice message' }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Stop recording' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard voice' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Confirm delete voice draft',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Voice recordings' })).not.toBeInTheDocument(),
    );
    expect(textarea).toHaveValue('Keep this');
  });
  it('uses calm active state with cancellation consequences and accessible blocked explanation', async () => {
    const client = mockChatClient();
    client.conversations.mockResolvedValue([{ ...conversation, lastTurn: 1 }]);
    client.turns.mockResolvedValue([{ ...turn, runStatus: 'running', response: undefined }]);
    await load(client, { owner: true });
    expect(screen.getByText(/Waiting for the current reply/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Send message' })).toHaveAttribute(
      'aria-describedby',
      'chat-send-reason',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    expect(
      within(screen.getByRole('alertdialog')).getByText(
        'Stops this request if it’s still running. Anything it already did stays done.',
      ),
    ).toBeVisible();
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Keep running' }),
    );
    expect(client.cancel).not.toHaveBeenCalled();
  });
  it('lost upload acknowledgement checks status and never admits automatically', async () => {
    const client = mockChatClient();
    client.session.mockResolvedValue(audioReady);
    client.upload.mockRejectedValue(new Error('lost'));
    client.audioStatus.mockResolvedValue({
      state: 'ready',
      audio: { id: turn.id, bytes: 3, mimeType: 'audio/wav', expiresAt: turn.createdAt },
    });
    await load(client);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Record voice message' }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Stop recording' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText(/Your recording reached the gateway/)).toBeVisible();
    expect(client.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(client.send).toHaveBeenCalledOnce());
    expect(client.upload).toHaveBeenCalledOnce();
  });
  it('keeps a rejected caption and voice draft, but clears an admitted failed workflow', async () => {
    const client = mockChatClient();
    client.session.mockResolvedValue(audioReady);
    client.send
      .mockRejectedValueOnce(new ChatApiError(413, 'TOO_LONG', 'Shorten the caption.'))
      .mockImplementation((_id, request) =>
        Promise.resolve({
          ...turn,
          input: request.input,
          requestId: request.requestId,
          runStatus: 'failed',
          response: undefined,
          error: { code: 'FAILED', message: 'Transcription failed.' },
        }),
      );
    await load(client);
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Caption' },
    });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Record voice message' }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Stop recording' }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Shorten the caption.')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Caption');
    expect(screen.getByRole('list', { name: 'Voice recordings' })).toBeVisible();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText(/The chat loop failed: Transcription failed/)).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
    expect(client.send.mock.calls[0]![1].requestId).toEqual(
      client.send.mock.calls[1]![1].requestId,
    );
  });
  it('refreshes readiness from Check connection props and retains per-conversation voice drafts', async () => {
    const client = mockChatClient();
    client.session.mockResolvedValue(audioReady);
    const other = { ...conversation, id: turn.id, lastTurn: 1, title: 'Other conversation' };
    client.conversations.mockResolvedValue([
      { ...conversation, lastTurn: 1, title: 'First conversation' },
      other,
    ]);
    const view = await load(client);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Record voice message' }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Stop recording' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Conversation' }), {
      target: { value: other.id },
    });
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Voice recordings' })).not.toBeInTheDocument(),
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Conversation' }), {
      target: { value: conversation.id },
    });
    expect(await screen.findByRole('list', { name: 'Voice recordings' })).toBeVisible();
    const before = client.session.mock.calls.length;
    view.rerender(<ChatSurface client={client} storageKey={key} sessionRefreshKey={1} />);
    await waitFor(() => expect(client.session.mock.calls.length).toBeGreaterThan(before));
  });
});

describe('thread recovery and reading intent', () => {
  it.each([
    ['cancelled', 'Cancelled. Anything the chat loop already did stays done.'],
    ['exhausted', 'The chat loop hit a limit before replying.'],
    ['succeeded', 'The chat loop finished without a usable reply.'],
  ] as const)('shows truthful %s terminal status', async (runStatus, notice) => {
    const client = mockChatClient();
    client.conversations.mockResolvedValue([{ ...conversation, lastTurn: 1 }]);
    client.turns.mockResolvedValue([{ ...turn, runStatus, response: undefined }]);
    await load(client, { owner: true });
    expect(screen.getByText(notice)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open run' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(await screen.findByRole('heading', { name: 'What’s the move?' })).toBeVisible();
    expect(client.createConversation).not.toHaveBeenCalled();
  });
  it.each(['queued', 'waiting', 'paused'] as const)(
    'shows %s without owner diagnostics to a device',
    async (runStatus) => {
      const client = mockChatClient();
      client.conversations.mockResolvedValue([{ ...conversation, lastTurn: 1 }]);
      client.turns.mockResolvedValue([{ ...turn, runStatus, response: undefined }]);
      await load(client, { headerActions: <span>Device header</span> });
      expect(screen.queryByRole('link', { name: 'Open run' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Record voice message' }));
      expect(media.drafts.get(`${key}/${conversation.id}`)?.start).not.toHaveBeenCalled();
    },
  );
  it('shows a caption and voice-only transcript without duplicating the canonical caption', async () => {
    const client = mockChatClient();
    client.conversations.mockResolvedValue([{ ...conversation, lastTurn: 1 }]);
    client.turns.mockResolvedValue([
      {
        ...turn,
        input: { kind: 'audio', audioId: turn.id, caption: 'Caption' },
        inputTranscript: 'Caption\n\nSpoken words',
      },
    ]);
    await load(client);
    fireEvent.click(screen.getByText('Transcript'));
    expect(screen.getByText('Caption')).toBeVisible();
    expect(screen.getByText('Spoken words')).toBeVisible();
    expect(screen.queryByText('Caption\n\nSpoken words')).not.toBeInTheDocument();
  });
  it('does GET-only recovery before an explicit retry and keeps newer text intact', async () => {
    sessionStorage.setItem(
      key,
      JSON.stringify({
        draft: 'Next draft',
        pending: {
          conversationId: conversation.id,
          request: { requestId: turn.requestId, input: turn.input },
        },
      }),
    );
    const client = mockChatClient();
    client.request.mockRejectedValue(new ChatApiError(404, 'NOT_FOUND', 'Not admitted.'));
    await load(client);
    expect(client.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }));
    await waitFor(() => expect(client.request).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Retry same message' }));
    await waitFor(() => expect(client.send).toHaveBeenCalledOnce());
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Next draft');
  });
  it('clears unavailable pending recovery without repeating a command', async () => {
    sessionStorage.setItem(
      key,
      JSON.stringify({
        draft: 'Next draft',
        pending: {
          conversationId: conversation.id,
          request: { requestId: turn.requestId, input: turn.input },
        },
      }),
    );
    const client = mockChatClient();
    client.request.mockRejectedValue(new ChatApiError(410, 'CHAT_HISTORY_DELETED', 'Gone.'));
    await load(client);
    expect(
      screen.getByText(
        'This request was deleted on the gateway. The rest of this conversation is still here.',
      ),
    ).toBeVisible();
    expect(client.send).not.toHaveBeenCalled();
  });
  it('keeps older reading position on an incoming reply, then reveals the relevant tail on request', async () => {
    const client = mockChatClient();
    client.conversations.mockResolvedValue([{ ...conversation, lastTurn: 1 }]);
    client.turns.mockResolvedValue([turn]);
    await load(client);
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    scroll.mockClear();
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 5000,
    });
    fireEvent.scroll(window);
    client.turns.mockResolvedValue([
      turn,
      {
        ...turn,
        id: turn.runId,
        turn: 2,
        response: { protocol: 'graphgoblin.chat.v1', reply: 'Incoming reply' },
      },
    ]);
    fireEvent.focus(window);
    expect(await screen.findByRole('button', { name: 'New reply' })).toBeVisible();
    expect(scroll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'New reply' }));
    expect(screen.getByText('Incoming reply').closest('article')).toHaveFocus();
    expect(scroll).toHaveBeenCalled();
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 0,
    });
    fireEvent.scroll(window);
  });
  it('cancellation failure retains its dialog and an asynchronous accepted cancellation shows Cancelling', async () => {
    const client = mockChatClient();
    client.conversations.mockResolvedValue([{ ...conversation, lastTurn: 1 }]);
    client.turns.mockResolvedValue([{ ...turn, runStatus: 'running', response: undefined }]);
    client.cancel
      .mockRejectedValueOnce(new ChatApiError(503, 'BUSY', 'Try later.'))
      .mockResolvedValue({ ...turn, runStatus: 'running', response: undefined });
    await load(client);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel request' }),
    );
    expect(await screen.findByText(/Couldn’t cancel: Try later/)).toBeVisible();
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel request' }),
    );
    expect(await screen.findByText('Cancelling')).toBeVisible();
  });
  it('pauses capture on Escape and backgrounding, and surfaces finalization failures without upload', async () => {
    const client = mockChatClient();
    client.session.mockResolvedValue(audioReady);
    await load(client);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Record voice message' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message' }), { key: 'Escape' });
    expect(await screen.findByRole('list', { name: 'Voice recordings' })).toBeVisible();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add more voice' }));
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() =>
      expect(screen.getByRole('list', { name: 'Voice recordings' }).children).toHaveLength(2),
    );
    const recorder = media.drafts.get(`${key}/new`)!;
    recorder.freeze.mockRejectedValueOnce(
      new Error('Final words could not be saved. Record again.'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Final words could not be saved.');
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus();
    expect(client.upload).not.toHaveBeenCalled();
  });
  it('unavailable owner credentials and offline readiness use audience-specific actionable copy', async () => {
    const client = mockChatClient();
    client.session.mockRejectedValue(new ChatApiError(401, 'UNAUTHORIZED', 'API key needed.'));
    const view = await load(client, { owner: true });
    expect(screen.getByText('Enter an API key to use Chat.')).toBeVisible();
    view.unmount();
    const online = mockChatClient();
    await load(online);
    fireEvent(window, new Event('offline'));
    expect(screen.getByText('You’re offline. Reconnect to send.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Check connection' }));
    expect(online.send).not.toHaveBeenCalled();
  });
});

describe('safe per-turn context and transcription disclosure', () => {
  it.each([undefined, 0, 1, 3])(
    'discloses only actual recent-context omission (%s pairs)',
    async (omittedHistoryPairs) => {
      const client = mockChatClient();
      client.conversations.mockResolvedValue([{ ...conversation, lastTurn: 1 }]);
      client.turns.mockResolvedValue([
        {
          ...turn,
          ...(omittedHistoryPairs === undefined
            ? {}
            : { context: { retainedHistoryPairs: 2, omittedHistoryPairs, contextTokens: 4096 } }),
        },
      ]);
      await load(client);
      if (omittedHistoryPairs) {
        expect(
          screen.getByText(
            `${omittedHistoryPairs} earlier ${omittedHistoryPairs === 1 ? 'pair' : 'pairs'} omitted from the recent context to fit this model.`,
          ),
        ).toBeVisible();
      } else expect(screen.queryByText(/omitted from the recent context/)).not.toBeInTheDocument();
      expect(screen.queryByText(/all history|total recall|4096/)).not.toBeInTheDocument();
    },
  );
  it.each(['local', 'cloud'] as const)(
    'labels the %s route pinned to the transcript rather than today’s setting',
    async (route) => {
      const client = mockChatClient();
      client.session.mockResolvedValue({
        ...audioReady,
        voice: {
          ready: true,
          route: route === 'local' ? 'cloud' : 'local',
          cloudFallbackAllowed: false,
          message: 'Current setting differs.',
        },
      });
      client.conversations.mockResolvedValue([{ ...conversation, lastTurn: 1 }]);
      client.turns.mockResolvedValue([
        {
          ...turn,
          input: { kind: 'audio', audioId: turn.id },
          inputTranscript: 'Spoken words',
          voice: {
            ready: true,
            route,
            ...(route === 'cloud' ? { cloudProvider: 'OpenAI' as const } : {}),
            cloudFallbackAllowed: false,
            message: 'Pinned route.',
          },
        },
      ]);
      await load(client);
      fireEvent.click(screen.getByText('Transcript'));
      expect(
        screen.getByText(
          route === 'local' ? 'Transcribed on this gateway' : 'Transcribed by OpenAI',
        ),
      ).toBeVisible();
    },
  );
});

describe('Fable review regressions', () => {
  it('F1 sends once when Enter arrives after Stop entered finalizing', async () => {
    const client = mockChatClient();
    client.session.mockResolvedValue(audioReady);
    await load(client);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Record voice message' }));
    let finish!: () => void;
    media.stopGate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    expect(await screen.findByText('Finalizing recording…')).toBeVisible();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(client.send).not.toHaveBeenCalled();
    act(() => finish());
    await waitFor(() => expect(client.send).toHaveBeenCalledOnce());
    expect(client.upload).toHaveBeenCalledOnce();
  });
  it('F2 preserves a route back to the only saved conversation after New chat', async () => {
    const client = mockChatClient();
    client.conversations.mockResolvedValue([
      { ...conversation, lastTurn: 1, title: 'My only conversation' },
    ]);
    client.turns.mockResolvedValue([turn]);
    await load(client, { owner: true });
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    const selector = await screen.findByRole('combobox', { name: 'Conversation' });
    expect(
      within(selector).getByRole('option', { name: /My only conversation/ }),
    ).toBeInTheDocument();
    fireEvent.change(selector, { target: { value: conversation.id } });
    expect(await screen.findByText(turn.response!.reply)).toBeVisible();
    expect(client.createConversation).not.toHaveBeenCalled();
  });
  it('F3 removes a retained frozen segment after an out-of-band retry is definitively refused', async () => {
    const client = mockChatClient();
    client.session.mockResolvedValue(audioReady);
    client.send
      .mockRejectedValueOnce(new Error('Lost acknowledgement'))
      .mockRejectedValueOnce(new ChatApiError(413, 'REFUSED', 'Not admitted.'));
    client.request.mockRejectedValue(new ChatApiError(404, 'NOT_FOUND', 'Not admitted.'));
    await load(client);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Record voice message' }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Stop recording' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(client.send).toHaveBeenCalledOnce());
    fireEvent.click(await screen.findByRole('button', { name: 'Check status' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry same message' }));
    expect(await screen.findByText('Not admitted.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Remove recording 1' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Confirm delete recording 1',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Voice recordings' })).not.toBeInTheDocument(),
    );
  });
  it('F5 explains an explicit Send held by an app update without upload or admission', async () => {
    const { client } = await load();
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Keep me' },
    });
    media.updateLocked = true;
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The app is updating. Try sending again in a moment.',
    );
    expect(client.send).not.toHaveBeenCalled();
    expect(client.upload).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Keep me');
  });
  it('F6 keeps reload-recovered server audio until explicit Send or confirmed discard', async () => {
    sessionStorage.setItem(
      `${key}.voice-upload`,
      JSON.stringify({
        uploadId: turn.requestId,
        sha256: 'a'.repeat(64),
        caption: 'Kept',
        audio: { id: turn.id, bytes: 50, mimeType: 'audio/wav', expiresAt: turn.createdAt },
      }),
    );
    const client = mockChatClient();
    client.session.mockResolvedValue(audioReady);
    client.audioStatus.mockResolvedValue({
      state: 'ready',
      audio: { id: turn.id, bytes: 50, mimeType: 'audio/wav', expiresAt: turn.createdAt },
    });
    await load(client);
    expect(await screen.findByText('Voice recording ready on the gateway.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Record voice message' }));
    expect(client.discardAudio).not.toHaveBeenCalled();
    expect(document.getElementById('chat-voice-draft-reason')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Record voice message' })).toHaveAttribute(
      'aria-describedby',
      'chat-voice-draft-reason',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discard voice' }));
    expect(client.discardAudio).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Confirm delete voice draft',
      }),
    );
    await waitFor(() => expect(client.discardAudio).toHaveBeenCalledOnce());
    expect(screen.queryByText('Voice recording ready on the gateway.')).not.toBeInTheDocument();
  });
});

it.each(['send-or-remove', 'other-draft', 'wait'] as const)(
  'F4 keeps composer focus and avoids a dead-end Record again for %s',
  async (errorRecovery) => {
    const client = mockChatClient();
    client.session.mockResolvedValue(audioReady);
    await load(client);
    const textarea = screen.getByRole('textbox', { name: 'Message' });
    if (errorRecovery === 'send-or-remove') {
      await userEvent.setup().click(screen.getByRole('button', { name: 'Record voice message' }));
      await userEvent.setup().click(screen.getByRole('button', { name: 'Stop recording' }));
    }
    textarea.focus();
    const recorder = media.drafts.get(`${key}/new`)!;
    act(() =>
      recorder.set({
        error: 'Capacity is unavailable. Send it, or remove a recording.',
        errorRecovery,
      }),
    );
    expect(screen.queryByRole('button', { name: 'Record again' })).not.toBeInTheDocument();
    expect(textarea).toHaveFocus();
    if (errorRecovery === 'send-or-remove') {
      fireEvent.keyDown(textarea, { key: 'Enter' });
      await waitFor(() => expect(client.send).toHaveBeenCalledOnce());
    }
  },
);
it('H3 leaves WebKit IME keyCode229 confirmation in the composer', async () => {
  const { client } = await load();
  const textarea = screen.getByRole('textbox', { name: 'Message' });
  fireEvent.change(textarea, { target: { value: '候補' } });
  fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 229, isComposing: false });
  expect(client.send).not.toHaveBeenCalled();
  expect(textarea).toHaveValue('候補');
  expect(textarea).toHaveAttribute('enterkeyhint', 'send');
});
it('H6 replaces a known retired upload only after confirmation and a later explicit Send', async () => {
  const client = mockChatClient();
  client.session.mockResolvedValue(audioReady);
  client.upload
    .mockRejectedValueOnce(new Error('Lost upload acknowledgement'))
    .mockResolvedValue({ id: turn.id, bytes: 3, mimeType: 'audio/wav', expiresAt: turn.createdAt });
  client.audioStatus.mockResolvedValue({ state: 'retired' });
  await load(client);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Record voice message' }));
  await userEvent.setup().click(screen.getByRole('button', { name: 'Stop recording' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
    target: { value: 'Caption' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  expect(await screen.findByRole('button', { name: 'Use kept recording' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  expect(client.upload).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Use kept recording' }));
  expect(client.upload).toHaveBeenCalledOnce();
  fireEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Confirm delete expired upload',
    }),
  );
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(screen.getByRole('list', { name: 'Voice recordings' })).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Caption');
  expect(client.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(client.send).toHaveBeenCalledOnce());
  expect(client.upload.mock.calls[0]![1].uploadId).not.toBe(
    client.upload.mock.calls[1]![1].uploadId,
  );
});

it('sends a reload-recovered ready recording explicitly without recapturing or uploading it again', async () => {
  const audio = { id: turn.id, bytes: 50, mimeType: 'audio/wav', expiresAt: turn.createdAt };
  sessionStorage.setItem(key, JSON.stringify({ draft: 'Kept caption' }));
  sessionStorage.setItem(
    `${key}.voice-upload`,
    JSON.stringify({
      uploadId: turn.requestId,
      sha256: 'a'.repeat(64),
      caption: 'Kept caption',
      audio,
    }),
  );
  const client = mockChatClient();
  client.session.mockResolvedValue(audioReady);
  client.audioStatus.mockResolvedValue({ state: 'ready', audio });
  await load(client);
  expect(await screen.findByText('Voice recording ready on the gateway.')).toBeVisible();
  expect(client.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(client.send).toHaveBeenCalledOnce());
  expect(client.send.mock.calls[0]![1].input).toEqual({
    kind: 'audio',
    audioId: audio.id,
    caption: 'Kept caption',
  });
  expect(client.upload).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
});

describe('root browser review regressions', () => {
  it('R1 never invokes owner model observation in a peripheral Chat surface', async () => {
    const ownerSummary = vi.fn(() => <span>Owner-only published model</span>);
    await load(mockChatClient(), { ownerSummary });
    expect(ownerSummary).not.toHaveBeenCalled();
    expect(screen.queryByText('Owner-only published model')).not.toBeInTheDocument();
  });
  it('R2 clears the previous reply live announcement on intentional New chat and conversation selection', async () => {
    const client = mockChatClient();
    client.conversations.mockResolvedValue([{ ...conversation, lastTurn: 1, title: 'Saved chat' }]);
    await load(client, { owner: true });
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText(turn.response!.reply)).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(`Reply: ${turn.response!.reply}`);
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(await screen.findByRole('heading', { name: 'What’s the move?' })).toBeVisible();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    client.turns.mockResolvedValue([turn]);
    fireEvent.change(screen.getByRole('combobox', { name: 'Conversation' }), {
      target: { value: conversation.id },
    });
    expect(await screen.findByText(turn.response!.reply)).toBeVisible();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
  it('R2 keeps uncertain admission recovery intact when New chat is blocked', async () => {
    sessionStorage.setItem(
      key,
      JSON.stringify({
        draft: 'Next draft',
        pending: {
          conversationId: conversation.id,
          request: { requestId: turn.requestId, input: turn.input },
        },
      }),
    );
    const client = mockChatClient();
    client.request.mockRejectedValue(new ChatApiError(404, 'NOT_FOUND', 'Not admitted.'));
    await load(client, { owner: true });
    const newChat = screen.getByRole('button', { name: 'New chat' });
    expect(newChat).toBeDisabled();
    fireEvent.click(newChat);
    expect(screen.getByRole('button', { name: 'Check status' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Next draft');
    expect(client.send).not.toHaveBeenCalled();
    expect(client.createConversation).not.toHaveBeenCalled();
  });
  it('R3 shows one Sending status during a normal held POST and no uncertain-ack wording', async () => {
    const client = mockChatClient();
    let finish!: () => void;
    client.send.mockImplementation(
      (conversationId, request) =>
        new Promise((resolve) => {
          finish = () =>
            resolve({
              ...turn,
              conversationId,
              requestId: request.requestId,
              input: request.input,
            });
        }),
    );
    await load(client);
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Hello' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message' }), { key: 'Enter' });
    await waitFor(() => expect(client.send).toHaveBeenCalledOnce());
    expect(screen.getAllByText('Sending…')).toHaveLength(1);
    expect(screen.queryByText('Checking what happened…')).not.toBeInTheDocument();
    act(() => finish());
    expect(await screen.findByText(turn.response!.reply)).toBeVisible();
    expect(screen.queryByText('Sending…')).not.toBeInTheDocument();
  });
  it('R3 reserves one Checking status for a lost acknowledgement', async () => {
    const client = mockChatClient();
    client.send.mockRejectedValue(new Error('Lost acknowledgement'));
    client.request.mockRejectedValue(new ChatApiError(404, 'NOT_FOUND', 'Not admitted.'));
    await load(client);
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Checking what happened…')).toBeVisible();
    expect(screen.getAllByText('Checking what happened…')).toHaveLength(1);
    expect(screen.queryByText('Sending…')).not.toBeInTheDocument();
    expect(client.send).toHaveBeenCalledOnce();
  });
});

describe('custom-loop voice caption guidance', () => {
  it.each([true, false])(
    'shows audience-safe configured-by-loop responsibility only beside a voice draft (owner=%s)',
    async (owner) => {
      const message = owner
        ? 'Configured by a custom loop. Its normalizer controls how transcripts and typed captions are combined.'
        : 'Configured by the gateway loop. Ask the owner whether its normalizer combines typed captions with audio.';
      const client = mockChatClient();
      client.session.mockResolvedValue({
        ...audioReady,
        readiness: { text: { ready: true }, audio: { ready: true, message } },
      });
      await load(client, { owner });
      expect(screen.queryByText(message)).not.toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole('button', { name: 'Record voice message' }));
      await userEvent.setup().click(screen.getByRole('button', { name: 'Stop recording' }));
      expect(screen.getByText(message)).toBeVisible();
      expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled();
    },
  );
  it.each(['local', 'cloud'] as const)(
    'does not add custom-normalizer guidance to a built-in %s route',
    async (route) => {
      const message = 'Custom normalizer responsibility text';
      const client = mockChatClient();
      client.session.mockResolvedValue({
        ...audioReady,
        readiness: { text: { ready: true }, audio: { ready: true, message } },
        voice: {
          ready: true,
          route,
          ...(route === 'cloud' ? { cloudProvider: 'OpenAI' as const } : {}),
          cloudFallbackAllowed: false,
          message: 'Configured built-in voice route.',
        },
      });
      await load(client);
      await userEvent.setup().click(screen.getByRole('button', { name: 'Record voice message' }));
      await userEvent.setup().click(screen.getByRole('button', { name: 'Stop recording' }));
      expect(screen.queryByText(message)).not.toBeInTheDocument();
      expect(screen.getByText(/Configured built-in voice route/)).toBeVisible();
    },
  );
});
