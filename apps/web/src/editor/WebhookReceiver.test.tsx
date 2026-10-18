import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { FakeApi, problem } from '../__fixtures__/fake-api.js';
import { renderWith } from '../__fixtures__/render.js';
import { keys } from '../api/queries.js';
import { WebhookReceiver } from './WebhookReceiver.js';

const token = 'synthetic-endpoint-token';
const fullUrl = `http://graphgoblin.test/hooks/${token}`;
const maskedUrl = 'http://graphgoblin.test/hooks/••••••••';
const endpoint = { triggerNodeId: 'start', path: `/hooks/${token}`, enabled: true };
const listing = (webhooks = [endpoint]) => Response.json({ schedules: [], polls: [], webhooks });

function setup(api = new FakeApi()) {
  return renderWith(<WebhookReceiver loopId="L1" nodeId="start" />, '/', api);
}

function published() {
  const api = new FakeApi();
  api.override('GET /loops/:id/triggers', () => listing());
  return api;
}

it('names the section and output, masks the token throughout the DOM, and explains the address', async () => {
  setup(published());
  expect(await screen.findByLabelText('Receiver URL')).toHaveTextContent(maskedUrl);
  expect(screen.getByRole('region', { name: 'Receiver' })).toBeVisible();
  expect(document.body.innerHTML).not.toContain(token);
  expect(screen.getByText(/Other programs send POST requests/)).toHaveTextContent(
    'The URL contains a secret token, so treat it like a password.',
  );
  expect(screen.getByText(/This is the published receiver/)).toHaveTextContent(
    'publish again to apply draft changes.',
  );
  expect(document.body.textContent).not.toMatch(/signing|curl|HMAC/i);
});

it('reveals and hides the full URL with keyboard controls', async () => {
  const user = userEvent.setup();
  setup(published());
  const url = await screen.findByLabelText('Receiver URL');
  await user.tab();
  expect(screen.getByRole('button', { name: 'Reveal' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(url).toHaveTextContent(fullUrl);
  expect(screen.getByRole('button', { name: 'Hide' })).toHaveFocus();
  await user.keyboard(' ');
  expect(url).toHaveTextContent(maskedUrl);
  expect(document.body.innerHTML).not.toContain(token);
});

it('copies the full address without revealing it and politely reports success', async () => {
  const user = userEvent.setup();
  setup(published());
  await screen.findByLabelText('Receiver URL');
  await user.tab();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Copy receiver URL' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(await navigator.clipboard.readText()).toBe(fullUrl);
  expect(await screen.findByText('Receiver URL copied.')).toHaveAttribute('aria-live', 'polite');
  expect(screen.getByLabelText('Receiver URL')).toHaveTextContent(maskedUrl);
  expect(document.body.innerHTML).not.toContain(token);
});

it('reports clipboard refusal without exposing the error or token', async () => {
  const user = userEvent.setup();
  setup(published());
  await screen.findByLabelText('Receiver URL');
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error(`private ${token}`));
  await user.click(screen.getByRole('button', { name: 'Copy receiver URL' }));
  expect(
    await screen.findByText('Copy failed. Check clipboard access and try again.'),
  ).toHaveAttribute('aria-live', 'polite');
  expect(document.body.innerHTML).not.toContain(token);
  expect(document.body.textContent).not.toContain('private');
});

it.each([
  ['unpublished', []],
  ['disabled', [{ ...endpoint, enabled: false }]],
  ['another node', [{ ...endpoint, triggerNodeId: 'other' }]],
] as const)('explains why the %s receiver has no address', async (_state, webhooks) => {
  const api = new FakeApi();
  api.override('GET /loops/:id/triggers', () => listing([...webhooks]));
  setup(api);
  expect(
    await screen.findByText(
      'The receiver URL appears after publishing an enabled webhook trigger.',
    ),
  ).toBeVisible();
  expect(screen.queryByLabelText('Receiver URL')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
});

it('shows loading until the listing arrives', async () => {
  let resolve!: (response: Response) => void;
  const api = new FakeApi();
  api.override(
    'GET /loops/:id/triggers',
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  setup(api);
  expect(screen.getByText('Loading receiver…')).toBeVisible();
  expect(screen.queryByLabelText('Receiver URL')).toBeNull();
  act(() => resolve(listing()));
  expect(await screen.findByLabelText('Receiver URL')).toHaveTextContent(maskedUrl);
});

it('offers Retry after a failed request and refetches without showing transport details', async () => {
  const user = userEvent.setup();
  const handler = vi
    .fn()
    .mockImplementationOnce(() => problem(500, 'UNAVAILABLE', `private ${token}`))
    .mockImplementation(() => listing());
  const api = new FakeApi();
  api.override('GET /loops/:id/triggers', handler);
  setup(api);
  expect(await screen.findByText('Receiver could not be loaded. Try again.')).toBeVisible();
  expect(handler).toHaveBeenCalledTimes(1);
  expect(document.body.innerHTML).not.toContain(token);
  expect(screen.queryByLabelText('Receiver URL')).toBeNull();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Retry' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(await screen.findByLabelText('Receiver URL')).toHaveTextContent(maskedUrl);
  expect(handler).toHaveBeenCalledTimes(2);
});

it('selects the enabled receiver for this node among several webhooks', async () => {
  const api = new FakeApi();
  api.override('GET /loops/:id/triggers', () =>
    listing([
      { ...endpoint, triggerNodeId: 'other', path: '/hooks/wrong-node' },
      { ...endpoint, enabled: false, path: '/hooks/disabled' },
      endpoint,
    ]),
  );
  const user = userEvent.setup();
  setup(api);
  await screen.findByLabelText('Receiver URL');
  await user.click(screen.getByRole('button', { name: 'Reveal' }));
  expect(screen.getByLabelText('Receiver URL')).toHaveTextContent(fullUrl);
  expect(document.body.innerHTML).not.toMatch(/\/hooks\/wrong-node|\/hooks\/disabled/);
});

it('masks a replacement endpoint even if the previous address was revealed', async () => {
  const user = userEvent.setup();
  const api = published();
  const { queryClient } = setup(api);
  await screen.findByLabelText('Receiver URL');
  await user.click(screen.getByRole('button', { name: 'Reveal' }));
  api.override('GET /loops/:id/triggers', () =>
    listing([{ ...endpoint, path: '/hooks/new-token' }]),
  );
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: keys.loop('L1') });
  });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Reveal' })).toBeVisible());
  expect(screen.getByLabelText('Receiver URL')).toHaveTextContent(maskedUrl);
  expect(document.body.innerHTML).not.toMatch(/synthetic-endpoint-token|new-token/);
});
