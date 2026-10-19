import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HarnessReadinessStateSchema } from '@graphgoblin/contracts';
import { readinessMessage } from '@graphgoblin/domain';
import { FakeApi, problem } from '../../__fixtures__/fake-api.js';
import { renderWith } from '../../__fixtures__/render.js';
import { keys } from '../../api/queries.js';
import { PreflightSection } from './PreflightSection.js';

describe('readiness state display', () => {
  it.each(HarnessReadinessStateSchema.options)(
    'shows %s without implying model access',
    async (state) => {
      const api = new FakeApi();
      api.preflight = [
        {
          harness: 'claude',
          state,
          ok: state === 'ready',
          authenticated: state === 'ready',
          problems: state === 'ready' ? [] : [readinessMessage('claude', state)],
          models: [{ model: 'claude-opus-5-5', efforts: ['high'] }],
        },
      ];
      renderWith(<PreflightSection />, '/', api);
      expect(await screen.findByText(state)).toBeInTheDocument();
      expect(screen.getByText('listed by adapter')).toBeInTheDocument();
      expect(screen.getByText(/do not confirm account access/)).toBeInTheDocument();
      expect(screen.queryByText(/supported by adapter|model unavailable/)).toBeNull();
    },
  );
  it('shows checking while pending and unknown when a fresh lookup fails, even with cached ready data', async () => {
    const api = new FakeApi();
    const { queryClient } = renderWith(<PreflightSection />, '/', api);
    expect(await screen.findByText('ready')).toBeInTheDocument();
    let finish!: (response: Response) => void;
    api.override(
      'GET /harness/preflight',
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    let refresh!: Promise<void>;
    act(() => {
      refresh = queryClient.refetchQueries({ queryKey: keys.preflight });
    });
    expect(await screen.findByText('checking')).toBeInTheDocument();
    expect(screen.queryByText('ready')).toBeNull();
    await act(async () => {
      finish(problem(503, 'FAILED', 'Temporary failure'));
      await refresh;
    });
    await waitFor(() => expect(screen.getByText(/Harness readiness unknown/)).toBeInTheDocument());
    expect(screen.queryByText('ready')).toBeNull();
  });
});
