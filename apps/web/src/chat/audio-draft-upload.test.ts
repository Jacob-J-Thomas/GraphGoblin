import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioDraftUpload } from './audio-draft-upload.js';
import { ChatApiError } from './client.js';
import { mockChatClient, turn } from './__fixtures__/chat.js';
const blob = () =>
  ({ arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer) }) as Blob;
const audio = { id: turn.id, bytes: 50, mimeType: 'audio/wav', expiresAt: turn.createdAt };
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
describe('frozen audio upload identity', () => {
  it('persists digest and operation before POST, then reuses the accepted reference', async () => {
    const client = mockChatClient();
    client.upload.mockImplementation((_blob, identity) => {
      expect(JSON.parse(sessionStorage.getItem('upload')!)).toMatchObject(identity);
      expect(identity.sha256).toHaveLength(64);
      return Promise.resolve(audio);
    });
    const upload = new AudioDraftUpload(client, 'upload');
    expect(await upload.upload(blob(), 'caption')).toEqual(audio);
    expect(await upload.upload(blob(), 'caption')).toEqual(audio);
    expect(client.upload).toHaveBeenCalledOnce();
    upload.clear();
    expect(sessionStorage.getItem('upload')).toBeNull();
  });
  it('looks up a lost acknowledgement without replay and requires explicit subsequent Send', async () => {
    const client = mockChatClient();
    client.upload.mockRejectedValue(new TypeError('network'));
    client.audioStatus.mockResolvedValue({ state: 'ready', audio });
    const upload = new AudioDraftUpload(client, 'upload');
    expect(await upload.upload(blob(), 'caption')).toBeUndefined();
    expect(upload.getSnapshot()).toMatchObject({
      phase: 'ready',
      saved: { audio, caption: 'caption' },
    });
    expect(client.audioStatus).toHaveBeenCalledOnce();
    expect(await upload.upload(blob(), 'caption')).toEqual(audio);
    expect(client.upload).toHaveBeenCalledOnce();
    expect(client.send).not.toHaveBeenCalled();
  });
  it('restores metadata with GET only and coalesces concurrent status checks', async () => {
    const client = mockChatClient();
    client.upload.mockResolvedValue(audio);
    await new AudioDraftUpload(client, 'upload').upload(blob(), 'kept caption');
    const restored = new AudioDraftUpload(client, 'upload');
    let finish!: (value: { state: 'ready'; audio: typeof audio }) => void;
    client.audioStatus.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = restored.check();
    const second = restored.check();
    expect(first).toBe(second);
    finish({ state: 'ready', audio });
    await first;
    expect(client.upload).toHaveBeenCalledOnce();
    expect(client.audioStatus).toHaveBeenCalledOnce();
  });
  it('keeps receiving/transport uncertainty locked and allows only read-only checks', async () => {
    const client = mockChatClient();
    client.upload.mockRejectedValue(new Error('lost'));
    client.audioStatus
      .mockResolvedValueOnce({ state: 'receiving' })
      .mockRejectedValue(new Error('offline'));
    const upload = new AudioDraftUpload(client, 'upload');
    await upload.upload(blob(), 'caption');
    expect(upload.getSnapshot().phase).toBe('uncertain');
    await upload.upload(blob(), 'changed caption');
    await upload.check();
    expect(upload.getSnapshot().phase).toBe('uncertain');
    expect(client.upload).toHaveBeenCalledOnce();
  });
  it.each([404, 413])(
    'a definite %s refusal keeps one identity for explicit retry',
    async (status) => {
      const client = mockChatClient();
      client.upload
        .mockRejectedValueOnce(new ChatApiError(status, 'REFUSED', 'No upload.'))
        .mockResolvedValue(audio);
      const upload = new AudioDraftUpload(client, 'upload');
      await upload.upload(blob(), 'caption');
      expect(upload.getSnapshot().phase).toBe('failed');
      await upload.upload(blob(), 'caption');
      expect(client.upload.mock.calls[0]![1]).toEqual(client.upload.mock.calls[1]![1]);
    },
  );
  it.each([{ state: 'retired' } as const, { state: 'failed', code: 'BAD_AUDIO' } as const])(
    'reports terminal upload status $state without mutation',
    async (status) => {
      const client = mockChatClient();
      client.upload.mockRejectedValue(new Error('lost'));
      client.audioStatus.mockResolvedValue(status);
      const upload = new AudioDraftUpload(client, 'upload');
      await upload.upload(blob(), '');
      expect(upload.getSnapshot().phase).toBe(status.state === 'retired' ? 'retired' : 'failed');
      expect(client.upload).toHaveBeenCalledOnce();
    },
  );
  it('prevents POST when operation metadata cannot be saved', async () => {
    const client = mockChatClient();
    const storage = {
      getItem: () => '{invalid',
      setItem: () => {
        throw new Error('storage blocked');
      },
    } as unknown as Storage;
    const upload = new AudioDraftUpload(client, 'upload', storage);
    expect(await upload.check()).toBeUndefined();
    await expect(upload.upload(blob(), '')).rejects.toThrow('storage blocked');
    expect(client.upload).not.toHaveBeenCalled();
  });
  it('permits explicit retry after GET confirms an unknown operation', async () => {
    const client = mockChatClient();
    client.upload.mockRejectedValueOnce(new Error('lost')).mockResolvedValue(audio);
    client.audioStatus.mockRejectedValue(new ChatApiError(404, 'NOT_FOUND', 'No upload.'));
    const upload = new AudioDraftUpload(client, 'upload');
    await upload.upload(blob(), '');
    expect(upload.getSnapshot().phase).toBe('failed');
    expect(upload.getSnapshot().error).toContain('Send again while your recording');
    await upload.upload(blob(), '');
    expect(client.upload).toHaveBeenCalledTimes(2);
  });
  it.each([false, true])(
    'N4 bases missing-upload recovery copy on actual local recording availability (%s)',
    async (localRecordingAvailable) => {
      const saved = { uploadId: turn.requestId, sha256: 'a'.repeat(64), caption: 'Caption' };
      sessionStorage.setItem('upload', JSON.stringify(saved));
      const client = mockChatClient();
      client.audioStatus.mockRejectedValue(new ChatApiError(404, 'NOT_FOUND', 'No upload.'));
      const restored = new AudioDraftUpload(client, 'upload');
      await restored.check(localRecordingAvailable);
      expect(restored.getSnapshot()).toMatchObject({ phase: 'failed', saved });
      expect(restored.getSnapshot().error).toBe(
        localRecordingAvailable
          ? 'The gateway did not accept this upload. Send again while your recording is still in this open app.'
          : 'The gateway did not accept this upload. Discard this voice draft, then record again.',
      );
      expect(JSON.parse(sessionStorage.getItem('upload')!)).toEqual(saved);
      expect(client.upload).not.toHaveBeenCalled();
      expect(client.send).not.toHaveBeenCalled();
    },
  );
});

