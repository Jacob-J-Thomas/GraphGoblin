import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatSurface } from './ChatSurface.js';
import { ChatApiError } from './client.js';
import { conversation, mockChatClient, session, turn } from './__fixtures__/chat.js';
const key = 'surface-chat';
const ready = () =>
  waitFor(() =>
    expect(screen.getByRole('button', { name: 'Send message' })).toHaveAttribute(
      'aria-disabled',
      'true',
    ),
  );
const load = async (client = mockChatClient(), owner = false) => {
  const view = render(<ChatSurface client={client} storageKey={key} owner={owner} />);
  await waitFor(() => expect(client.session).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText('Checking Gateway chat…')).not.toBeInTheDocument());
  return { client, ...view };
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('shared chat surface', () => {
  it('keeps quiet empty state and displays only the exact loop reply as plain text', async () => {
    const user = userEvent.setup();
    const { client } = await load();
    expect(screen.getByRole('heading', { name: 'What’s the move?' })).toBeVisible();
    expect(screen.getByText(/Configure a normalizer/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Attach audio' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText(turn.response!.reply)).toBeVisible();
    expect(client.send).toHaveBeenCalledOnce();
    expect(screen.queryByRole('link', { name: 'Open run' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
  });
  it('renders projected errors as notices and owner run links without inventing a reply', async () => {
    const client = mockChatClient();
    client.conversations.mockResolvedValue([conversation]);
    client.turns.mockResolvedValue([
      { ...turn, error: { code: 'CHAT_RESPONSE_INVALID', message: 'The result is invalid.' } },
    ]);
    await load(client, true);
    expect(await screen.findByText(/The chat loop failed: The result is invalid/)).toBeVisible();
    expect(screen.queryByText(turn.response!.reply)).not.toBeInTheDocument();
    expect(screen.getByText('Problem:')).toHaveClass('sr-only');
    expect(screen.getByRole('link', { name: 'Open run' })).toHaveAttribute(
      'href',
      `/app/runs/${turn.runId}`,
    );
    expect(screen.getByRole('link', { name: 'Gateway chat' })).toHaveAttribute(
      'href',
      `/app/loops/${session.systemLoopId}/edit`,
    );
  });
  it.each(['cancelled', 'exhausted', 'failed', 'succeeded'] as const)(
    'shows a terminal %s notice when no canonical reply exists',
    async (runStatus) => {
      const client = mockChatClient();
      client.conversations.mockResolvedValue([conversation]);
      client.turns.mockResolvedValue([{ ...turn, runStatus, response: undefined }]);
      await load(client);
      expect(
        await screen.findByText(
          runStatus === 'cancelled'
            ? 'Cancelled. Anything the chat loop already did stays done.'
            : runStatus === 'exhausted'
              ? 'The chat loop hit a limit before replying.'
              : 'The chat loop finished without a usable reply.',
        ),
      ).toBeVisible();
    },
  );
  it('waiting is visible, keeps drafting possible, and cancels using the chat client', async () => {
    const user = userEvent.setup();
    const client = mockChatClient();
    client.conversations.mockResolvedValue([conversation]);
    client.turns.mockResolvedValue([{ ...turn, runStatus: 'waiting', response: undefined }]);
    await load(client);
    expect(
      await screen.findByText('Waiting on the gateway. Ask its owner if this doesn’t move.'),
    ).toBeVisible();
    expect(screen.getByText('Wait for this request to finish, or cancel it.')).toBeVisible();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Next');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(client.send).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel request' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel request' }),
    );
    expect(client.cancel).toHaveBeenCalledWith(turn.id);
    expect(
      await screen.findByText('Cancelled. Anything the chat loop already did stays done.'),
    ).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Next');
  });
  it('reload checks unknown acknowledgement without posting, then offers explicit same-message retry', async () => {
    const user = userEvent.setup();
    sessionStorage.setItem(
      key,
      JSON.stringify({
        draft: '',
        pending: {
          conversationId: conversation.id,
          request: { requestId: turn.requestId, input: turn.input },
        },
      }),
    );
    const client = mockChatClient();
    client.request.mockRejectedValue(new ChatApiError(404, 'NOT_FOUND', 'Not found.'));
    await load(client);
    expect(await screen.findByText('Acknowledgement unknown')).toBeVisible();
    expect(client.send).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Check status' }));
    expect(client.send).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Retry same message' }));
    expect(client.send).toHaveBeenCalledWith(conversation.id, {
      requestId: turn.requestId,
      input: turn.input,
    });
    expect(await screen.findByText(turn.response!.reply)).toBeVisible();
  });
  it('blocks offline sends and never sends an unsent draft when reconnecting', async () => {
    const user = userEvent.setup();
    const { client } = await load();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Draft');
    await act(() => window.dispatchEvent(new Event('offline')));
    expect(screen.getByText('You’re offline. Reconnect to send.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(client.send).not.toHaveBeenCalled();
    await act(() => window.dispatchEvent(new Event('online')));
    await waitFor(() =>
      expect(screen.queryByText('You’re offline. Reconnect to send.')).not.toBeInTheDocument(),
    );
    expect(client.send).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Draft');
  });
  it('respects IME, Shift+Enter and touch newline, but explicitly sends Ctrl+Enter', async () => {
    const { client } = await load();
    const input = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'Message' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(client.send).not.toHaveBeenCalled();
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(client.send).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(client.send).toHaveBeenCalledOnce());
  });
  it('uploads an audio attachment, renders actual transcript, and handles invalid file sizes', async () => {
    const client = mockChatClient();
    client.session.mockResolvedValue({
      ...session,
      readiness: { text: { ready: true }, audio: { ready: true } },
    });
    client.send.mockImplementation((_id, request) =>
      Promise.resolve({
        ...turn,
        requestId: request.requestId,
        input: request.input,
        inputTranscript: 'Actual normalizer transcript',
      }),
    );
    const { container } = await load(client);
    const picker = container.querySelector<HTMLInputElement>('input[type=file]')!;
    fireEvent.change(picker, {
      target: { files: [new File([], 'empty.webm', { type: 'audio/webm' })] },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('empty or too big');
    fireEvent.change(picker, {
      target: { files: [new File(['audio'], 'memo.webm', { type: 'audio/webm' })] },
    });
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Actual normalizer transcript')).toBeVisible();
    expect(client.upload).toHaveBeenCalledOnce();
    expect(screen.getByText('Transcript')).toBeVisible();
    expect(client.discardAudio).not.toHaveBeenCalled();
  });
  it('file removal restores typing and an upload failure is a notice', async () => {
    const client = mockChatClient();
    client.session.mockResolvedValue({
      ...session,
      readiness: { text: { ready: true }, audio: { ready: true } },
    });
    const { container } = await load(client);
    const picker = container.querySelector<HTMLInputElement>('input[type=file]')!;
    fireEvent.change(picker, {
      target: { files: [new File(['a'], 'clip.webm', { type: 'audio/webm' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove audio' }));
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled();
    fireEvent.change(picker, {
      target: { files: [new File(['a'], 'clip.webm', { type: 'audio/webm' })] },
    });
    client.upload.mockRejectedValue(
      new ChatApiError(415, 'CHAT_MEDIA_UNSUPPORTED', 'Use a supported audio type.'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Use a supported audio type.');
    expect(client.send).not.toHaveBeenCalled();
  });
  it('owner header supports actions and selecting/new conversations', async () => {
    const user = userEvent.setup();
    const client = mockChatClient();
    client.conversations.mockResolvedValue([conversation, { ...conversation, id: turn.id }]);
    client.turns.mockResolvedValue([turn]);
    render(
      <ChatSurface
        client={client}
        storageKey={key}
        owner
        headerActions={<button>Devices</button>}
      />,
    );
    await screen.findByText(turn.response!.reply);
    expect(screen.getByRole('button', { name: 'Devices' })).toBeVisible();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Conversation' }), turn.id);
    await waitFor(() =>
      expect(client.turns).toHaveBeenCalledWith(turn.id, expect.any(AbortSignal)),
    );
    await user.click(screen.getByRole('button', { name: 'New chat' }));
    expect(client.createConversation).toHaveBeenCalledOnce();
  });
  it('announces no restored history and safely renders HTML-looking text', async () => {
    const client = mockChatClient();
    client.conversations.mockResolvedValue([conversation]);
    client.turns.mockResolvedValue([
      { ...turn, response: { ...turn.response!, reply: '<img src=x onerror=alert(1)>' } },
    ]);
    const { container } = await load(client);
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
    expect(container.querySelector('img')).toBeNull();
    expect(within(container).getByRole('status')).toHaveTextContent('');
    await ready();
  });
});

describe('chat readiness and audio boundaries', () => {
  it('unavailable audio controls explain the exact reason without asking for permission', async () => {
    const { client } = await load();
    fireEvent.click(screen.getByRole('button', { name: 'Attach audio' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Voice messages aren’t available here. Configure a normalizer',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Record voice message' }));
    expect(client.upload).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Voice messages aren’t available here.');
  });
  it('readiness and authentication failures keep the draft, show a notice and forbid mutation', async () => {
    const client = mockChatClient();
    client.session.mockResolvedValue({
      ...session,
      readiness: {
        ...session.readiness,
        text: { ready: false, message: 'Choose an available model.' },
      },
    });
    const { unmount } = await load(client);
    expect(screen.getByText('Choose an available model.')).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(client.send).not.toHaveBeenCalled();
    unmount();
    const auth = vi.fn();
    const denied = mockChatClient();
    denied.session.mockRejectedValue(new ChatApiError(401, 'UNAUTHORIZED', 'Pair again.'));
    render(
      <ChatSurface
        client={denied}
        storageKey="auth-chat"
        onAuthenticationError={auth}
        headerActions={<button>Gateway sheet</button>}
      />,
    );
    await waitFor(() => expect(auth).toHaveBeenCalledOnce());
    expect(
      screen.getByText('Your conversation loads when Goblin can reach the gateway.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Gateway sheet' })).toBeVisible();
  });
  it('a request tombstone preserves the remaining transcript and current draft without replay', async () => {
    sessionStorage.setItem(
      key,
      JSON.stringify({
        draft: 'My next message',
        pending: {
          conversationId: conversation.id,
          request: { requestId: turn.requestId, input: turn.input },
        },
      }),
    );
    const client = mockChatClient();
    client.request.mockRejectedValue(new ChatApiError(410, 'CHAT_HISTORY_DELETED', 'Gone.'));
    client.turns.mockResolvedValue([
      { ...turn, requestId: '36bee35d-3ce7-43ab-87c1-a95952a069ed' },
    ]);
    await load(client);
    expect(
      screen.getByText(
        'This request was deleted on the gateway. The rest of this conversation is still here.',
      ),
    ).toBeVisible();
    expect(screen.getByText(turn.response!.reply)).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('My next message');
    expect(screen.getByRole('button', { name: 'Send message' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(client.send).not.toHaveBeenCalled();
    expect(client.createConversation).not.toHaveBeenCalled();
  });
  it('rejects unsupported files before uploading and discards definitely refused uploads', async () => {
    const client = mockChatClient();
    client.session.mockResolvedValue({
      ...session,
      readiness: { text: { ready: true }, audio: { ready: true } },
    });
    client.send.mockRejectedValue(new ChatApiError(409, 'CHAT_AUDIO_EXPIRED', 'Audio expired.'));
    client.discardAudio.mockRejectedValue(new Error('already expired'));
    const { container } = await load(client);
    const picker = container.querySelector<HTMLInputElement>('input[type=file]')!;
    fireEvent.change(picker, { target: { files: [] } });
    fireEvent.change(picker, {
      target: { files: [new File(['text'], 'text.txt', { type: 'text/plain' })] },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('supported audio type');
    expect(client.upload).not.toHaveBeenCalled();
    fireEvent.change(picker, {
      target: { files: [new File(['audio'], 'clip.webm', { type: 'audio/webm' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(client.discardAudio).toHaveBeenCalledOnce());
  });
  it('unknown audio acknowledgement retains its consumed upload; generic upload errors remain notices', async () => {
    const client = mockChatClient();
    client.session.mockResolvedValue({
      ...session,
      readiness: { text: { ready: true }, audio: { ready: true } },
    });
    client.send.mockRejectedValue(new TypeError('lost response'));
    const { container, unmount } = await load(client);
    const picker = container.querySelector<HTMLInputElement>('input[type=file]')!;
    fireEvent.change(picker, {
      target: { files: [new File(['audio'], 'clip.webm', { type: 'audio/webm' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('Acknowledgement unknown');
    expect(client.discardAudio).not.toHaveBeenCalled();
    unmount();
    sessionStorage.clear();
    const failed = mockChatClient();
    failed.session.mockResolvedValue({
      ...session,
      readiness: { text: { ready: true }, audio: { ready: true } },
    });
    failed.upload.mockRejectedValue(new TypeError('network'));
    const second = await load(failed);
    fireEvent.change(second.container.querySelector<HTMLInputElement>('input[type=file]')!, {
      target: { files: [new File(['audio'], 'clip.webm', { type: 'audio/webm' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Audio could not be uploaded');
  });
  it.each(['queued', 'running', 'waiting', 'paused'] as const)(
    'shows exact native %s phase with owner intervention and cancel confirmation',
    async (runStatus) => {
      const client = mockChatClient();
      client.conversations.mockResolvedValue([conversation]);
      client.turns.mockResolvedValue([{ ...turn, runStatus, response: undefined }]);
      await load(client, true);
      expect(await screen.findByRole('button', { name: 'Cancel request' })).toBeVisible();
      expect(screen.getByRole('link', { name: 'Open run' })).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
      const dialog = screen.getByRole('alertdialog');
      expect(
        within(dialog).getByText(
          'Stops this request if it’s still running. Anything it already did stays done.',
        ),
      ).toBeVisible();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Keep running' }));
      expect(client.cancel).not.toHaveBeenCalled();
    },
  );
  it('an asynchronous cancel shows Cancelling until projection is terminal and failures can be retried', async () => {
    const client = mockChatClient();
    client.conversations.mockResolvedValue([conversation]);
    client.turns.mockResolvedValue([{ ...turn, runStatus: 'paused', response: undefined }]);
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
});

describe('local recording and scroll behavior', () => {
  it('records, warns at the limit, stops tracks, discards and stops when hidden', async () => {
    const stopTrack = vi.fn();
    vi.stubGlobal('navigator', {
      onLine: true,
      mediaDevices: {
        getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop: stopTrack }] }),
      },
    });
    class Recorder {
      static isTypeSupported() {
        return true;
      }
      state = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['audio']) } as BlobEvent);
        this.onstop?.();
      }
    }
    vi.stubGlobal('MediaRecorder', Recorder);
    const client = mockChatClient();
    client.session.mockResolvedValue({
      ...session,
      readiness: { text: { ready: true }, audio: { ready: true } },
    });
    await load(client);
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Record voice message' }));
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Stop recording' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('Stop recording first.')).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(106_000));
    expect(screen.getByText(/Recording stops at 2:00/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    expect(screen.getByRole('button', { name: 'Send message' })).toHaveFocus();
    expect(stopTrack).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Remove audio' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Remove audio' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Record voice message' }));
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByRole('button', { name: 'Record voice message' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Record voice message' }));
      await Promise.resolve();
    });
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.getByRole('button', { name: 'Remove audio' })).toBeVisible();
    vi.useRealTimers();
  });
  it('leaves scroll and focus alone when a new reply arrives away from the bottom until New reply is chosen', async () => {
    const user = userEvent.setup();
    const client = mockChatClient();
    client.conversations.mockResolvedValue([conversation]);
    client.turns.mockResolvedValue([turn]);
    const { container } = await load(client);
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 5000,
    });
    try {
      await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Second message');
      client.send.mockImplementation((_id, request) =>
        Promise.resolve({
          ...turn,
          id: conversation.id,
          requestId: request.requestId,
          turn: 2,
          input: request.input,
          response: { ...turn.response!, reply: 'New reply from loop' },
        }),
      );
      await user.click(screen.getByRole('button', { name: 'Send message' }));
      expect(await screen.findByRole('button', { name: 'New reply' })).toBeVisible();
      await user.click(screen.getByRole('button', { name: 'New reply' }));
      expect(container.querySelector('[data-chat-reply]')).toHaveFocus();
      await user.click(screen.getByRole('button', { name: 'New chat' }));
      expect(client.createConversation).toHaveBeenCalledOnce();
    } finally {
      Reflect.deleteProperty(document.documentElement, 'scrollHeight');
    }
  });
});

describe('unavailable request UI', () => {
  it('removes recovery controls, keeps the current draft and restores their focus to the message box', async () => {
    sessionStorage.setItem(
      key,
      JSON.stringify({
        draft: 'Keep typing',
        pending: {
          conversationId: conversation.id,
          request: { requestId: turn.requestId, input: turn.input },
        },
      }),
    );
    const client = mockChatClient();
    client.request
      .mockRejectedValueOnce(new ChatApiError(404, 'NOT_FOUND', 'Not found.'))
      .mockRejectedValue(new ChatApiError(410, 'CHAT_HISTORY_DELETED', 'Gone.'));
    await load(client);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Check status' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Check status' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Keep typing');
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Problem: This request was deleted on the gateway. The rest of this conversation is still here.',
    );
    expect(client.send).not.toHaveBeenCalled();
  });
  it.each(['upload', 'send'] as const)(
    'an expired audio %s forgets the local recording and old upload',
    async (phase) => {
      const client = mockChatClient();
      client.session.mockResolvedValue({
        ...session,
        readiness: { text: { ready: true }, audio: { ready: true } },
      });
      const gone = new ChatApiError(410, 'CHAT_AUDIO_EXPIRED', 'Expired.');
      if (phase === 'upload') client.upload.mockRejectedValue(gone);
      else client.send.mockRejectedValue(gone);
      const { container } = await load(client);
      fireEvent.change(container.querySelector<HTMLInputElement>('input[type=file]')!, {
        target: { files: [new File(['audio'], 'clip.webm', { type: 'audio/webm' })] },
      });
      await userEvent.setup().click(screen.getByRole('button', { name: 'Send message' }));
      expect(
        await screen.findByText(
          'This voice message expired on the gateway. Record a new one or attach the file again.',
        ),
      ).toBeVisible();
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Remove audio' })).not.toBeInTheDocument(),
      );
      expect(screen.getByRole('textbox', { name: 'Message' })).not.toBeDisabled();
      expect(client.upload).toHaveBeenCalledOnce();
      expect(client.send).toHaveBeenCalledTimes(phase === 'send' ? 1 : 0);
      expect(client.discardAudio).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Retry same message' })).not.toBeInTheDocument();
    },
  );
});

describe('device voice readiness copy', () => {
  it('uses the reason code for quiet device-off guidance without rewriting runtime failures', async () => {
    const client = mockChatClient();
    client.session.mockResolvedValue({
      ...session,
      readiness: {
        text: { ready: true },
        audio: {
          ready: false,
          code: 'CHAT_AUDIO_UNAVAILABLE',
          message: 'configure chat-normalize in the published system loop to enable audio',
        },
      },
    });
    await load(client);
    const line = 'Voice messages are off for this device. The gateway owner can set them up.';
    expect(screen.getByText(line)).toBeVisible();
    const record = screen.getByRole('button', { name: 'Record voice message' });
    const attach = screen.getByRole('button', { name: 'Attach audio' });
    expect(record).toHaveAttribute('aria-describedby', 'chat-audio-reason');
    await userEvent.setup().click(record);
    expect(screen.getByRole('status')).toHaveTextContent(line);
    await userEvent.setup().click(attach);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(client.upload).not.toHaveBeenCalled();
  });
  it('keeps a different backend audio reason verbatim and preserves unknown-410 request recovery', async () => {
    sessionStorage.setItem(
      key,
      JSON.stringify({
        draft: 'Keep draft',
        pending: {
          conversationId: conversation.id,
          request: { requestId: turn.requestId, input: turn.input },
        },
      }),
    );
    const client = mockChatClient();
    client.session.mockResolvedValue({
      ...session,
      readiness: {
        text: { ready: true },
        audio: {
          ready: false,
          code: 'MODEL_UNAVAILABLE',
          message: 'The selected model is missing.',
        },
      },
    });
    client.request.mockRejectedValue(new ChatApiError(410, 'UNKNOWN', 'Ambiguous response.'));
    await load(client);
    expect(screen.getByText('The selected model is missing.')).toBeVisible();
    expect(screen.queryByText(/Voice messages are off for this device/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry same message' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Check status' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Keep draft');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry same message' }));
    expect(client.send).not.toHaveBeenCalled();
  });
});
