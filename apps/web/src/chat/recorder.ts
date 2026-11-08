import { pcmWav, resamplePcm, signed16, VOICE_SAMPLE_RATE, WAV_HEADER_BYTES } from './pcm.js';
import { PCM_CHUNK_FRAMES, PCM_QUEUE_CHUNKS, PCM_WORKLET_SOURCE } from './pcm-worklet.js';
import { getChatUpdateLocked } from '../pwa/chat-update-lock.js';

export const RECORDING_LIMIT_MS = 120_000;
export const VOICE_MAX_BYTES = 10 * 1024 * 1024;
export const VOICE_MAX_SEGMENTS = 16;
export const VOICE_MAX_DRAFTS = 8;
export const VOICE_SESSION_MAX_BYTES = VOICE_MAX_BYTES * VOICE_MAX_DRAFTS;
export const RECORDING_FINALIZE_TIMEOUT_MS = 3_000;
export const RECORDING_RESAMPLE_TIMEOUT_MS = 10_000;
export const RECORDING_SETUP_TIMEOUT_MS = 30_000;
const MAX_SOURCE_RATE = 96_000;
// One active capture/finalization: source floats + native copy + rendered output,
// bounded queued transfers, a worklet buffer, a delivered chunk and canonical drafts.
// No concurrent per-draft peak.
export const VOICE_PEAK_BUFFER_BYTES =
  VOICE_SESSION_MAX_BYTES +
  MAX_SOURCE_RATE * 120 * 4 * 2 +
  16_000 * 120 * 4 +
  PCM_CHUNK_FRAMES * 4 * (PCM_QUEUE_CHUNKS + 2);
