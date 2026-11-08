import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatRecorder, RECORDING_LIMIT_MS, recordingAvailable } from './recorder.js';
class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static supported = true;
  static isTypeSupported = vi.fn(() => FakeRecorder.supported);
  state = 'inactive';
  mimeType: string;
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? '';
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.onstop?.();
  }
  data(blob: Blob) {
    this.ondataavailable?.({ data: blob } as BlobEvent);
  }
}
const instance = () => FakeRecorder.instances.at(-1)!;
function setup() {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  FakeRecorder.supported = true;
  FakeRecorder.instances = [];
  return { stream, stop, getUserMedia };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('chat local audio capture', () => {
  it('negotiates a supported format, captures bytes, and stops every track', async () => {
    const { stop, getUserMedia } = setup();
    const recorder = new ChatRecorder(100);
    const changed = vi.fn();
    const unsubscribe = recorder.subscribe(changed);
    await recorder.start();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(recorder.getSnapshot().status).toBe('recording');
    await recorder.start();
    expect(getUserMedia).toHaveBeenCalledOnce();
    instance().data(new Blob([]));
    instance().data(new Blob(['hello']));
    recorder.stop();
    expect(recorder.getSnapshot()).toMatchObject({
      status: 'ready',
      blob: expect.objectContaining({ size: 5, type: 'audio/webm;codecs=opus' }),
    });
    expect(stop).toHaveBeenCalled();
    unsubscribe();
    const calls = changed.mock.calls.length;
    recorder.cancel();
    expect(changed).toHaveBeenCalledTimes(calls);
  });
  it('uses the recorder default when no preferred codec is supported', async () => {
    setup();
    FakeRecorder.supported = false;
    const recorder = new ChatRecorder(100);
    await recorder.start();
    instance().data(new Blob(['audio']));
    recorder.stop();
    expect(recorder.getSnapshot().blob?.type).toBe('audio/webm');
  });
  it('stops at the 120-second limit and keeps the clip', async () => {
    vi.useFakeTimers();
    const { stop } = setup();
    const recorder = new ChatRecorder(100);
    await recorder.start();
    instance().data(new Blob(['audio']));
    await vi.advanceTimersByTimeAsync(RECORDING_LIMIT_MS);
    expect(recorder.getSnapshot().status).toBe('ready');
    expect(stop).toHaveBeenCalled();
  });
  it('cancellation releases tracks and discards recorded data', async () => {
    const { stop } = setup();
    const recorder = new ChatRecorder(100);
    await recorder.start();
    const old = instance();
    old.data(new Blob(['audio']));
    recorder.cancel();
    old.data(new Blob(['late']));
    old.onstop?.();
    expect(recorder.getSnapshot()).toMatchObject({
      status: 'idle',
      blob: undefined,
      error: undefined,
    });
    expect(stop).toHaveBeenCalled();
  });
  it('cancels a pending microphone permission request and releases a late stream', async () => {
    const { stream, stop, getUserMedia } = setup();
    let resolve!: (value: MediaStream) => void;
    getUserMedia.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const recorder = new ChatRecorder(100);
    const opening = recorder.start();
    expect(recorder.getSnapshot().status).toBe('requesting');
    await recorder.start();
    expect(getUserMedia).toHaveBeenCalledOnce();
    recorder.stop();
    resolve(stream);
    await opening;
    expect(stop).toHaveBeenCalled();
    expect(FakeRecorder.instances).toHaveLength(0);
    expect(recorder.getSnapshot().status).toBe('idle');
  });
  it('oversized recording and recording failure discard audio honestly', async () => {
    setup();
    const recorder = new ChatRecorder(3);
    await recorder.start();
    instance().data(new Blob(['large']));
    expect(recorder.getSnapshot()).toMatchObject({
      status: 'idle',
      blob: undefined,
      error: expect.stringContaining('too large'),
    });
    await recorder.start();
    instance().onerror?.();
    expect(recorder.getSnapshot().error).toMatch(/Recording failed/);
  });
  it('reports an empty recording and can stop safely before starting', async () => {
    setup();
    const recorder = new ChatRecorder(3);
    recorder.stop();
    recorder.cancel();
    await recorder.start();
    recorder.stop();
    expect(recorder.getSnapshot().error).toMatch(/empty/);
  });
  it.each([
    ['NotAllowedError', /permission was denied/],
    ['NotFoundError', /microphone could not be opened/],
  ])('reports %s and keeps file attachment available', async (name, expected) => {
    const { getUserMedia } = setup();
    getUserMedia.mockRejectedValue(new DOMException('no', name));
    const recorder = new ChatRecorder(100);
    await recorder.start();
    expect(recorder.getSnapshot()).toMatchObject({
      status: 'idle',
      error: expect.stringMatching(expected),
    });
  });
  it('ignores a rejected microphone promise after cancellation', async () => {
    const { getUserMedia } = setup();
    let reject!: (error: unknown) => void;
    getUserMedia.mockImplementation(
      () =>
        new Promise((_done, fail) => {
          reject = fail;
        }),
    );
    const recorder = new ChatRecorder(100);
    const opening = recorder.start();
    recorder.cancel();
    reject(new Error('late'));
    await opening;
    expect(recorder.getSnapshot().error).toBeUndefined();
  });
  it('reports unsupported browsers without requesting permission', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('MediaRecorder', undefined);
    expect(recordingAvailable()).toBe(false);
    const recorder = new ChatRecorder(100);
    await recorder.start();
    expect(recorder.getSnapshot().error).toMatch(/unavailable/);
  });
});