it('persists admission identity with accepted audio and recovers the acknowledgement-cleanup gap without replay', async () => {
  const client = mockChatClient();
  client.upload.mockResolvedValue(audio);
  const upload = new AudioDraftUpload(client, 'upload');
  await upload.upload(blob(), 'Caption');
  const pending = {
    conversationId: turn.conversationId,
    request: {
      requestId: turn.requestId,
      input: { kind: 'audio' as const, audioId: audio.id, caption: 'Caption' },
    },
  };
  upload.prepareRequest(pending);
  expect(JSON.parse(sessionStorage.getItem('upload')!)).toMatchObject({ pending });
  // Main Chat storage already cleared pending after admission, but upload cleanup did not run.
  const restored = new AudioDraftUpload(client, 'upload');
  client.request.mockResolvedValue({ ...turn, input: pending.request.input });
  await restored.check();
  expect(client.request).toHaveBeenCalledWith(turn.conversationId, turn.requestId);
  expect(client.audioStatus).not.toHaveBeenCalled();
  expect(client.send).not.toHaveBeenCalled();
  expect(restored.getSnapshot().phase).toBe('idle');
  expect(sessionStorage.getItem('upload')).toBeNull();
});
it('retains the exact prepared admission identity after authoritative absence', async () => {
  const client = mockChatClient();
  client.upload.mockResolvedValue(audio);
  const upload = new AudioDraftUpload(client, 'upload');
  await upload.upload(blob(), '');
  const pending = {
    conversationId: turn.conversationId,
    request: { requestId: turn.requestId, input: { kind: 'audio' as const, audioId: audio.id } },
  };
  upload.prepareRequest(pending);
  client.request.mockRejectedValue(new ChatApiError(404, 'NOT_FOUND', 'Not admitted.'));
  client.audioStatus.mockResolvedValue({ state: 'ready', audio });
  const restored = new AudioDraftUpload(client, 'upload');
  await restored.check();
  expect(restored.getSnapshot()).toMatchObject({ phase: 'ready', saved: { pending, audio } });
  expect(client.send).not.toHaveBeenCalled();
});
it('does not resurrect accepted upload metadata from a late lookup after admission or discard', async () => {
  const client = mockChatClient();
  client.upload.mockResolvedValue(audio);
  const upload = new AudioDraftUpload(client, 'upload');
  await upload.upload(blob(), '');
  let finish!: (value: { state: 'ready'; audio: typeof audio }) => void;
  client.audioStatus.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const checking = upload.check();
  upload.clear();
  finish({ state: 'ready', audio });
  await checking;
  expect(upload.getSnapshot().phase).toBe('idle');
  expect(sessionStorage.getItem('upload')).toBeNull();
});
it('refuses admission preparation until an accepted audio reference exists', () => {
  const upload = new AudioDraftUpload(mockChatClient(), 'upload');
  expect(() =>
    upload.prepareRequest({
      conversationId: turn.conversationId,
      request: { requestId: turn.requestId, input: turn.input },
    }),
  ).toThrow('accepted');
});

it('never treats upload retirement as permission to replace an unknown native admission', async () => {
  const client = mockChatClient();
  client.upload.mockResolvedValue(audio);
  const upload = new AudioDraftUpload(client, 'upload');
  await upload.upload(blob(), 'Caption');
  upload.prepareRequest({
    conversationId: turn.conversationId,
    request: {
      requestId: turn.requestId,
      input: { kind: 'audio', audioId: audio.id, caption: 'Caption' },
    },
  });
  client.request.mockRejectedValue(new Error('Native acknowledgement unknown'));
  client.audioStatus.mockResolvedValue({ state: 'retired' });
  const restored = new AudioDraftUpload(client, 'upload');
  await restored.check();
  expect(restored.getSnapshot().phase).toBe('uncertain');
  expect(client.audioStatus).not.toHaveBeenCalled();
  expect(await restored.upload(blob(), 'Caption')).toBeUndefined();
  expect(client.upload).toHaveBeenCalledOnce();
  expect(client.send).not.toHaveBeenCalled();
});
