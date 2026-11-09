import { LoopDefinitionSchema, type LoopDefinitionInput } from '@graphgoblin/contracts';
import { fakeUlid, minimalLoop } from '@graphgoblin/contracts/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, problem } from '../__fixtures__/fake-api.js';
import { renderWith } from '../__fixtures__/render.js';
import { OwnerChatSummary } from './OwnerChatSummary.js';

function chatDefinition(model?: string): LoopDefinitionInput {
  const definition = minimalLoop();
  definition.nodes.push({
    id: 'reply',
    kind: 'inference',
    label: 'Reply',
    config: {
      harness: 'ollama',
      harnessOptions: { sandbox: 'read-only', approval: 'never' },
      ...(model ? { model } : {}),
      prompt: { template: 'Answer the message.' },
    },
  });
  return definition;
}
describe('owner published Chat model observation', () => {
  it('names explicit published Qwen, ignoring the unpublished draft and current owner defaults', async () => {
    const api = new FakeApi();
    const source = chatDefinition('qwen3.5:9b-q4_K_M');
    source.settings = { defaults: { byHarness: { ollama: { model: 'unused-loop-default' } } } };
    const loop = api.addLoop(source, { published: true, draft: true });
    api.loops.get(loop.id)!.draft!.definition = LoopDefinitionSchema.parse(
      chatDefinition('unpublished-draft-model'),
    );
    api.settingsValues = {
      defaults: { byHarness: { ollama: { model: 'different-current-owner-default' } } },
    };
    renderWith(
      <p>
        <OwnerChatSummary loopId={loop.id} />
      </p>,
      '/chat',
      api,
    );
    expect(
      await screen.findByText('Model: ollama / qwen3.5:9b-q4_K_M (explicit in published loop)'),
    ).toBeVisible();
    expect(
      screen.queryByText(
        /unpublished-draft-model|unused-loop-default|different-current-owner-default/,
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open loop' })).toHaveAttribute(
      'href',
      `/loops/${loop.id}/edit`,
    );
    expect(screen.getByRole('link', { name: 'Model settings' })).toHaveAttribute(
      'href',
      '/settings#model-defaults',
    );
    expect(
      api.calls.some((call) => call.path === '/settings' || call.path === '/system/model-defaults'),
    ).toBe(false);
  });
  it('labels a model inherited from the published loop separately from an explicit node selection', async () => {
    const api = new FakeApi();
    const source = chatDefinition();
    source.settings = { defaults: { byHarness: { ollama: { model: 'published-default-qwen' } } } };
    const loop = api.addLoop(source, { published: true });
    renderWith(<OwnerChatSummary loopId={loop.id} />, '/chat', api);
    expect(
      await screen.findByText(
        'Model: ollama / published-default-qwen (inherited from published loop default)',
      ),
    ).toBeVisible();
  });
  it('describes unresolved inheritance honestly rather than projecting current defaults onto earlier replies', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(chatDefinition(), { published: true });
    api.settingsValues = { defaults: { byHarness: { ollama: { model: 'current-default' } } } };
    renderWith(<OwnerChatSummary loopId={loop.id} />, '/chat', api);
    expect(
      await screen.findByText('Model: ollama (inherits current Settings or process defaults)'),
    ).toBeVisible();
    expect(screen.queryByText(/current-default/)).not.toBeInTheDocument();
  });
  it.each(['multiple', 'dynamic', 'subloop', 'zero'] as const)(
    'avoids a singular model claim for a %s published workflow',
    async (kind) => {
      const api = new FakeApi();
      const source =
        kind === 'zero'
          ? minimalLoop()
          : chatDefinition(kind === 'dynamic' ? '{{input.model}}' : 'qwen');
      if (kind === 'multiple')
        source.nodes.push({
          id: 'other',
          kind: 'inference',
          label: 'Other',
          config: { harness: 'codex', model: 'other-model', prompt: { template: 'Evaluate.' } },
        });
      if (kind === 'subloop')
        source.nodes.push({
          id: 'child',
          kind: 'subloop',
          label: 'Child',
          config: { loopRef: { loopId: fakeUlid('child') } },
        });
      const loop = api.addLoop(source, { published: true });
      renderWith(<OwnerChatSummary loopId={loop.id} />, '/chat', api);
      expect(await screen.findByText(/^Models:/)).toBeVisible();
      expect(screen.queryByText(/^Model: /)).not.toBeInTheDocument();
    },
  );
  it('does not treat a draft-only definition as published configuration', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(chatDefinition('draft-only-qwen'));
    renderWith(<OwnerChatSummary loopId={loop.id} />, '/chat', api);
    expect(await screen.findByText('No published model configuration')).toBeVisible();
    expect(screen.queryByText(/draft-only-qwen/)).not.toBeInTheDocument();
  });
  it('shows an unavailable observation with navigation after a failed owner lookup', async () => {
    const api = new FakeApi();
    api.override('GET /loops/:id', () => problem(503, 'UNAVAILABLE'));
    renderWith(<OwnerChatSummary loopId={fakeUlid('missing')} />, '/chat', api);
    expect(await screen.findByText('Published model configuration unavailable')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open loop' })).toBeVisible();
  });
  it('refreshes the observation on the shared settings/publish refresh event', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(chatDefinition('previous-qwen'), { published: true });
    renderWith(<OwnerChatSummary loopId={loop.id} />, '/chat', api);
    expect(await screen.findByText(/previous-qwen/)).toBeVisible();
    api.publishVersion(loop.id, chatDefinition('new-published-qwen'));
    fireEvent(window, new Event('graphgoblin:chat-readiness-changed'));
    await waitFor(() => expect(screen.getByText(/new-published-qwen/)).toBeVisible());
    expect(screen.queryByText(/previous-qwen/)).not.toBeInTheDocument();
  });
});
