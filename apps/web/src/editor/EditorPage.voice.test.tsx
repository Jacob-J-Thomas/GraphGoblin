import {
  LoopDefinitionSchema,
  VoicePreviewSchema,
  VOICE_NORMALIZER_COMMAND,
} from '@graphgoblin/contracts';
import { createSystemChatDefinition, enableChatAudio, stableHash } from '@graphgoblin/domain';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes, useLocation, useNavigate } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderWith } from '../__fixtures__/render.js';
import { voiceSetup } from '../settings/voice-client.js';
import { saveLocalDraft } from '../drafts/local-drafts.js';
import * as deviceDrafts from '../drafts/local-drafts.js';
import { EditorPage } from './EditorPage.js';
import { useEditorStore } from './store.js';

const source = LoopDefinitionSchema.parse(
  createSystemChatDefinition({ name: 'Customized chat', harness: 'codex' }),
);
const next = enableChatAudio(source, {
  id: 'chat-normalize',
  kind: 'script',
  label: 'Normalize voice',
  ui: { x: 160, y: 0 },
  config: {
    command: VOICE_NORMALIZER_COMMAND,
    args: [],
    cwd: 'workspace',
    stdin: 'thread',
    stdout: 'last-output',
  },
});
function OpenPreview({ loopId, state }: { loopId: string; state: unknown }) {
  const navigate = useNavigate();
  return (
    <button onClick={() => void navigate(`/loops/${loopId}/edit`, { state })}>
      Open voice preview
    </button>
  );
}
function HistoryProbe() {
  const navigate = useNavigate();
  const location = useLocation();
  const state: unknown = location.state;
  const preview = Boolean(state && typeof state === 'object' && 'voicePreview' in state);
  const marker =
    state && typeof state === 'object' && 'marker' in state ? String(state.marker) : '';
  return (
    <>
      <output
        data-testid="preview-route-state"
        data-preview={String(preview)}
        data-marker={marker}
      />
      <button onClick={() => void navigate(-1)}>Test back</button>
      <button onClick={() => void navigate(1)}>Test forward</button>
    </>
  );
}
function open(api: FakeApi, loopId: string, state: unknown) {
  const view = renderWith(
    <>
      <Routes>
        <Route path="/" element={<OpenPreview loopId={loopId} state={state} />} />
        <Route path="/loops/:loopId/edit" element={<EditorPage />} />
      </Routes>
      <HistoryProbe />
    </>,
    '/',
    api,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open voice preview' }));
  return view;
}
describe('editor voice route handoff', () => {
  it('consumes validated route state without applying, freezes editing for CAS, and keeps Undo after the authoritative reload', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(source, { published: true });
    const preview = VoicePreviewSchema.parse({
      loopId: loop.id,
      baseHash: stableHash(source),
      configRevision: 1,
      previewHash: stableHash(next),
      definition: next,
      message: 'Review this draft.',
    });
    let finish!: () => void;
    const stage = vi.spyOn(voiceSetup, 'stage').mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      api.saveDraftElsewhere(loop.id, next);
      return {
        loopId: loop.id,
        draftHash: preview.previewHash,
        editorUrl: `/app/loops/${loop.id}/edit`,
      };
    });
    open(api, loop.id, { voicePreview: preview, marker: 'keep this state' });
    const apply = await screen.findByRole('button', { name: 'Apply reviewed voice draft' });
    await waitFor(() => expect(apply).toBeEnabled());
    expect(stage).not.toHaveBeenCalled();
    expect(useEditorStore.getState().definition).toEqual(source);
    const generation = useEditorStore.getState().generation;
    fireEvent.click(apply);
    await waitFor(() => expect(stage).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Publish' }).closest('[inert]')).toBeInTheDocument();
    await act(() => Promise.resolve(finish()));
    await screen.findByText('Voice draft applied');
    expect(screen.getByTestId('preview-route-state')).toHaveAttribute('data-preview', 'false');
    expect(screen.getByTestId('preview-route-state')).toHaveAttribute(
      'data-marker',
      'keep this state',
    );
    expect(screen.getByTestId('location')).toHaveTextContent(`/loops/${loop.id}/edit`);
    expect(useEditorStore.getState().generation).toBe(generation);
    expect(screen.queryByText('Proposed voice step')).not.toBeInTheDocument();
    await waitFor(() => expect(api.callsTo('GET', `/loops/${loop.id}`).length).toBeGreaterThan(1));
    expect(useEditorStore.getState().past).toHaveLength(1);
    expect(useEditorStore.getState().revision).toBe(useEditorStore.getState().savedRevision);
    expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(0);
    act(() => useEditorStore.getState().undo());
    await waitFor(() => expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(1));
    expect(api.loops.get(loop.id)?.draft?.definition).toEqual(source);
    expect(api.callsTo('POST', `/loops/${loop.id}/publish`)).toHaveLength(0);
  });
  it('keeps restored device work and prevents applying a routed preview over it', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(source, { published: true });
    await saveLocalDraft({
      loopId: loop.id,
      definition: { ...source, description: 'My recovered local prompt' },
      savedAt: '2999-01-01T00:00:00.000Z',
      synced: false,
      baseToken: stableHash(source),
    });
    const stage = vi.spyOn(voiceSetup, 'stage');
    const preview = VoicePreviewSchema.parse({
      loopId: loop.id,
      baseHash: stableHash(source),
      configRevision: 1,
      previewHash: stableHash(next),
      definition: next,
      message: 'Review this draft.',
    });
    open(api, loop.id, { voicePreview: preview });
    expect(await screen.findByText(/A restored device draft is open/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Apply reviewed voice draft' })).toBeDisabled();
    expect(useEditorStore.getState().definition?.description).toBe('My recovered local prompt');
    expect(stage).not.toHaveBeenCalled();
  });
  it('reloads the staged server definition without restoring the previous clean mirror as unsaved work', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(source, { published: true });
    const preview = VoicePreviewSchema.parse({
      loopId: loop.id,
      baseHash: stableHash(source),
      configRevision: 1,
      previewHash: stableHash(next),
      definition: next,
      message: 'Review this draft.',
    });
    vi.spyOn(voiceSetup, 'stage').mockImplementation(() => {
      api.saveDraftElsewhere(loop.id, next);
      return Promise.resolve({
        loopId: loop.id,
        draftHash: preview.previewHash,
        editorUrl: `/app/loops/${loop.id}/edit`,
      });
    });
    const first = open(api, loop.id, { voicePreview: preview });
    const apply = await screen.findByRole('button', { name: 'Apply reviewed voice draft' });
    await waitFor(() => expect(apply).toBeEnabled());
    fireEvent.click(apply);
    await screen.findByText('Voice draft applied');
    first.unmount();
    act(() => useEditorStore.getState().reset());
    open(api, loop.id, {});
    await waitFor(() => expect(useEditorStore.getState().definition).toEqual(next));
    expect(
      screen.queryByText('Restored unsaved changes from this device.'),
    ).not.toBeInTheDocument();
    expect(useEditorStore.getState().baseToken).toBe(preview.previewHash);
    expect(useEditorStore.getState().revision).toBe(useEditorStore.getState().savedRevision);
  });
  it('explains a failed device draft read and recovers after a read-only retry', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(source, { published: true });
    const preview = VoicePreviewSchema.parse({
      loopId: loop.id,
      baseHash: stableHash(source),
      configRevision: 1,
      previewHash: stableHash(next),
      definition: next,
      message: 'Review this draft.',
    });
    const read = vi
      .spyOn(deviceDrafts, 'loadLocalDraft')
      .mockRejectedValue(new Error('Device storage refused this read.'));
    const stage = vi.spyOn(voiceSetup, 'stage');
    open(api, loop.id, { voicePreview: preview });
    expect(
      await screen.findByText(/This device’s draft storage is unavailable, so Apply is paused/),
    ).toBeVisible();
    expect(
      screen.queryByText(/Wait for the server and this device’s draft to finish loading/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply reviewed voice draft' })).toBeDisabled();
    read.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'Retry device draft storage' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Apply reviewed voice draft' })).toBeEnabled(),
    );
    expect(stage).not.toHaveBeenCalled();
    expect(useEditorStore.getState().definition).toEqual(source);
  });
  it('removes a consumed preview from its history entry so it does not return on Back and Forward', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(source, { published: true });
    const preview = VoicePreviewSchema.parse({
      loopId: loop.id,
      baseHash: stableHash(source),
      configRevision: 1,
      previewHash: stableHash(next),
      definition: next,
      message: 'Review this draft.',
    });
    const stage = vi.spyOn(voiceSetup, 'stage').mockImplementation(() => {
      api.saveDraftElsewhere(loop.id, next);
      return Promise.resolve({
        loopId: loop.id,
        draftHash: preview.previewHash,
        editorUrl: `/app/loops/${loop.id}/edit`,
      });
    });
    open(api, loop.id, { voicePreview: preview, marker: 'preserved' });
    const apply = await screen.findByRole('button', { name: 'Apply reviewed voice draft' });
    await waitFor(() => expect(apply).toBeEnabled());
    fireEvent.click(apply);
    await screen.findByText('Voice draft applied');
    fireEvent.click(screen.getByRole('button', { name: 'Test back' }));
    await screen.findByRole('button', { name: 'Open voice preview' });
    fireEvent.click(screen.getByRole('button', { name: 'Test forward' }));
    await screen.findByRole('heading', { name: 'Customized chat' });
    expect(screen.getByTestId('preview-route-state')).toHaveAttribute('data-preview', 'false');
    expect(screen.getByTestId('preview-route-state')).toHaveAttribute('data-marker', 'preserved');
    expect(
      screen.queryByRole('button', { name: 'Apply reviewed voice draft' }),
    ).not.toBeInTheDocument();
    expect(stage).toHaveBeenCalledOnce();
  });
});