export interface VoiceSegment {
  readonly id: string;
  readonly blob: Blob;
  readonly durationMs: number;
  readonly byteLength: number;
}
export interface FrozenVoiceDraft {
  blob: Blob;
  segments: readonly VoiceSegment[];
  durationMs: number;
}
export interface RecordingState {
  status: 'idle' | 'requesting' | 'recording' | 'finalizing' | 'ready';
  segments: readonly VoiceSegment[];
  totalDurationMs: number;
  dirty: boolean;
  permission: 'unknown' | 'prompt' | 'granted' | 'denied';
  unsupported: boolean;
  blob: Blob | undefined;
  error: string | undefined;
  errorRecovery?: 'retry' | 'send-or-remove' | 'other-draft' | 'wait' | 'unsupported' | undefined;
}
export function supportedChatAudioType(type: string): boolean {
  return type.split(';')[0]!.trim().toLowerCase() === 'audio/wav';
}
export function recordingAvailable(): boolean {
  return (
    globalThis.isSecureContext !== false &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof AudioContext !== 'undefined' &&
    typeof AudioWorkletNode !== 'undefined'
  );
}
function openAudioContext(): AudioContext {
  try {
    return new AudioContext({ sampleRate: VOICE_SAMPLE_RATE });
  } catch (error) {
    // Some engines reject a requested device rate but can resample their default.
    if (!(error instanceof DOMException) || error.name !== 'NotSupportedError') throw error;
    return new AudioContext();
  }
}
const dirtyRecorders = new Set<ChatRecorder>();
const drafts = new Map<string, ChatRecorder>();
const draftListeners = new Set<() => void>();
let captureOwner: symbol | undefined;
// OfflineAudioContext has no abort API. A timed-out render keeps its global memory
// reservation until its native promise settles, even if its draft was discarded.
let nativeProcessing: Promise<ArrayBuffer> | undefined;
export const anyVoiceDraftDirty = (): boolean => dirtyRecorders.size > 0;
export function subscribeVoiceDrafts(listener: () => void): () => void {
  draftListeners.add(listener);
  return () => draftListeners.delete(listener);
}
/** Captured audio is never evicted. Capacity refusal happens on Start, safely outside render. */
export function getConversationRecorder(key: string, maxBytes = VOICE_MAX_BYTES): ChatRecorder {
  const existing = drafts.get(key);
  if (existing) return existing;
  if (drafts.size >= VOICE_MAX_DRAFTS * 2) {
    for (const [oldKey, draft] of drafts) {
      if (!draft.getSnapshot().dirty) {
        drafts.delete(oldKey);
        break;
      }
    }
  }
  const recorder = new ChatRecorder(maxBytes);
  drafts.set(key, recorder);
  return recorder;
}
export function moveConversationRecorder(fromKey: string, toKey: string): boolean {
  if (fromKey === toKey) return true;
  const source = drafts.get(fromKey);
  if (!source || drafts.get(toKey)?.getSnapshot().dirty) return false;
  drafts.set(toKey, source);
  drafts.delete(fromKey);
  return true;
}
interface Capture {
  generation: number;
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode | undefined;
  node: AudioWorkletNode | undefined;
  chunks: ArrayBuffer[];
  sourceChunks: Float32Array[];
  frames: number;
  sequence: number;
  maxFrames: number;
  maxTargetFrames: number;
  stopped: boolean;
  released: boolean;
  limit: boolean;
  ack: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  cleanup: (() => void)[];
}
/** Local, bounded PCM capture only. Stop never uploads or submits. */
export class ChatRecorder {
  private state: RecordingState = {
    status: 'idle',
    segments: [],
    totalDurationMs: 0,
    dirty: false,
    permission: 'unknown',
    unsupported: false,
    blob: undefined,
    error: undefined,
  };
  private readonly maxBytes: number;
  private listeners = new Set<() => void>();
  private capture: Capture | undefined;
  private opening: { generation: number; cancel: () => void } | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private stopPromise: Promise<void> | undefined;
  private freezePromise: Promise<FrozenVoiceDraft | undefined> | undefined;
  private frozen: FrozenVoiceDraft | undefined;
  private failedFinalization = false;
  private segmentId = 0;
  private readonly captureToken = Symbol('voice-capture');
  constructor(maxBytes = VOICE_MAX_BYTES) {
    this.maxBytes = Math.max(
      WAV_HEADER_BYTES,
      Math.min(VOICE_MAX_BYTES, Number.isFinite(maxBytes) ? Math.floor(maxBytes) : VOICE_MAX_BYTES),
    );
  }
  getSnapshot = (): RecordingState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private set(patch: Partial<RecordingState>): void {
    const errorRecovery = Object.hasOwn(patch, 'error')
      ? patch.error
        ? (patch.errorRecovery ?? 'retry')
        : undefined
      : this.state.errorRecovery;
    this.state = { ...this.state, ...patch, errorRecovery };
    this.state.dirty =
      this.state.segments.length > 0 ||
      ['requesting', 'recording', 'finalizing'].includes(this.state.status);
    if (this.state.dirty) dirtyRecorders.add(this);
    else dirtyRecorders.delete(this);
    for (const listener of this.listeners) listener();
    for (const listener of draftListeners) listener();
  }
  private duration(): number {
    return this.state.segments.reduce((total, segment) => total + segment.durationMs, 0);
  }
  private release(capture: Capture): void {
    if (capture.released) return;
    capture.released = true;
    if (this.capture === capture) clearTimeout(this.timer);
    for (const cleanup of capture.cleanup) cleanup();
    capture.stream.getTracks().forEach((track) => track.stop());
    capture.source?.disconnect();
    capture.node?.disconnect();
    if (capture.node) {
      capture.node.port.onmessage = null;
      capture.node.port.close();
    }
    void capture.context.close().catch(() => undefined);
    if (this.capture === capture) this.capture = undefined;
  }
  private unlock(): void {
    if (captureOwner === this.captureToken) captureOwner = undefined;
  }
  private cancelOpening(): void {
    const opening = this.opening;
    this.opening = undefined;
    opening?.cancel();
  }
  private failCapture(capture: Capture, message: string): void {
    if (this.capture !== capture || capture.generation !== this.generation) return;
    capture.reject(new Error(message));
    void this.stop();
  }
  private onMessage(capture: Capture, data: unknown): void {
    if (capture.generation !== this.generation || this.capture !== capture) return;
    if (!data || typeof data !== 'object' || !('type' in data))
      return this.failCapture(capture, 'Voice capture returned invalid audio. Record again.');
    if (data.type === 'chunk') {
      if (
        !('sequence' in data) ||
        data.sequence !== capture.sequence + 1 ||
        !('samples' in data) ||
        !(data.samples instanceof ArrayBuffer) ||
        data.samples.byteLength % 4 ||
        !data.samples.byteLength ||
        data.samples.byteLength > PCM_CHUNK_FRAMES * 4 ||
        capture.sequence >= Math.ceil(capture.maxFrames / PCM_CHUNK_FRAMES) + 1 ||
        capture.stopped
      ) {
        return this.failCapture(capture, 'Voice capture lost its audio sequence. Record again.');
      }
      const samples = new Float32Array(data.samples);
      if (
        capture.frames + samples.length > capture.maxFrames ||
        samples.some((sample) => !Number.isFinite(sample))
      ) {
        return this.failCapture(
          capture,
          'Voice capture exceeded its safe audio bounds. Record again.',
        );
      }
      capture.frames += samples.length;
      capture.sequence++;
      if (capture.context.sampleRate === VOICE_SAMPLE_RATE) capture.chunks.push(signed16(samples));
      else capture.sourceChunks.push(samples);
      capture.node?.port.postMessage({ type: 'ack', sequence: capture.sequence });
      this.set({
        totalDurationMs: this.duration() + (capture.frames / capture.context.sampleRate) * 1000,
      });
    } else if (data.type === 'stopped') {
      if (
        !('sequence' in data) ||
        data.sequence !== capture.sequence ||
        !('frames' in data) ||
        data.frames !== capture.frames ||
        capture.stopped
      ) {
        return this.failCapture(
          capture,
          'Voice capture could not confirm the final words. Record again.',
        );
      }
      capture.stopped = true;
      capture.limit = capture.limit || ('limit' in data && data.limit === true);
      capture.resolve();
      void this.stop();
    } else if (data.type === 'error') {
      this.failCapture(
        capture,
        'Voice capture could not keep up. The last recording was not saved. Record again.',
      );
    } else this.failCapture(capture, 'Voice capture returned invalid audio. Record again.');
  }
  start = async (): Promise<void> => {
    if (
      ['requesting', 'recording', 'finalizing'].includes(this.state.status) ||
      this.frozen ||
      this.freezePromise
    )
      return;
    if (getChatUpdateLocked()) {
      this.set({
        error: 'The app is updating. Try recording again in a moment.',
        errorRecovery: 'wait',
      });
      return;
    }
    if (nativeProcessing) {
      this.set({
        error: 'Voice processing is still finishing. Try recording again in a moment.',
        errorRecovery: 'wait',
      });
      return;
    }
    if (globalThis.isSecureContext === false) {
      this.set({
        unsupported: true,
        error: 'Voice recording requires HTTPS. Open the secure gateway address; text still works.',
        errorRecovery: 'unsupported',
      });
      return;
    }
    if (!recordingAvailable()) {
      this.set({
        unsupported: true,
        error: "Voice recording isn't supported in this browser; text still works.",
        errorRecovery: 'unsupported',
      });
      return;
    }
    if (captureOwner && captureOwner !== this.captureToken) {
      this.set({
        error: 'Pause the other recording and wait for it to finish before recording here.',
        errorRecovery: 'wait',
      });
      return;
    }
    if (!dirtyRecorders.has(this) && dirtyRecorders.size >= VOICE_MAX_DRAFTS) {
      this.set({
        error: 'Voice drafts are full. Send or discard a recording in another conversation first.',
        errorRecovery: 'other-draft',
      });
      return;
    }
    const existingFrames = Math.round((this.duration() * VOICE_SAMPLE_RATE) / 1000);
    const maxTargetFrames = Math.min(
      (VOICE_SAMPLE_RATE * RECORDING_LIMIT_MS) / 1000 - existingFrames,
      Math.floor((this.maxBytes - WAV_HEADER_BYTES) / 2) - existingFrames,
    );
    const sessionBytes = [...dirtyRecorders].reduce(
      (bytes, recorder) =>
        bytes + recorder.state.segments.reduce((sum, segment) => sum + segment.byteLength, 0),
      0,
    );
    if (
      maxTargetFrames <= 0 ||
      this.state.segments.length >= VOICE_MAX_SEGMENTS ||
      sessionBytes + maxTargetFrames * 2 + WAV_HEADER_BYTES > VOICE_SESSION_MAX_BYTES
    ) {
      this.set({
        error: 'That is the limit for one voice message. Send it, or remove a recording.',
        errorRecovery: 'send-or-remove',
      });
      return;
    }
    const generation = ++this.generation;
    captureOwner = this.captureToken;
    this.failedFinalization = false;
    this.set({
      status: 'requesting',
      permission: this.state.permission === 'granted' ? 'granted' : 'prompt',
      error: undefined,
      unsupported: false,
    });
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    let capture: Capture | undefined;
    let setupTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let closed = false;
    let failSetup!: (reason: unknown) => void;
    const setupStopped = new Promise<never>((_resolve, reject) => {
      failSetup = reject;
    });
    void setupStopped.catch(() => undefined);
    const cleanup = () => {
      cancelled = true;
      clearTimeout(setupTimer);
      if (capture) this.release(capture);
      else {
        stream?.getTracks().forEach((track) => track.stop());
        if (context && !closed) {
          closed = true;
          void context.close().catch(() => undefined);
        }
      }
      if (this.opening?.generation === generation) this.opening = undefined;
    };
    try {
      // Keep creation and the first resume call inside the initiating gesture.
      // Permission is requested immediately; a pending resume never delays its prompt.
      context = openAudioContext();
      this.opening = {
        generation,
        cancel: () => {
          failSetup(new Error('setup-cancelled'));
          cleanup();
        },
      };
      setupTimer = setTimeout(() => {
        failSetup(new Error('setup-timeout'));
        cleanup();
      }, RECORDING_SETUP_TIMEOUT_MS);
      if (
        !context.audioWorklet ||
        !Number.isInteger(context.sampleRate) ||
        context.sampleRate < 8_000 ||
        context.sampleRate > MAX_SOURCE_RATE ||
        (context.sampleRate !== VOICE_SAMPLE_RATE && typeof OfflineAudioContext === 'undefined')
      )
        throw new Error('unsupported');
      const resumed = context.resume();
      // Audio activation failure is distinct from denied microphone permission.
      void resumed.catch(() => failSetup(new Error('audio-start-failed')));
      const permission = navigator.mediaDevices
        .getUserMedia({
          audio: { channelCount: 1, sampleRate: VOICE_SAMPLE_RATE },
          video: false,
        })
        .then((result) => {
          if (cancelled || generation !== this.generation)
            result.getTracks().forEach((track) => track.stop());
          else stream = result;
          return result;
        });
      stream = await Promise.race([permission, setupStopped]);
      if (generation !== this.generation) return;
      this.set({ permission: 'granted' });
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const ack = new Promise<void>((done, fail) => {
        resolve = done;
        reject = fail;
      });
      // A processor can fail before Stop is clicked; Stop still receives that rejection.
      void ack.catch(() => undefined);
      capture = {
        generation,
        stream,
        context,
        source: undefined,
        node: undefined,
        chunks: [],
        sourceChunks: [],
        frames: 0,
        sequence: 0,
        maxFrames: Math.floor((maxTargetFrames * context.sampleRate) / VOICE_SAMPLE_RATE),
        maxTargetFrames,
        stopped: false,
        released: false,
        limit: false,
        ack,
        resolve,
        reject,
        cleanup: [],
      };
      this.capture = capture;
      const moduleUrl = URL.createObjectURL(
        new Blob([PCM_WORKLET_SOURCE], { type: 'text/javascript' }),
      );
      try {
        await Promise.race([
          context.audioWorklet.addModule(moduleUrl).catch(() => {
            throw new Error('unsupported');
          }),
          setupStopped,
        ]);
      } finally {
        URL.revokeObjectURL(moduleUrl);
      }
      if (generation !== this.generation) return;
      await Promise.race([resumed, setupStopped]);
      if (generation !== this.generation) return;
      if (context.state !== 'running') throw new Error('audio-start-failed');
      const node = new AudioWorkletNode(context, 'goblin-pcm-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
        processorOptions: { maxFrames: capture.maxFrames },
      });
      capture.node = node;
      const currentCapture = capture;
      node.port.onmessage = ({ data }: MessageEvent<unknown>) =>
        this.onMessage(currentCapture, data);
      node.onprocessorerror = () =>
        this.failCapture(
          currentCapture,
          'Voice capture failed. The last recording was not saved. Record again.',
        );
      const source = context.createMediaStreamSource(stream);
      capture.source = source;
      source.connect(node);
      // Worklet output is silence; connecting it keeps capture alive without microphone feedback.
      node.connect(context.destination);
      clearTimeout(setupTimer);
      if (this.opening?.generation === generation) this.opening = undefined;
      const pause = () => {
        void this.stop();
      };
      const visibility = () => {
        if (document.visibilityState === 'hidden') pause();
      };
      const contextState = () => {
        if (context!.state !== 'running') pause();
      };
      document.addEventListener('visibilitychange', visibility);
      context.addEventListener('statechange', contextState);
      capture.cleanup.push(
        () => document.removeEventListener('visibilitychange', visibility),
        () => context!.removeEventListener('statechange', contextState),
      );
      for (const track of stream.getTracks()) {
        track.addEventListener('ended', pause);
        track.addEventListener('mute', pause);
        capture.cleanup.push(() => {
          track.removeEventListener('ended', pause);
          track.removeEventListener('mute', pause);
        });
      }
      this.set({ status: 'recording', permission: 'granted' });
      this.timer = setTimeout(
        () => {
          currentCapture.limit = true;
          void this.stop();
        },
        (maxTargetFrames / VOICE_SAMPLE_RATE) * 1000,
      );
      if (document.visibilityState === 'hidden') void this.stop();
    } catch (error) {
      cleanup();
      if (generation !== this.generation) return;
      this.unlock();
      const denied =
        error instanceof DOMException &&
        (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      const unsupported = error instanceof Error && error.message === 'unsupported';
      this.set({
        status: this.state.segments.length ? 'ready' : 'idle',
        totalDurationMs: this.duration(),
        permission: denied ? 'denied' : this.state.permission === 'granted' ? 'granted' : 'unknown',
        unsupported,
        errorRecovery: unsupported ? 'unsupported' : 'retry',
        error: denied
          ? 'Microphone is blocked for this site. Allow it in the browser site settings, then try again.'
          : error instanceof DOMException && error.name === 'NotFoundError'
            ? 'No microphone found.'
            : unsupported
              ? "Voice recording isn't supported in this browser; text still works."
              : error instanceof Error && error.message === 'setup-timeout'
                ? 'The microphone took too long to start. Check browser access and try again.'
                : error instanceof Error && error.message === 'audio-start-failed'
                  ? 'Audio recording could not start. Tap the microphone and try again.'
                  : 'The microphone could not be opened. Check your device and try again.',
      });
    }
  };
  stop = (): Promise<void> => {
    if (this.stopPromise) return this.stopPromise;
    if (this.state.status === 'requesting') {
      ++this.generation;
      this.cancelOpening();
      if (this.capture) this.release(this.capture);
      this.unlock();
      this.set({
        status: this.state.segments.length ? 'ready' : 'idle',
        totalDurationMs: this.duration(),
      });
      return Promise.resolve();
    }
    const capture = this.capture;
    if (!capture) return Promise.resolve();
    clearTimeout(this.timer);
    this.set({ status: 'finalizing' });
    const work = Promise.resolve().then(() => this.finalize(capture));
    this.stopPromise = work;
    void work.finally(() => {
      if (this.stopPromise === work) this.stopPromise = undefined;
    });
    return work;
  };
  private async finalize(capture: Capture): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_done, fail) => {
        timeout = setTimeout(
          () =>
            fail(
              new Error(
                'The microphone did not confirm the final words. The last recording was not saved. Record again.',
              ),
            ),
          RECORDING_FINALIZE_TIMEOUT_MS,
        );
      });
      if (!capture.stopped) capture.node?.port.postMessage({ type: 'stop' });
      await Promise.race([capture.ack, deadline]);
      clearTimeout(timeout);
      // Tracks are released only after the final sequence is acknowledged (or failure).
      this.release(capture);
      if (capture.generation !== this.generation) return;
      if (!capture.frames) {
        this.failedFinalization = true;
        this.set({ error: 'The recording was empty. Try again.' });
        return;
      }
      let parts = capture.chunks;
      if (capture.context.sampleRate !== VOICE_SAMPLE_RATE) {
        const deadline = new Promise<never>((_done, fail) => {
          timeout = setTimeout(
            () =>
              fail(
                new Error(
                  'Voice processing took too long. The last recording was not saved. Record again.',
                ),
              ),
            RECORDING_RESAMPLE_TIMEOUT_MS,
          );
        });
        const processing = resamplePcm(
          capture.sourceChunks,
          capture.frames,
          capture.context.sampleRate,
          capture.maxTargetFrames,
        );
        nativeProcessing = processing;
        const settled = () => {
          if (nativeProcessing === processing) nativeProcessing = undefined;
        };
        void processing.then(settled, settled);
        parts = [await Promise.race([processing, deadline])];
      }
      if (capture.generation !== this.generation) return;
      const pcmBytes = parts.reduce((bytes, part) => bytes + part.byteLength, 0);
      const blob = pcmWav(parts, pcmBytes);
      const segment: VoiceSegment = {
        id: `voice-${++this.segmentId}`,
        blob,
        durationMs: (pcmBytes / 2 / VOICE_SAMPLE_RATE) * 1000,
        byteLength: blob.size,
      };
      this.set({
        segments: [...this.state.segments, segment],
        error: capture.limit
          ? 'That is the limit for one voice message. Send it, or remove a recording.'
          : undefined,
        errorRecovery: capture.limit ? 'send-or-remove' : undefined,
      });
    } catch (error) {
      if (capture.generation === this.generation) {
        this.failedFinalization = true;
        this.set({
          error: error instanceof Error ? error.message : 'Voice capture failed. Record again.',
        });
      }
    } finally {
      clearTimeout(timeout);
      if (this.capture === capture) this.release(capture);
      if (capture.generation === this.generation) this.unlock();
      if (capture.generation === this.generation)
        this.set({
          status: this.state.segments.length ? 'ready' : 'idle',
          totalDurationMs: this.duration(),
        });
    }
  }
  freeze = (): Promise<FrozenVoiceDraft | undefined> => {
    if (this.frozen) return Promise.resolve(this.frozen);
    if (this.freezePromise) return this.freezePromise;
    const freeze = async () => {
      const stopping = this.stop();
      const generation = this.generation;
      await stopping;
      if (generation !== this.generation) return undefined;
      if (this.failedFinalization)
        throw new Error(
          this.state.error ?? 'The last recording could not be finalized. Record again.',
        );
      if (!this.state.segments.length) return undefined;
      const segments = this.state.segments;
      const pcmBytes = segments.reduce(
        (bytes, segment) => bytes + segment.byteLength - WAV_HEADER_BYTES,
        0,
      );
      const blob = pcmWav(
        segments.map((segment) => segment.blob.slice(WAV_HEADER_BYTES)),
        pcmBytes,
      );
      this.frozen = { blob, segments, durationMs: this.duration() };
      this.set({ blob });
      return this.frozen;
    };
    const work = freeze();
    this.freezePromise = work;
    void work.then(
      () => {
        if (this.freezePromise === work) this.freezePromise = undefined;
      },
      () => {
        if (this.freezePromise === work) this.freezePromise = undefined;
      },
    );
    return work;
  };
  thaw = (): void => {
    this.frozen = undefined;
    this.set({ blob: undefined });
  };
  removeSegment = (id: string): void => {
    if (
      this.frozen ||
      this.freezePromise ||
      ['requesting', 'recording', 'finalizing'].includes(this.state.status)
    )
      return;
    this.failedFinalization = false;
    const segments = this.state.segments.filter((segment) => segment.id !== id);
    this.set({
      segments,
      status: segments.length ? 'ready' : 'idle',
      totalDurationMs: segments.reduce((total, segment) => total + segment.durationMs, 0),
      error: undefined,
      blob: undefined,
    });
  };
  discard = (): void => {
    ++this.generation;
    this.cancelOpening();
    clearTimeout(this.timer);
    if (this.capture) {
      this.capture.resolve();
      this.release(this.capture);
    }
    this.unlock();
    this.frozen = undefined;
    this.freezePromise = undefined;
    this.stopPromise = undefined;
    this.failedFinalization = false;
    this.set({
      status: 'idle',
      segments: [],
      totalDurationMs: 0,
      blob: undefined,
      error: undefined,
    });
  };
  cancel = this.discard;
}
