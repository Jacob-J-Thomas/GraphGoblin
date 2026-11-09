import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevicesPage } from './DevicesPage.js';
import { ChatApiError } from './client.js';
import { conversation, device, mockChatClient } from './__fixtures__/chat.js';
function renderDevices(client = mockChatClient()) {
  render(
    <MemoryRouter>
      <DevicesPage client={client} />
    </MemoryRouter>,
  );
  return client;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('owner chat devices', () => {
  it('checks prerequisites before creating a code and labels the local link for this computer', async () => {
    const user = userEvent.setup();
    const client = mockChatClient();
    client.pairingReadiness.mockResolvedValue({
      ready: true,
      mode: 'same-machine',
      url: 'http://127.0.0.1:4747/goblin/',
      message: 'This computer only.',
    });
    client.createPairing.mockResolvedValue({
      id: device.id,
      code: 'A'.repeat(43),
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      url: `http://127.0.0.1:4747/goblin/#pair=${'A'.repeat(43)}`,
    });
    renderDevices(client);
    await user.click(await screen.findByRole('button', { name: 'Pair a device' }));
    expect(await screen.findByRole('heading', { name: 'This computer only' })).toBeVisible();
    expect(client.pairingReadiness).toHaveBeenCalledOnce();
    expect(client.createPairing).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Generate pairing link' }));
    expect(
      await screen.findByRole('link', { name: 'Open Goblin on this computer' }),
    ).toHaveAttribute('href', expect.stringContaining('127.0.0.1:4747/goblin/#pair='));
    expect(screen.queryByRole('img', { name: /Scan this pairing link/ })).not.toBeInTheDocument();
  });
  it('keeps code generation unavailable until setup is ready and supports a read-only recheck', async () => {
    const user = userEvent.setup();
    const client = mockChatClient();
    client.pairingReadiness.mockResolvedValueOnce({
      ready: false,
      mode: 'unavailable',
      code: 'CHAT_PAIRING_AUTH_REQUIRED',
      message: 'Enable required owner authentication.',
    });
    renderDevices(client);
    await user.click(await screen.findByRole('button', { name: 'Pair a device' }));
    expect(await screen.findByText('Enable required owner authentication.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Generate pairing link' })).not.toBeInTheDocument();
    expect(client.createPairing).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Check setup again' }));
    expect(await screen.findByRole('button', { name: 'Generate pairing link' })).toBeVisible();
    expect(client.createPairing).not.toHaveBeenCalled();
  });

  it('reports a readiness check failure truthfully and retries the check without creating a code', async () => {
    const user = userEvent.setup();
    const client = mockChatClient();
    client.pairingReadiness.mockRejectedValueOnce(new TypeError('offline'));
    renderDevices(client);
    await user.click(await screen.findByRole('button', { name: 'Pair a device' }));
    expect(await screen.findByText('Couldn’t check pairing setup.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Generate pairing link' })).toBeVisible();
    expect(client.pairingReadiness).toHaveBeenCalledTimes(2);
    expect(client.createPairing).not.toHaveBeenCalled();
  });
  it('rechecks prerequisites after generation reports that setup changed', async () => {
    const user = userEvent.setup();
    const client = mockChatClient();
    client.createPairing.mockRejectedValueOnce(
      new ChatApiError(409, 'CHAT_PAIRING_UNAVAILABLE', 'Setup changed.'),
    );
    renderDevices(client);
    await user.click(await screen.findByRole('button', { name: 'Pair a device' }));
    await user.click(await screen.findByRole('button', { name: 'Generate pairing link' }));
    expect(await screen.findByText('Setup changed.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Generate pairing link' })).toBeVisible();
    expect(client.pairingReadiness).toHaveBeenCalledTimes(2);
    expect(client.createPairing).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Generate pairing link' }));
    expect(await screen.findByLabelText('Pairing code')).toBeVisible();
  });
  it('shows no-device state and creates an exact-case short-lived pairing link only on request', async () => {
    const user = userEvent.setup();
    const client = mockChatClient();
    client.devices.mockResolvedValue([]);
    renderDevices(client);
    expect(await screen.findByRole('heading', { name: 'No devices yet' })).toBeVisible();
    expect(client.createPairing).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Pair a device' }));
    await user.click(await screen.findByRole('button', { name: 'Generate pairing link' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('textbox', { name: 'Device name' })).not.toBeInTheDocument();
    await within(dialog).findByLabelText('Pairing code');
    expect(within(dialog).getByRole('img', { name: /Scan this pairing link/ })).toHaveAttribute(
      'src',
      expect.stringContaining('data:image/gif;base64,'),
    );
    expect(client.createPairing).toHaveBeenCalledOnce();
    expect(within(dialog).getByLabelText('Pairing code')).toHaveTextContent('A'.repeat(43));
    expect(within(dialog).getByText(/Closing doesn’t cancel the link/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Copy code' }));
    expect(await navigator.clipboard.readText()).toBe('A'.repeat(43));
    await user.click(within(dialog).getByRole('button', { name: 'Copy pairing link' }));
    expect(await navigator.clipboard.readText()).toContain('#pair=');
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(client.devices).toHaveBeenCalledTimes(2);
  });
  it('sorts active before revoked, retains revoked loops, and revokes using explicit confirmation', async () => {
    const user = userEvent.setup();
    const client = mockChatClient();
    client.devices.mockResolvedValue([
      { ...device, id: 'revoked-device', label: 'Old phone', revokedAt: conversation.createdAt },
      device,
    ]);
    renderDevices(client);
    const row = (await screen.findByText('Kitchen tablet')).closest('tr')!;
    expect(within(row).getByText('Active')).toBeVisible();
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Kitchen tablet');
    const revoked = screen.getByText('Old phone').closest('tr')!;
    expect(within(revoked).getByText('Revoked')).toBeVisible();
    expect(within(revoked).queryByRole('button')).not.toBeInTheDocument();
    expect(within(revoked).getByRole('link', { name: 'Open chat loop' })).toBeVisible();
    await user.click(within(row).getByRole('button', { name: 'Revoke Kitchen tablet' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/Requests it already sent may keep running/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Confirm revoke Kitchen tablet' }));
    await waitFor(() => expect(client.revokeDevice).toHaveBeenCalledWith(device.id));
  });
  it('validates rename input, preserves exact loop name, and saves only label', async () => {
    const user = userEvent.setup();
    const client = renderDevices();
    await user.click(await screen.findByRole('button', { name: 'Rename Kitchen tablet' }));
    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByRole('textbox', { name: 'Device name' });
    await user.clear(input);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter a name.');
    fireEvent.change(input, { target: { value: 'a'.repeat(81) } });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Use 80 characters or fewer.');
    fireEvent.change(input, { target: { value: '  Hall tablet  ' } });
    expect(input).toHaveValue('  Hall tablet  ');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(client.renameDevice).toHaveBeenCalledWith(device.id, 'Hall tablet');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('shows rename failure in the field and allows cancellation', async () => {
    const user = userEvent.setup();
    const client = mockChatClient();
    client.renameDevice.mockRejectedValue(new ChatApiError(409, 'DENIED', 'Rename failed.'));
    renderDevices(client);
    await user.click(await screen.findByRole('button', { name: 'Rename Kitchen tablet' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Rename failed.');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('reports read and pairing prerequisite errors, with explicit retry', async () => {
    const user = userEvent.setup();
    const client = mockChatClient();
    client.devices.mockRejectedValueOnce(new TypeError('offline'));
    renderDevices(client);
    expect(await screen.findByRole('alert')).toHaveTextContent('gateway could not be reached');
    await user.click(screen.getByRole('button', { name: 'Retry now' }));
    await screen.findByText('Kitchen tablet');
    client.createPairing.mockRejectedValueOnce(
      new ChatApiError(
        409,
        'CHAT_PAIRING_UNAVAILABLE',
        'Set GG_PUBLIC_URL and require owner authorization.',
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Pair a device' }));
    await user.click(await screen.findByRole('button', { name: 'Generate pairing link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('GG_PUBLIC_URL');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await user.click(await screen.findByRole('button', { name: 'Generate pairing link' }));
    expect(await screen.findByLabelText('Pairing code')).toBeVisible();
  });
  it('shows expiry and new-code action without inventing a cancellation endpoint', async () => {
    const user = userEvent.setup();
    const client = mockChatClient();
    client.createPairing.mockResolvedValue({
      id: device.id,
      code: 'Mixed_CASE_Exact',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    renderDevices(client);
    await user.click(await screen.findByRole('button', { name: 'Pair a device' }));
    await user.click(await screen.findByRole('button', { name: 'Generate pairing link' }));
    expect(await screen.findByText(/This pairing link expired at/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Cancel pairing' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create new link' }));
    expect(client.createPairing).toHaveBeenCalledTimes(2);
  });
  it('manual-code fallback works without a URL, and failed clipboard remains selectable', async () => {
    const user = userEvent.setup();
    const client = mockChatClient();
    client.createPairing.mockResolvedValue({
      id: device.id,
      code: 'Exact_code',
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    });
    renderDevices(client);
    await user.click(await screen.findByRole('button', { name: 'Pair a device' }));
    await user.click(await screen.findByRole('button', { name: 'Generate pairing link' }));
    expect(await screen.findByText('Open this gateway’s Goblin app on the device.')).toBeVisible();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('blocked'));
    await user.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Select the code and copy it yourself.',
    );
    expect(screen.getByLabelText('Pairing code')).toHaveTextContent('Exact_code');
  });
  it('shows actual last-seen date and countdown updates', async () => {
    const user = userEvent.setup();
    const client = mockChatClient();
    client.devices.mockResolvedValue([{ ...device, lastSeenAt: conversation.createdAt }]);
    renderDevices(client);
    await screen.findByText('Kitchen tablet');
    expect(document.querySelector('time')).toHaveAttribute('datetime', conversation.createdAt);
    await user.click(screen.getByRole('button', { name: 'Pair a device' }));
    await user.click(await screen.findByRole('button', { name: 'Generate pairing link' }));
    vi.useFakeTimers();
    await act(() => vi.advanceTimersByTimeAsync(1100));
    expect(screen.getByText(/Closing doesn’t cancel the link/)).toBeVisible();
  });
});

describe('pairing expiry and clipboard lifecycle', () => {
  it('announces only the minute and expiry and restores focus from a removed copy button', async () => {
    vi.useFakeTimers();
    const client = mockChatClient();
    client.createPairing.mockResolvedValue({
      id: device.id,
      code: 'A'.repeat(43),
      url: 'https://example.com/goblin/#pair=secret',
      expiresAt: new Date(Date.now() + 62_000).toISOString(),
    });
    renderDevices(client);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pair a device' }));
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate pairing link' }));
    await act(async () => {
      await Promise.resolve();
    });
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(within(screen.getByRole('dialog')).getAllByRole('status').at(-1)).toHaveTextContent(
      'Pairing link expires in 1 minute.',
    );
    screen.getByRole('button', { name: 'Copy code' }).focus();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(screen.getByRole('button', { name: 'Create new link' })).toHaveFocus();
    expect(within(screen.getByRole('dialog')).getAllByRole('status').at(-1)).toHaveTextContent(
      'Pairing link expired.',
    );
  });
  it('offers the full pairing link only as a selectable clipboard failure fallback', async () => {
    const user = userEvent.setup();
    const client = renderDevices();
    await user.click(await screen.findByRole('button', { name: 'Pair a device' }));
    await user.click(await screen.findByRole('button', { name: 'Generate pairing link' }));
    await screen.findByLabelText('Pairing code');
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    await user.click(screen.getByRole('button', { name: 'Copy pairing link' }));
    expect(await screen.findByLabelText('Pairing link')).toHaveTextContent('#pair=');
    expect(screen.getByRole('alert')).toHaveTextContent('Select the link below');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(client.devices).toHaveBeenCalledTimes(2);
  });
  it('orders revoked devices by most recent revocation and accepts duplicate names', async () => {
    const client = mockChatClient();
    client.devices.mockResolvedValue([
      { ...device, id: 'older', revokedAt: '2026-01-01T00:00:00.000Z' },
      { ...device, id: 'newer', revokedAt: '2026-11-01T00:00:00.000Z' },
    ]);
    renderDevices(client);
    await screen.findAllByText(device.label);
    expect(screen.getAllByRole('row')[1]).toHaveAttribute('id', 'device-newer');
  });
});
