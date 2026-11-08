export const RECORDING_LIMIT_MS = 120_000;
export const RECORDING_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/webm',
];
export interface RecordingState {
  status: 'idle' | 'requesting' | 'recording' | 'ready';
  blob: Blob | undefined;
  error: string | undefined;
}
export const CHAT_AUDIO_TYPES = new Set([
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/flac',
  'video/webm',
  'video/mp4',
]);
export function supportedChatAudioType(type: string): boolean {
  return CHAT_AUDIO_TYPES.has(type.split(';')[0]!.trim().toLowerCase());
}
export function recordingAvailable(): boolean {
  return (
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  );
}

/** Captures local bytes only. No browser speech service or transcription fallback is used. */
export class ChatRecorder {
  private state: RecordingState = { status: 'idle', blob: undefined, error: undefined };
  private listeners = new Set<() => void>();
  private recorder: MediaRecorder | undefined;
  private stream: MediaStream | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  constructor(private readonly maxBytes: number) {}
  getSnapshot = (): RecordingState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private set(patch: Partial<RecordingState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private release(): void {
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
  }
  start = async (): Promise<void> => {
    if (this.state.status === 'recording' || this.state.status === 'requesting') return;
    if (!recordingAvailable()) {
      this.set({
        error: 'Microphone recording is unavailable in this browser. Attach an audio file instead.',
      });
      return;
    }
    const generation = ++this.generation;
    this.set({ status: 'requesting', error: undefined, blob: undefined });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      const mimeType = RECORDING_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      this.recorder = recorder;
      const chunks: Blob[] = [];
      let bytes = 0;
      recorder.ondataavailable = (event) => {
        if (generation !== this.generation || !event.data.size) return;
        bytes += event.data.size;
        if (bytes > this.maxBytes) {
          this.cancel();
          this.set({ error: 'The recording is too large. Record a shorter message.' });
        } else chunks.push(event.data);
      };
      recorder.onerror = () => {
        if (generation !== this.generation) return;
        this.cancel();
        this.set({ error: 'Recording failed. Check microphone access or attach an audio file.' });
      };
      recorder.onstop = () => {
        if (generation !== this.generation) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        this.release();
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
        this.set(
          blob.size
            ? { status: 'ready', blob }
            : { status: 'idle', error: 'The recording was empty. Try again.' },
        );
      };
      recorder.start(1000);
      this.set({ status: 'recording' });
      this.timer = setTimeout(this.stop, RECORDING_LIMIT_MS);
    } catch (error) {
      this.release();
      if (generation !== this.generation) return;
      this.set({
        status: 'idle',
        error:
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? 'Microphone permission was denied. Allow microphone access in your browser or attach an audio file.'
            : 'The microphone could not be opened. Check your device or attach an audio file.',
      });
    }
  };
  stop = (): void => {
    if (this.state.status === 'requesting') {
      ++this.generation;
      this.set({ status: 'idle' });
      this.release();
      return;
    }
    clearTimeout(this.timer);
    if (this.recorder?.state !== 'inactive') this.recorder?.stop();
    this.release();
  };
  cancel = (): void => {
    ++this.generation;
    this.stop();
    this.recorder = undefined;
    this.set({ status: 'idle', blob: undefined, error: undefined });
  };
}
