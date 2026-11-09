import { GraphGoblinApiError } from '@graphgoblin/api-client';
import {
  LoopDefinitionSchema,
  VoicePreviewSchema,
  VOICE_NORMALIZER_COMMAND,
} from '@graphgoblin/contracts';
import { createSystemChatDefinition, enableChatAudio, stableHash } from '@graphgoblin/domain';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWith } from '../__fixtures__/render.js';
import { voiceSetup } from '../settings/voice-client.js';
import { useEditorStore } from './store.js';
import { VoiceCustomReviewNotice, VoicePreviewNotice } from './VoicePreviewNotice.js';

const loopId = '01J00000000000000000000001';
const otherLoop = '01J00000000000000000000002';
const source = LoopDefinitionSchema.parse(
  createSystemChatDefinition({ name: 'My custom chat', harness: 'codex' }),
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
const preview = VoicePreviewSchema.parse({
  loopId,
  baseHash: stableHash(source),
  configRevision: 3,
  previewHash: stableHash(next),
  definition: next,
  message: 'Review this exact draft change.',
});
const result = { loopId, draftHash: preview.previewHash, editorUrl: `/app/loops/${loopId}/edit` };
const store = () => useEditorStore.getState();
function show(
  value: unknown = preview,
  options: {
    restored?: boolean;
    ready?: boolean;
    storageUnavailableReason?: string;
    onRetryStorage?: () => void;
  } = {},
) {
  const staging = vi.fn();
  const view = renderWith(
    <VoicePreviewNotice
      value={value}
      loopId={loopId}
      ready={options.ready ?? true}
      restored={options.restored ?? false}
      onStagingChange={staging}
      storageUnavailableReason={options.storageUnavailableReason}
      onRetryStorage={options.onRetryStorage}
    />,
  );
  return { ...view, staging };
}
beforeEach(() => {
  store().load(loopId, source, { baseToken: preview.baseHash });
});

describe('reviewed voice draft handoff', () => {
  it('shows a concrete read-only preview and stages only after Apply, retaining Undo and never publishing', async () => {
    const stage = vi.spyOn(voiceSetup, 'stage').mockResolvedValue(result);
    const view = show();
    expect(screen.getByText('Review this exact draft change.')).toBeVisible();
    expect(screen.getByText('Proposed voice step').closest('details')).toHaveTextContent(
      VOICE_NORMALIZER_COMMAND,
    );
    expect(stage).not.toHaveBeenCalled();
    expect(store().definition).toBe(source);
    fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed voice draft' }));
    expect(await screen.findByText('Voice draft applied')).toBeVisible();
    expect(stage).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      loopId,
      expectedDraftHash: preview.baseHash,
      expectedConfigRevision: 3,
      expectedPreviewHash: preview.previewHash,
    });
    expect(view.staging.mock.calls).toEqual([[true], [false]]);
    expect(store().definition).toEqual(next);
    expect(store().baseToken).toBe(preview.previewHash);
    expect(store().revision).toBe(store().savedRevision);
    expect(store().saveState).toBe('saved');
    act(() => store().undo());
    expect(store().definition).toEqual(source);
    expect(store().revision).toBeGreaterThan(store().savedRevision);
    expect(store().baseToken).toBe(preview.previewHash);
    expect(store().saveState).toBe('pending');
    expect(view.api.calls).toEqual([]);
  });
  it.each([
    ['another loop', { ...preview, loopId: otherLoop }, false, /belongs to another loop/],
    [
      'stale draft hash',
      { ...preview, baseHash: '0'.repeat(16) },
      false,
      /draft changed after the preview/,
    ],
    ['recovered local draft', preview, true, /restored device draft is open/],
  ])('preserves %s without applying', (_name, value, restored, reason) => {
    const stage = vi.spyOn(voiceSetup, 'stage');
    show(value, { restored });
    expect(screen.getByText(reason)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Apply reviewed voice draft' })).toBeDisabled();
    expect(stage).not.toHaveBeenCalled();
    expect(store().definition).toBe(source);
  });
  it('keeps dirty text and unfinished fields while a preview remains read-only', () => {
    const stage = vi.spyOn(voiceSetup, 'stage');
    act(() => store().updateMeta({ description: 'Unsent owner changes' }));
    act(() =>
      store().setFieldError('node:chat-inference', 'prompt', {
        text: 'half-edited',
        message: 'Complete this field.',
      }),
    );
    const before = store();
    show();
    expect(screen.getByText(/local changes or unfinished fields/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Apply reviewed voice draft' })).toBeDisabled();
    expect(stage).not.toHaveBeenCalled();
    expect(store().definition).toBe(before.definition);
    expect(store().fieldErrors).toBe(before.fieldErrors);
  });
  it('reports a stale configuration CAS failure without modifying the editor', async () => {
    const stage = vi
      .spyOn(voiceSetup, 'stage')
      .mockRejectedValue(new GraphGoblinApiError({ status: 409, code: 'VOICE_CONFIG_STALE' }));
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed voice draft' }));
    expect(await screen.findByText(/Voice settings or this loop changed/)).toBeVisible();
    expect(stage).toHaveBeenCalledOnce();
    expect(store().definition).toBe(source);
    expect(store().past).toEqual([]);
  });
  it('preserves edits that unexpectedly change generation while staging is in flight', async () => {
    let finish!: (value: typeof result) => void;
    const stage = vi.spyOn(voiceSetup, 'stage').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed voice draft' }));
    await waitFor(() => expect(stage).toHaveBeenCalledOnce());
    act(() => store().load(otherLoop, { ...source, name: 'Newly opened work' }));
    await act(async () => {
      finish(result);
      await Promise.resolve();
    });
    expect(
      await screen.findByText(/gateway staged the voice draft, but this editor changed/),
    ).toBeVisible();
    expect(store().loopId).toBe(otherLoop);
    expect(store().definition?.name).toBe('Newly opened work');
  });
  it('refuses malformed route state and a mismatched stage acknowledgement', async () => {
    const first = show({ definition: 'bad input' });
    expect(screen.getByText('Voice preview could not be opened')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Apply reviewed voice draft' }),
    ).not.toBeInTheDocument();
    first.unmount();
    vi.spyOn(voiceSetup, 'stage').mockResolvedValue({ ...result, draftHash: '0'.repeat(16) });
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed voice draft' }));
    expect(await screen.findByText(/gateway returned a different staged draft/)).toBeVisible();
    expect(store().definition).toBe(source);
  });
  it('rejects a route definition that does not match the reviewed preview hash', () => {
    const stage = vi.spyOn(voiceSetup, 'stage');
    show({ ...preview, definition: { ...next, description: 'Tampered after preview' } });
    expect(screen.getByText(/does not match its reviewed draft/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Apply reviewed voice draft' })).toBeDisabled();
    expect(stage).not.toHaveBeenCalled();
  });
  it('releases the editor freeze on navigation while allowing the server operation to settle', async () => {
    let finish!: (value: typeof result) => void;
    const stage = vi.spyOn(voiceSetup, 'stage').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = show();
    fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed voice draft' }));
    await waitFor(() => expect(stage).toHaveBeenCalledOnce());
    view.unmount();
    expect(view.staging.mock.calls).toEqual([[true], [false]]);
    await act(async () => {
      finish(result);
      await Promise.resolve();
    });
    expect(store().definition).toBe(source);
  });
  it('names unavailable device storage and offers a read retry without staging', () => {
    const stage = vi.spyOn(voiceSetup, 'stage');
    const retry = vi.fn();
    show(preview, {
      ready: false,
      storageUnavailableReason:
        'Device draft storage is unavailable. Retry after closing older tabs.',
      onRetryStorage: retry,
    });
    expect(screen.getByText(/Device draft storage is unavailable/)).toBeVisible();
    expect(screen.queryByText(/finish loading/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply reviewed voice draft' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry device draft storage' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(stage).not.toHaveBeenCalled();
  });
  it('waits for reconciliation and can dismiss a preview without saving', () => {
    const stage = vi.spyOn(voiceSetup, 'stage');
    show(preview, { ready: false });
    expect(screen.getByText(/finish loading/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss preview' }));
    expect(screen.queryByText('Review the voice draft')).not.toBeInTheDocument();
    expect(stage).not.toHaveBeenCalled();
  });
});

it('opens an existing custom normalizer for review without overwriting local work or staging', () => {
  const stage = vi.spyOn(voiceSetup, 'stage');
  store().load(loopId, next, { dirty: true, baseToken: preview.baseHash });
  const before = store().definition;
  renderWith(<VoiceCustomReviewNotice loopId={loopId} />);
  fireEvent.click(screen.getByRole('button', { name: 'Review existing normalizer' }));
  expect(store().selectedNodeId).toBe('chat-normalize');
  expect(store().nodeDialogOpen).toBe(true);
  expect(store().definition).toBe(before);
  expect(stage).not.toHaveBeenCalled();
});
