import { screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { StorageStatus } from '@graphgoblin/contracts';
import { FakeApi, problem } from '../__fixtures__/fake-api.js';
import { renderWith } from '../__fixtures__/render.js';
import { StorageNotice } from './StorageNotice.js';

const status = (state: StorageStatus['state']): StorageStatus => ({
  state,
  checkedAt: null,
  volumes: [],
  cleaning: false,
  deletedRuns: 0,
  removedFileBytes: 0,
  reusableDatabaseBytes: 0,
  pendingResources: 0,
  preservedResources: 0,
});
it('is absent while storage is adequate and never sends a deletion command', async () => {
  const api = new FakeApi();
  renderWith(<StorageNotice />, '/', api);
  await waitFor(() => expect(api.callsTo('GET', '/system/storage')).toHaveLength(1));
  expect(screen.queryByRole('status', { name: 'Storage pressure' })).not.toBeInTheDocument();
  expect(api.calls.some((call) => call.method !== 'GET')).toBe(false);
});
it.each([
  ['pressure', /only history you marked delete-ready/],
  ['no-eligible', /No approved eligible history/],
  ['unavailable', /could not finish/],
] as const)('shows a subtle accessible %s warning with a review link', async (state, message) => {
  const api = new FakeApi();
  api.override('GET /system/storage', () =>
    Response.json({ ...status(state), preservedResources: 1 }),
  );
  renderWith(<StorageNotice />, '/', api);
  const notice = await screen.findByRole('status', { name: 'Storage pressure' });
  expect(notice).toHaveAttribute('aria-live', 'polite');
  expect(notice).toHaveTextContent(message);
  expect(notice).toHaveTextContent('Shared, linked or unproven resources are kept.');
  expect(screen.getByRole('link', { name: 'Review run history' })).toHaveAttribute('href', '/runs');
});
it('does not imply adequate storage or consent when observation is forbidden', async () => {
  const api = new FakeApi();
  api.override('GET /system/storage', () => problem(403, 'FORBIDDEN', 'No access'));
  renderWith(<StorageNotice />, '/', api);
  await waitFor(() => expect(api.callsTo('GET', '/system/storage')).toHaveLength(1));
  expect(screen.queryByRole('status', { name: 'Storage pressure' })).not.toBeInTheDocument();
});
