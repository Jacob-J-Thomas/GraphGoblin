import {
  ChatAudioUploadSchema,
  ChatSendRequestSchema,
  UlidSchema,
  type ChatAudioUpload,
} from '@graphgoblin/contracts';
import { z } from 'zod';
import { setChatSubmissionUnresolved } from '../pwa/chat-update-guard.js';
import type { PendingChatRequest } from './controller.js';
import { ChatApiError, type ChatClient } from './client.js';
const Saved = z.object({
  uploadId: z.uuid(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  caption: z.string().max(16_000),
  audio: ChatAudioUploadSchema.optional(),
  pending: z.object({ conversationId: UlidSchema, request: ChatSendRequestSchema }).optional(),
});
type SavedUpload = z.infer<typeof Saved>;
export interface AudioDraftUploadState {
  phase: 'idle' | 'uploading' | 'checking' | 'uncertain' | 'ready' | 'failed' | 'retired';
  saved: SavedUpload | undefined;
  error: string | undefined;
}
/** Persist only operation metadata. Captured audio stays in bounded session memory. */
export class AudioDraftUpload {
  private listeners = new Set<() => void>();
  private state: AudioDraftUploadState = { phase: 'idle', saved: undefined, error: undefined };
  private checking: Promise<ChatAudioUpload | undefined> | undefined;
  private generation = 0;
  constructor(
    private client: ChatClient,
    private key: string,
    private storage: Storage = sessionStorage,
  ) {
    try {
      const parsed = Saved.safeParse(JSON.parse(storage.getItem(key) ?? 'null'));
      if (parsed.success) this.state = { phase: 'uncertain', saved: parsed.data, error: undefined };
    } catch {
      /* A new upload will require writable storage before mutation. */
    }
    setChatSubmissionUnresolved(`${key}:upload`, Boolean(this.state.saved));
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private set(patch: Partial<AudioDraftUploadState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private save(saved: SavedUpload) {
    this.storage.setItem(this.key, JSON.stringify(saved));
    setChatSubmissionUnresolved(`${this.key}:upload`, true);
  }
  prepareRequest = (pending: PendingChatRequest): void => {
    const saved = this.state.saved;
    if (
      !saved?.audio ||
      pending.request.input.kind !== 'audio' ||
      pending.request.input.audioId !== saved.audio.id
    )
      throw new Error('The recording must be accepted before preparing a voice message.');
    const prepared = { ...saved, pending };
    this.save(prepared);
    this.set({ saved: prepared });
  };
  clear = () => {
    this.generation++;
    try {
      this.storage.removeItem(this.key);
    } catch {
      /* Stale metadata retains its request ID and recovers by GET only. */
    }
    this.set({ phase: 'idle', saved: undefined, error: undefined });
    setChatSubmissionUnresolved(`${this.key}:upload`, false);
  };
  check = (localRecordingAvailable = false): Promise<ChatAudioUpload | undefined> => {
    if (this.checking) return this.checking;
    const saved = this.state.saved;
    if (!saved) return Promise.resolve(undefined);
    const generation = this.generation;
    this.set({ phase: 'checking', error: undefined });
    this.checking = (async () => {
      try {
        if (saved.pending) {
          try {
            await this.client.request(
              saved.pending.conversationId,
              saved.pending.request.requestId,
            );
            if (generation !== this.generation) return undefined;
            // Admission was acknowledged: never offer this recording as an unsent command.
            this.clear();
            return undefined;
          } catch (error) {
            if (generation !== this.generation) return undefined;
            if (!(error instanceof ChatApiError && error.status === 404)) throw error;
          }
        }
        const status = await this.client.audioStatus(saved.uploadId);
        if (generation !== this.generation) return undefined;
        if (status.state === 'ready') {
          const accepted = { ...saved, audio: status.audio };
          this.save(accepted);
          this.set({ phase: 'ready', saved: accepted });
          return status.audio;
        }
        if (status.state === 'receiving')
          this.set({
            phase: 'uncertain',
            error: 'The gateway is still receiving this recording. Check status again.',
          });
        else
          this.set({
            phase: status.state === 'retired' ? 'retired' : 'failed',
            error:
              status.state === 'retired'
                ? 'This uploaded recording expired. Record again.'
                : 'The upload was not accepted. Your local recording is kept.',
          });
      } catch (error) {
        if (generation !== this.generation) return undefined;
        if (
          error instanceof ChatApiError &&
          error.status === 410 &&
          ['CHAT_HISTORY_DELETED', 'CHAT_AUDIO_EXPIRED'].includes(error.code)
        )
          this.set({
            phase: 'retired',
            error: 'This voice message is no longer available on the gateway. Record again.',
          });
        else if (error instanceof ChatApiError && error.status === 404)
          this.set({
            phase: 'failed',
            error: localRecordingAvailable
              ? 'The gateway did not accept this upload. Send again while your recording is still in this open app.'
              : 'The gateway did not accept this upload. Discard this voice draft, then record again.',
          });
        else
          this.set({
            phase: 'uncertain',
            error: 'Couldn’t check this upload yet. Check the connection, then check status.',
          });
      }
      return undefined;
    })().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  };
  upload = async (blob: Blob, caption: string): Promise<ChatAudioUpload | undefined> => {
    if (['uploading', 'checking', 'uncertain', 'retired'].includes(this.state.phase))
      return undefined;
    if (this.state.saved?.audio) return this.state.saved.audio;
    const bytes = await blob.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = Array.from(new Uint8Array(hash), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    const previous = this.state.saved;
    const saved =
      previous?.sha256 === sha256
        ? { ...previous, caption }
        : { uploadId: crypto.randomUUID(), sha256, caption };
    // A refused storage write must prevent POST, because a reload could otherwise replay it.
    this.save(saved);
    this.set({ phase: 'uploading', saved, error: undefined });
    try {
      const audio = await this.client.upload(blob, saved);
      const accepted = { ...saved, audio };
      this.save(accepted);
      this.set({ phase: 'ready', saved: accepted });
      return audio;
    } catch (error) {
      if (
        error instanceof ChatApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        ![409, 410].includes(error.status)
      ) {
        this.set({ phase: 'failed', error: error.message });
        return undefined;
      }
      // The request may have arrived. Lookup is read-only; never replace or replay it here.
      this.set({ phase: 'uncertain', error: 'Checking what happened…' });
      await this.check(true);
      return undefined;
    }
  };
}
