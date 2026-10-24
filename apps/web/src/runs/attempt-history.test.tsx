import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { sampleThread } from '@graphgoblin/contracts/testing';
import { ContextThreadSchema } from '@graphgoblin/contracts';
import { event, FakeApi, queuedFields } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { useRunEventStore } from './event-store.js';

it.each([false, true])(
  'an inspector with cached failure=%s follows a remote resume and success',
  async (cached) => {
    const api = new FakeApi();
    const run = api.addRun({
      status: 'failed',
      lastEventSeq: 5,
      failure: { code: 'SCRIPT_EXIT_CODE', message: 'controlled', resumable: true, nodeId: 'work' },
    });
    const seed = sampleThread({
      vars: {},
      counters: {
        nodeVisits: {},
        usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0 },
      },
    });
    api.threads.set(run.id, seed);
    const failed = [
      event(run.id, 1, 'run.queued', { ...queuedFields(), initialThread: seed }),
      event(run.id, 2, 'node.started', {
        nodeId: 'prepare',
        kind: 'mutate',
        attempt: 1,
        configHash: 'h',
      }),
      event(run.id, 3, 'node.finished', {
        nodeId: 'prepare',
        patch: [{ op: 'add', path: '/vars/prepared', value: true }],
        durationMs: 1,
      }),
      event(run.id, 4, 'node.started', {
        nodeId: 'work',
        kind: 'script',
        attempt: 1,
        configHash: 'h',
      }),
      event(run.id, 5, 'run.failed', { failure: run.failure! }),
    ];
    for (const e of failed) api.pushEvent(run.id, e);
    if (cached) useRunEventStore.getState().append(run.id, ...failed);
    const view = renderApp('/runs/' + run.id, api);
    try {
      await screen.findByRole('button', { name: 'Full thread JSON' });
      fireEvent.click(screen.getByRole('button', { name: 'Full thread JSON' }));
      const thread = () =>
        ContextThreadSchema.parse(JSON.parse(screen.getByTestId('thread-json').textContent ?? ''));
      await waitFor(() => expect(thread().vars).toEqual({ prepared: true }));
      act(() => {
        api.runs.set(run.id, { ...run, status: 'running', failure: undefined, lastEventSeq: 7 });
        api.pushEvent(
          run.id,
          event(run.id, 6, 'run.resumed', { actor: { kind: 'user', id: 'test' } }),
        );
        api.pushEvent(
          run.id,
          event(run.id, 7, 'node.started', {
            nodeId: 'work',
            kind: 'script',
            attempt: 2,
            configHash: 'h',
          }),
        );
      });
      await waitFor(() => expect(thread().counters.nodeVisits.work).toBe(2), { timeout: 6000 });
      expect(thread().vars).toEqual({ prepared: true });
      act(() => {
        api.runs.set(run.id, { ...run, status: 'succeeded', failure: undefined, lastEventSeq: 9 });
        api.pushEvent(
          run.id,
          event(run.id, 8, 'node.finished', {
            nodeId: 'work',
            durationMs: 1,
            patch: [{ op: 'add', path: '/vars/completed', value: true }],
          }),
        );
        api.pushEvent(
          run.id,
          event(run.id, 9, 'run.finished', { status: 'succeeded', outcome: 'success' }),
        );
      });
      await waitFor(() => expect(thread().vars).toEqual({ prepared: true, completed: true }), {
        timeout: 6000,
      });
    } finally {
      view.unmount();
      view.queryClient.clear();
      useRunEventStore.getState().clear(run.id);
    }
  },
  20_000,
);
