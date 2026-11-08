import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { useApiKeyStore } from '../api/api-key.js';
import { mockChatClient, session } from '../chat/__fixtures__/chat.js';
import { ChatPage } from './ChatPage.js';
const data = vi.hoisted(() => ({
  client: undefined as ReturnType<typeof mockChatClient> | undefined,
}));
vi.mock('./OwnerChatSummary.js', () => ({
  OwnerChatSummary: () => <span>Owner published summary</span>,
}));
vi.mock('./useOwnerChatClient.js', () => ({ useOwnerChatClient: () => data.client }));
vi.mock('../settings/VoiceSetupSheet.js', () => ({
  VoiceSetupSheet: ({
    open,
    onClose,
    onSaved,
  }: {
    open: boolean;
    onClose: () => void;
    onSaved: () => void;
  }) =>
    open ? (
      <div role="dialog">
        <button onClick={onSaved}>Save voice</button>
        <button onClick={onClose}>Close voice</button>
      </div>
    ) : null,
}));
describe('owner Chat composition', () => {
  it('hides Chat after authoritative rejection and still permits trusted local mode without a stored key', async () => {
    data.client = mockChatClient();
    useApiKeyStore.setState({ key: undefined, rejected: true });
    const view = render(
      <MemoryRouter>
        <ChatPage />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('region', { name: 'Chat' })).not.toBeInTheDocument();
    useApiKeyStore.setState({ rejected: false });
    expect(await screen.findByRole('region', { name: 'Chat' })).toBeVisible();
    view.unmount();
  });
  it('opens guided voice setup and refreshes readiness when settings are saved', async () => {
    data.client = mockChatClient();
    data.client.session.mockResolvedValue({
      ...session,
      readiness: { text: { ready: true }, audio: { ready: false, code: 'CHAT_AUDIO_UNAVAILABLE' } },
    });
    useApiKeyStore.setState({ rejected: false });
    render(
      <MemoryRouter>
        <ChatPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(data.client?.session).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Record voice message' }));
    expect(await screen.findByRole('dialog')).toBeVisible();
    const before = data.client.session.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Save voice' }));
    await waitFor(() => expect(data.client?.session.mock.calls.length).toBeGreaterThan(before));
    fireEvent.click(screen.getByRole('button', { name: 'Close voice' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
