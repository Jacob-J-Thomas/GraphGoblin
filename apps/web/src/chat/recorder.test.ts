import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChatRecorder,
  RECORDING_FINALIZE_TIMEOUT_MS,
  RECORDING_LIMIT_MS,
  RECORDING_RESAMPLE_TIMEOUT_MS,
  RECORDING_SETUP_TIMEOUT_MS,
  VOICE_MAX_DRAFTS,
  VOICE_MAX_SEGMENTS,
  anyVoiceDraftDirty,
  getConversationRecorder,
  moveConversationRecorder,
  recordingAvailable,
  subscribeVoiceDrafts,
  supportedChatAudioType,
} from './recorder.js';
import { lockChatUpdate, unlockChatUpdate } from '../pwa/chat-update-guard.js';

class Track extends EventTarget {
  stop = vi.fn();
}
class Context extends EventTarget {
  static rate = 16_000;
  static module = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  static instances: Context[] = [];
  static resumeAudio = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  sampleRate = Context.rate;
  state = 'running';
  destination = {};
  audioWorklet = { addModule: Context.module };
  close = vi.fn().mockResolvedValue(undefined);
  resume = Context.resumeAudio;
  source = { connect: vi.fn(), disconnect: vi.fn() };
  createMediaStreamSource = vi.fn(() => this.source);
  constructor() {
    super();
    Context.instances.push(this);
  }
}
class Node {
  static instances: Node[] = [];
  static automatic = true;
  static tail: number[] = [];
  onprocessorerror: (() => void) | null = null;
  sequence = 0;
  frames = 0;
  connect = vi.fn();
  disconnect = vi.fn();
  port = {
    onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
    close: vi.fn(),
    postMessage: vi.fn((data: { type: string }) => {
      if (data.type === 'stop' && Node.automatic)
        queueMicrotask(() => {
          if (Node.tail.length) this.chunk(Node.tail);
          this.emit({ type: 'stopped', sequence: this.sequence, frames: this.frames });
        });
    }),
  };
  options: AudioWorkletNodeOptions;
  constructor(_context: AudioContext, _name: string, options: AudioWorkletNodeOptions) {
    this.options = options;
    Node.instances.push(this);
  }
  emit(data: unknown) {
    this.port.onmessage?.({ data } as MessageEvent<unknown>);
  }
  chunk(samples: number[]) {
    this.frames += samples.length;
    this.emit({
      type: 'chunk',
      sequence: ++this.sequence,
      samples: new Float32Array(samples).buffer,
    });
  }
}
class Offline {
  static bad = false;
  static pending = false;
  static render: (() => void) | undefined;
  static instances: Offline[] = [];
  input = new Float32Array();
  sourceRate = 0;
  destination = {};
  constructor(
    readonly channels: number,
    readonly frames: number,
    readonly rate: number,
  ) {
    Offline.instances.push(this);
  }
  createBuffer(_channels: number, length: number, rate: number) {
    this.input = new Float32Array(length);
    this.sourceRate = rate;
    return { getChannelData: () => this.input };
  }
  createBufferSource() {
    return { buffer: undefined, connect: vi.fn(), start: vi.fn() };
  }
  startRendering() {
    const output = {
      sampleRate: Offline.bad ? 48_000 : this.rate,
      numberOfChannels: this.channels,
      length: this.frames,
      getChannelData: () =>
        Float32Array.from(
          { length: this.frames },
          (_, i) =>
            this.input[
              Math.min(this.input.length - 1, Math.floor((i * this.sourceRate) / this.rate))
            ]!,
        ),
    };
    if (Offline.pending)
      return new Promise((done) => {
        Offline.render = () => done(output);
      });
    return Promise.resolve(output);
  }
}
const recorders: ChatRecorder[] = [];
let track: Track;
let getUserMedia: ReturnType<typeof vi.fn<() => Promise<MediaStream>>>;
function recorder(maxBytes?: number) {
  const value = new ChatRecorder(maxBytes);
  recorders.push(value);
  return value;
}
function latest() {
  return Node.instances.at(-1)!;
}
async function bytes(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((done, fail) => {
    const reader = new FileReader();
    reader.onload = () => done(reader.result as ArrayBuffer);
    reader.onerror = fail;
    reader.readAsArrayBuffer(blob);
  });
}
async function segment(value: ChatRecorder, samples = [0.25, -0.5]) {
  await value.start();
  latest().chunk(samples);
  await value.stop();
}
async function settleSetup() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
beforeEach(() => {
  track = new Track();
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  getUserMedia = vi.fn<() => Promise<MediaStream>>().mockResolvedValue(stream);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('AudioContext', Context);
  vi.stubGlobal('AudioWorkletNode', Node);
  vi.stubGlobal('OfflineAudioContext', Offline);
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:worklet'), revokeObjectURL: vi.fn() });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  Context.rate = 16_000;
  Context.module = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  Context.instances = [];
  Context.resumeAudio = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  Node.instances = [];
  Node.automatic = true;
  Node.tail = [];
  Offline.bad = false;
  Offline.pending = false;
  Offline.render = undefined;
  Offline.instances = [];
});
afterEach(() => {
  for (const value of recorders) value.discard();
  recorders.length = 0;
  Offline.render?.();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('bounded PCM voice drafts', () => {
  it('captures mono PCM, keeps short utterances and waits for final samples before releasing tracks', async () => {
    const value = recorder();
    const changed = vi.fn();
    const unsubscribe = value.subscribe(changed);
    await value.start();
    await value.start();
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(value.getSnapshot()).toMatchObject({
      status: 'recording',
      permission: 'granted',
      dirty: true,
    });
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { channelCount: 1, sampleRate: 16_000 },
      video: false,
    });
    latest().chunk([1]);
    Node.tail = [-1];
    const stop = value.stop();
    expect(value.stop()).toBe(stop);
    expect(value.getSnapshot().status).toBe('finalizing');
    expect(track.stop).not.toHaveBeenCalled();
    await stop;
    expect(track.stop).toHaveBeenCalledOnce();
    expect(Context.instances[0]!.close).toHaveBeenCalledOnce();
    expect(value.getSnapshot()).toMatchObject({
      status: 'ready',
      totalDurationMs: 0.125,
      dirty: true,
    });
    const data = new DataView(await bytes(value.getSnapshot().segments[0]!.blob));
    expect(data.getInt16(44, true)).toBe(32_767);
    expect(data.getInt16(46, true)).toBe(-32_768);
    unsubscribe();
    const calls = changed.mock.calls.length;
    value.discard();
    expect(changed).toHaveBeenCalledTimes(calls);
  });
  it('appends paused segments and freezes ordered PCM beneath exactly one WAV header once', async () => {
    const value = recorder();
    await segment(value, [1]);
    await segment(value, [-1]);
    const first = value.freeze();
    expect(value.freeze()).toBe(first);
    const frozen = (await first)!;
    expect(await value.freeze()).toBe(frozen);
    expect(frozen.blob.size).toBe(48);
    expect(frozen.durationMs).toBe(0.125);
    const data = new DataView(await bytes(frozen.blob));
    expect(data.getUint32(40, true)).toBe(4);
    expect(data.getUint32(24, true)).toBe(16_000);
    expect(data.getInt16(44, true)).toBe(32_767);
    expect(data.getInt16(46, true)).toBe(-32_768);
    const count = Node.instances.length;
    await value.start();
    value.removeSegment(frozen.segments[0]!.id);
    expect(Node.instances).toHaveLength(count);
    expect(value.getSnapshot().segments).toHaveLength(2);
    value.thaw();
    value.removeSegment(frozen.segments[0]!.id);
    expect(value.getSnapshot().segments).toHaveLength(1);
    value.removeSegment(frozen.segments[1]!.id);
    expect(value.getSnapshot()).toMatchObject({ dirty: false, status: 'idle', totalDurationMs: 0 });
  });
  it('Send while recording includes the tail and deduplicates concurrent Send/Stop', async () => {
    const value = recorder();
    await value.start();
    latest().chunk([0.1]);
    Node.tail = [0.2];
    const freeze = value.freeze();
    const stop = value.stop();
    expect(value.freeze()).toBe(freeze);
    value.removeSegment('missing');
    await value.start();
    await stop;
    const frozen = (await freeze)!;
    expect(frozen.blob.size).toBe(48);
    expect(
      latest().port.postMessage.mock.calls.filter(([data]) => data.type === 'stop'),
    ).toHaveLength(1);
  });
  it('cancels late permission results and late module events without reviving capture', async () => {
    const value = recorder();
    let resolve!: (value: MediaStream) => void;
    getUserMedia.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const start = value.start();
    expect(value.getSnapshot().status).toBe('requesting');
    await value.stop();
    resolve({ getTracks: () => [track] } as unknown as MediaStream);
    await start;
    expect(track.stop).toHaveBeenCalledOnce();
    expect(Context.instances).toHaveLength(1);
    expect(Context.instances[0]!.close).toHaveBeenCalledOnce();
    expect(value.getSnapshot().dirty).toBe(false);
    let moduleDone!: () => void;
    Context.module.mockImplementation(
      () =>
        new Promise((done) => {
          moduleDone = done;
        }),
    );
    getUserMedia.mockResolvedValue({ getTracks: () => [track] } as unknown as MediaStream);
    const next = value.start();
    await settleSetup();
    value.discard();
    moduleDone();
    await next;
    expect(Node.instances).toHaveLength(0);
    expect(Context.instances[0]!.close).toHaveBeenCalled();
  });
  it('ignores late rejection after discard and can freeze empty safely', async () => {
    const value = recorder();
    let reject!: (error: Error) => void;
    getUserMedia.mockImplementation(
      () =>
        new Promise((_done, fail) => {
          reject = fail;
        }),
    );
    const start = value.start();
    value.cancel();
    reject(new Error('late'));
    await start;
    expect(value.getSnapshot().error).toBeUndefined();
    expect(await value.freeze()).toBeUndefined();
    await value.stop();
  });
  it('discard invalidates pending Stop and Send, including delayed final chunks', async () => {
    const value = recorder();
    await value.start();
    latest().chunk([1]);
    Node.automatic = false;
    const old = latest();
    const oldMessage = old.port.onmessage!;
    const freeze = value.freeze();
    value.discard();
    oldMessage({
      data: { type: 'chunk', sequence: 2, samples: new Float32Array([1]).buffer },
    } as MessageEvent<unknown>);
    expect(await freeze).toBeUndefined();
    expect(value.getSnapshot()).toMatchObject({ status: 'idle', dirty: false, segments: [] });
  });
  it('retains earlier audio after final acknowledgement timeout and prevents silent Send', async () => {
    vi.useFakeTimers();
    const value = recorder();
    await segment(value);
    await value.start();
    latest().chunk([1]);
    Node.automatic = false;
    const freeze = value.freeze();
    const rejected = expect(freeze).rejects.toThrow(/final words/);
    await vi.advanceTimersByTimeAsync(RECORDING_FINALIZE_TIMEOUT_MS);
    await rejected;
    expect(value.getSnapshot().segments).toHaveLength(1);
    expect(track.stop).toHaveBeenCalled();
    await expect(value.freeze()).rejects.toThrow(/final words/);
    Node.automatic = true;
    await segment(value);
    expect((await value.freeze())!.segments).toHaveLength(2);
  });
  it.each([
    [null, /invalid audio/],
    [{ type: 'unknown' }, /invalid audio/],
    [{ type: 'error' }, /keep up/],
    [{ type: 'chunk', sequence: 2, samples: new Float32Array([1]).buffer }, /sequence/],
    [{ type: 'chunk', sequence: 1, samples: new ArrayBuffer(3) }, /sequence/],
    [{ type: 'chunk', sequence: 1, samples: new ArrayBuffer(0) }, /sequence/],
    [{ type: 'chunk', sequence: 1, samples: new ArrayBuffer(4097 * 4) }, /sequence/],
    [{ type: 'chunk', sequence: 1, samples: new Float32Array([NaN]).buffer }, /bounds/],
    [{ type: 'stopped', sequence: 9, frames: 0 }, /final words/],
  ])('cleans up invalid worklet events %j', async (message, error) => {
    const value = recorder();
    await value.start();
    latest().emit(message);
    await value.stop();
    expect(value.getSnapshot().error).toMatch(error);
    expect(track.stop).toHaveBeenCalled();
    await expect(value.freeze()).rejects.toThrow(error);
  });
  it('handles processor exceptions and preserves prior valid segments', async () => {
    const value = recorder();
    await segment(value);
    await value.start();
    latest().onprocessorerror!();
    await value.stop();
    expect(value.getSnapshot().segments).toHaveLength(1);
    expect(value.getSnapshot().error).toMatch(/failed/);
  });
  it('stops on time limit, retains the clip and never creates a frozen upload', async () => {
    vi.useFakeTimers();
    const value = recorder();
    await value.start();
    latest().chunk([1]);
    await vi.advanceTimersByTimeAsync(RECORDING_LIMIT_MS);
    await value.stop();
    expect(value.getSnapshot()).toMatchObject({
      status: 'ready',
      blob: undefined,
      error: expect.stringMatching(/limit/),
    });
  });
  it('enforces aggregate byte and segment caps and allows removal to free capacity', async () => {
    const tiny = recorder(48);
    await segment(tiny, [1, 1]);
    await tiny.start();
    expect(tiny.getSnapshot().error).toMatch(/limit/);
    tiny.removeSegment(tiny.getSnapshot().segments[0]!.id);
    await segment(tiny, [1, 1]);
    tiny.discard();
    const value = recorder();
    for (let i = 0; i < VOICE_MAX_SEGMENTS; i++) await segment(value, [1]);
    await value.start();
    expect(value.getSnapshot().segments).toHaveLength(16);
    expect(value.getSnapshot().error).toMatch(/limit/);
    const bounded = recorder(46);
    value.discard();
    await bounded.start();
    latest().chunk([1, 1]);
    await bounded.stop();
    expect(bounded.getSnapshot().error).toMatch(/bounds/);
  });
  it.each([44_100, 48_000, 96_000])(
    'uses actual %i Hz native resampling and preserves ordered input',
    async (rate) => {
      Context.rate = rate;
      const value = recorder();
      await value.start();
      latest().chunk([1, 0.5, -0.5, -1, 0.5, 0.5]);
      await value.stop();
      const native = Offline.instances[0]!;
      expect([...native.input]).toEqual([1, 0.5, -0.5, -1, 0.5, 0.5]);
      expect(native.sourceRate).toBe(rate);
      expect(native.rate).toBe(16_000);
      expect(value.getSnapshot().segments[0]!.durationMs).toBe(
        Math.max(1, Math.round((6 * 16_000) / rate)) / 16,
      );
    },
  );
  it('retains one native-resampled sample for a very short recording', async () => {
    Context.rate = 96_000;
    const value = recorder();
    await segment(value, [1]);
    expect(value.getSnapshot().segments[0]!.blob.size).toBe(46);
  });
  it('rejects a mislabelled native result without erasing earlier clips', async () => {
    const value = recorder();
    await segment(value);
    Context.rate = 48_000;
    Offline.bad = true;
    await segment(value);
    expect(value.getSnapshot().segments).toHaveLength(1);
    await expect(value.freeze()).rejects.toThrow(/16-kHz/);
  });
  it('bounds native processing time and ignores late completion after discard', async () => {
    vi.useFakeTimers();
    Context.rate = 48_000;
    Offline.pending = true;
    const value = recorder();
    await value.start();
    latest().chunk([1]);
    const stop = value.stop();
    await vi.advanceTimersByTimeAsync(RECORDING_RESAMPLE_TIMEOUT_MS);
    await stop;
    expect(value.getSnapshot().error).toMatch(/too long/);
    const other = recorder();
    await other.start();
    expect(other.getSnapshot().error).toMatch(/still finishing/);
    value.discard();
    await value.start();
    expect(value.getSnapshot().error).toMatch(/still finishing/);
    Offline.render!();
    await Promise.resolve();
    expect(value.getSnapshot().segments).toHaveLength(0);
  });
  it.each(['visibility', 'suspended', 'ended', 'mute'])(
    'pauses on %s interruption and retains audio',
    async (event) => {
      const value = recorder();
      await value.start();
      latest().chunk([1]);
      if (event === 'visibility') {
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
      } else if (event === 'suspended') {
        const context = Context.instances[0]!;
        context.state = 'suspended';
        context.dispatchEvent(new Event('statechange'));
      } else track.dispatchEvent(new Event(event));
      await value.stop();
      expect(value.getSnapshot()).toMatchObject({ status: 'ready', blob: undefined });
    },
  );
  it.each([
    ['NotAllowedError', /blocked/, 'denied'],
    ['NotFoundError', /No microphone/, 'unknown'],
    ['NotReadableError', /could not be opened/, 'unknown'],
  ])('reports %s honestly', async (name, message, permission) => {
    getUserMedia.mockRejectedValue(new DOMException('no', name));
    const value = recorder();
    await value.start();
    expect(value.getSnapshot()).toMatchObject({
      permission,
      error: expect.stringMatching(message),
      dirty: false,
    });
  });
  it('reports empty clips without inventing speech or silently dropping short clips', async () => {
    const value = recorder();
    await value.start();
    await value.stop();
    expect(value.getSnapshot().error).toMatch(/empty/);
    await expect(value.freeze()).rejects.toThrow(/empty/);
  });
  it.each([0, 192_000, 44_100.5])(
    'rejects unsupported actual rate %i and closes context before requesting microphone access',
    async (rate) => {
      Context.rate = rate;
      const value = recorder();
      await value.start();
      expect(value.getSnapshot().unsupported).toBe(true);
      expect(getUserMedia).not.toHaveBeenCalled();
      expect(Context.instances[0]!.close).toHaveBeenCalledOnce();
    },
  );
  it('does not advertise compressed recording fallback or request permission on unsupported platforms', async () => {
    vi.stubGlobal('navigator', {});
    expect(recordingAvailable()).toBe(false);
    const value = recorder();
    await value.start();
    expect(value.getSnapshot()).toMatchObject({
      unsupported: true,
      error: expect.stringMatching(/text still works/),
    });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(supportedChatAudioType('audio/wav; codecs=pcm')).toBe(true);
    expect(supportedChatAudioType('audio/webm')).toBe(false);
  });
  it('cleans up module loading failure and missing native resampling support', async () => {
    Context.module.mockRejectedValue(new Error('CSP'));
    const value = recorder();
    await value.start();
    expect(track.stop).toHaveBeenCalled();
    expect(value.getSnapshot().unsupported).toBe(true);
    Context.module.mockResolvedValue();
    Context.rate = 48_000;
    vi.stubGlobal('OfflineAudioContext', undefined);
    await value.start();
    expect(value.getSnapshot().unsupported).toBe(true);
  });
  it('retains per-conversation drafts, publishes dirty changes and refuses a ninth without eviction', async () => {
    const changed = vi.fn();
    const unsubscribe = subscribeVoiceDrafts(changed);
    const values: ChatRecorder[] = [];
    for (let i = 0; i < VOICE_MAX_DRAFTS; i++) {
      const value = getConversationRecorder(`bound-${i}`);
      recorders.push(value);
      values.push(value);
      await segment(value, [1]);
    }
    expect(anyVoiceDraftDirty()).toBe(true);
    expect(getConversationRecorder('bound-0')).toBe(values[0]);
    const ninth = getConversationRecorder('bound-nine');
    recorders.push(ninth);
    await ninth.start();
    expect(ninth.getSnapshot().error).toMatch(/full/);
    expect(values.every((value) => value.getSnapshot().segments.length === 1)).toBe(true);
    values[0]!.discard();
    await segment(ninth);
    expect(ninth.getSnapshot().segments).toHaveLength(1);
    expect(moveConversationRecorder('bound-nine', 'bound-1')).toBe(false);
    expect(moveConversationRecorder('bound-nine', 'bound-nine')).toBe(true);
    expect(moveConversationRecorder('unknown', 'to')).toBe(false);
    expect(moveConversationRecorder('bound-nine', 'moved')).toBe(true);
    expect(getConversationRecorder('moved')).toBe(ninth);
    for (const value of values) value.discard();
    ninth.discard();
    expect(anyVoiceDraftDirty()).toBe(false);
    expect(changed).toHaveBeenCalled();
    unsubscribe();
    for (let i = 0; i < 20; i++) recorders.push(getConversationRecorder(`clean-${i}`));
  });
  it('serializes capture across conversations, including finalization', async () => {
    const first = recorder();
    const second = recorder();
    await first.start();
    await second.start();
    expect(second.getSnapshot().error).toMatch(/other recording/);
    Node.automatic = false;
    const stopping = first.stop();
    await second.start();
    expect(second.getSnapshot().error).toMatch(/other recording/);
    latest().emit({ type: 'stopped', sequence: 0, frames: 0 });
    await stopping;
    Node.automatic = true;
    await segment(second);
  });
  it('synchronously refuses capture while a coordinated update owns the app', async () => {
    expect(lockChatUpdate('recorder-test')).toBe(true);
    const value = recorder();
    await value.start();
    expect(value.getSnapshot().error).toMatch(/updating/);
    expect(getUserMedia).not.toHaveBeenCalled();
    unlockChatUpdate('recorder-test');
    await segment(value);
  });
  it('falls back to the actual native rate only if the target AudioContext rate is unsupported', async () => {
    const construct = vi.fn(function (options?: AudioContextOptions) {
      if (options) throw new DOMException('rate', 'NotSupportedError');
      return new Context();
    });
    Context.rate = 48_000;
    vi.stubGlobal('AudioContext', construct);
    const value = recorder();
    await segment(value);
    expect(construct).toHaveBeenCalledTimes(2);
    expect(value.getSnapshot().segments[0]!.blob.type).toBe('audio/wav');
    value.discard();
    vi.stubGlobal(
      'AudioContext',
      vi.fn(function () {
        throw new Error('device');
      }),
    );
    await value.start();
    expect(value.getSnapshot().error).toMatch(/could not be opened/);
  });
  it('pauses immediately when capture starts in an already hidden document', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const value = recorder();
    await value.start();
    await value.stop();
    expect(value.getSnapshot().status).toBe('idle');
    expect(track.stop).toHaveBeenCalled();
  });
  it('retains prior audio when Send cancels a pending permission request', async () => {
    const value = recorder();
    await segment(value);
    let resolve!: (stream: MediaStream) => void;
    getUserMedia.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const starting = value.start();
    const frozen = await value.freeze();
    expect(frozen!.segments).toHaveLength(1);
    resolve({ getTracks: () => [track] } as unknown as MediaStream);
    await starting;
    expect(value.getSnapshot().blob).toBe(frozen!.blob);
  });
  it('keeps the capture reservation after discard until a previous native render settles', async () => {
    Context.rate = 48_000;
    Offline.pending = true;
    const value = recorder();
    await value.start();
    latest().chunk([1]);
    const stopping = value.stop();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    value.discard();
    await value.start();
    expect(value.getSnapshot().error).toMatch(/still finishing/);
    Offline.render!();
    await stopping;
    expect(value.getSnapshot().segments).toHaveLength(0);
  });
  it('does not let an old discarded finalizer unlock a newly started capture', async () => {
    const value = recorder();
    const other = recorder();
    await value.start();
    Node.automatic = false;
    const stopped = value.stop();
    value.discard();
    Node.automatic = true;
    await value.start();
    await stopped;
    await other.start();
    expect(other.getSnapshot().error).toMatch(/other recording/);
    latest().chunk([1]);
    await value.stop();
  });
  it('enforces the 120-second aggregate frame limit across paused recordings', async () => {
    const value = recorder();
    for (let segmentIndex = 0; segmentIndex < 2; segmentIndex++) {
      await value.start();
      let remaining = 960_000;
      while (remaining) {
        const count = Math.min(remaining, 4096);
        latest().chunk(Array<number>(count).fill(0));
        remaining -= count;
      }
      await value.stop();
    }
    expect(value.getSnapshot().totalDurationMs).toBe(RECORDING_LIMIT_MS);
    const calls = getUserMedia.mock.calls.length;
    await value.start();
    expect(getUserMedia).toHaveBeenCalledTimes(calls);
    expect(value.getSnapshot().error).toMatch(/limit/);
    expect((await value.freeze())!.blob.size).toBe(3_840_044);
  });
  it('creates and resumes AudioContext synchronously before awaiting microphone permission', async () => {
    let allow!: (stream: MediaStream) => void;
    getUserMedia.mockImplementation(
      () =>
        new Promise((done) => {
          allow = done;
        }),
    );
    const value = recorder();
    const starting = value.start();
    expect(Context.instances).toHaveLength(1);
    expect(Context.resumeAudio).toHaveBeenCalledOnce();
    expect(Context.resumeAudio.mock.invocationCallOrder[0]).toBeLessThan(
      getUserMedia.mock.invocationCallOrder[0]!,
    );
    await value.stop();
    await starting;
    expect(Context.instances[0]!.close).toHaveBeenCalledOnce();
    allow({ getTracks: () => [track] } as unknown as MediaStream);
    await settleSetup();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(value.getSnapshot()).toMatchObject({ status: 'idle', dirty: false });
  });
  it.each(['permission', 'resume', 'module'])(
    'bounds hung %s setup and cleans late results',
    async (stage) => {
      vi.useFakeTimers();
      let finish!: () => void;
      if (stage === 'permission')
        getUserMedia.mockImplementation(
          () =>
            new Promise((done) => {
              finish = () => done({ getTracks: () => [track] } as unknown as MediaStream);
            }),
        );
      else if (stage === 'resume')
        Context.resumeAudio.mockImplementation(
          () =>
            new Promise((done) => {
              finish = done;
            }),
        );
      else
        Context.module.mockImplementation(
          () =>
            new Promise((done) => {
              finish = done;
            }),
        );
      const value = recorder();
      const starting = value.start();
      await settleSetup();
      expect(value.getSnapshot().status).toBe('requesting');
      await vi.advanceTimersByTimeAsync(RECORDING_SETUP_TIMEOUT_MS);
      await starting;
      expect(Context.instances[0]!.close).toHaveBeenCalledOnce();
      expect(value.getSnapshot()).toMatchObject({
        status: 'idle',
        dirty: false,
        errorRecovery: 'retry',
        error: expect.stringContaining('too long to start'),
      });
      finish();
      await settleSetup();
      expect(Node.instances).toHaveLength(0);
      expect(track.stop).toHaveBeenCalledOnce();
      expect(value.getSnapshot().status).toBe('idle');
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it.each(['stop', 'discard'])(
    'cleans pending audio activation on %s and ignores late activation',
    async (action) => {
      let resume!: () => void;
      Context.resumeAudio.mockImplementation(
        () =>
          new Promise((done) => {
            resume = done;
          }),
      );
      const value = recorder();
      const starting = value.start();
      await settleSetup();
      if (action === 'stop') await value.stop();
      else value.discard();
      await starting;
      expect(Context.instances[0]!.close).toHaveBeenCalledOnce();
      expect(track.stop).toHaveBeenCalledOnce();
      resume();
      await settleSetup();
      expect(value.getSnapshot()).toMatchObject({ status: 'idle', dirty: false });
      expect(Node.instances).toHaveLength(0);
      Context.resumeAudio.mockResolvedValue(undefined);
      await segment(value);
      expect(value.getSnapshot().segments).toHaveLength(1);
    },
  );
  it('handles rejected activation before permission settles without reporting microphone denial', async () => {
    let allow!: (stream: MediaStream) => void;
    Context.resumeAudio.mockRejectedValue(new DOMException('activation', 'NotAllowedError'));
    getUserMedia.mockImplementation(
      () =>
        new Promise((done) => {
          allow = done;
        }),
    );
    const value = recorder();
    await value.start();
    expect(value.getSnapshot()).toMatchObject({
      permission: 'unknown',
      errorRecovery: 'retry',
      error: expect.stringContaining('Audio recording could not start'),
    });
    expect(Context.instances[0]!.close).toHaveBeenCalledOnce();
    allow({ getTracks: () => [track] } as unknown as MediaStream);
    await settleSetup();
    expect(track.stop).toHaveBeenCalledOnce();
  });
  it.each([
    { name: 'Error', error: new Error('activation failed') },
    { name: 'NotAllowedError', error: new DOMException('activation', 'NotAllowedError') },
  ])(
    'cleans up a delayed $name activation rejection after permission and module loading',
    async ({ error }) => {
      let reject!: (error: Error) => void;
      Context.resumeAudio.mockImplementation(
        () =>
          new Promise((_done, fail) => {
            reject = fail;
          }),
      );
      const value = recorder();
      const starting = value.start();
      await settleSetup();
      expect(value.getSnapshot().permission).toBe('granted');
      expect(Context.module).toHaveBeenCalledOnce();
      reject(error);
      await starting;
      expect(track.stop).toHaveBeenCalledOnce();
      expect(Context.instances[0]!.close).toHaveBeenCalledOnce();
      expect(Node.instances).toHaveLength(0);
      expect(value.getSnapshot()).toMatchObject({
        status: 'idle',
        permission: 'granted',
        errorRecovery: 'retry',
        error: 'Audio recording could not start. Tap the microphone and try again.',
      });
    },
  );
  it('does not claim recording when an activated context becomes suspended during permission', async () => {
    let allow!: (stream: MediaStream) => void;
    getUserMedia.mockImplementation(
      () =>
        new Promise((done) => {
          allow = done;
        }),
    );
    const value = recorder();
    const starting = value.start();
    Context.instances[0]!.state = 'suspended';
    allow({ getTracks: () => [track] } as unknown as MediaStream);
    await starting;
    expect(value.getSnapshot()).toMatchObject({
      status: 'idle',
      permission: 'granted',
      error: expect.stringContaining('Audio recording could not start'),
    });
    expect(Node.instances).toHaveLength(0);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(Context.instances[0]!.close).toHaveBeenCalledOnce();
  });
  it('does not save a valid prefix when the worklet then reports an unconfirmed overflow', async () => {
    const value = recorder();
    await segment(value, [0.25]);
    await value.start();
    latest().chunk([1, 1, 1]);
    latest().emit({ type: 'error' });
    await value.stop();
    expect(value.getSnapshot().segments).toHaveLength(1);
    expect(value.getSnapshot().error).toContain('last recording was not saved');
    await expect(value.freeze()).rejects.toThrow(/keep up/);
  });
  it('clears the setup deadline after success and classifies browser and capacity recovery without copy matching', async () => {
    vi.useFakeTimers();
    const value = recorder(46);
    await segment(value, [1]);
    expect(vi.getTimerCount()).toBe(0);
    await value.start();
    expect(value.getSnapshot().errorRecovery).toBe('send-or-remove');
    value.removeSegment(value.getSnapshot().segments[0]!.id);
    expect(value.getSnapshot().errorRecovery).toBeUndefined();
    vi.stubGlobal('isSecureContext', false);
    expect(recordingAvailable()).toBe(false);
    const permissionCalls = getUserMedia.mock.calls.length;
    await value.start();
    expect(getUserMedia).toHaveBeenCalledTimes(permissionCalls);
    expect(value.getSnapshot()).toMatchObject({
      unsupported: true,
      errorRecovery: 'unsupported',
      error: expect.stringContaining('requires HTTPS'),
    });
    vi.stubGlobal('isSecureContext', true);
    await segment(value, [1]);
    expect(value.getSnapshot()).toMatchObject({
      unsupported: false,
      error: undefined,
      errorRecovery: undefined,
    });
  });
  it('keeps final-ACK failure explicit on an interrupted context and preserves only earlier completed segments', async () => {
    vi.useFakeTimers();
    const value = recorder();
    await segment(value, [0.25]);
    await value.start();
    latest().chunk([1, 1]);
    Node.automatic = false;
    const context = Context.instances.at(-1)!;
    context.state = 'interrupted';
    context.dispatchEvent(new Event('statechange'));
    await vi.advanceTimersByTimeAsync(RECORDING_FINALIZE_TIMEOUT_MS);
    await value.stop();
    expect(value.getSnapshot().segments).toHaveLength(1);
    expect(value.getSnapshot()).toMatchObject({
      errorRecovery: 'retry',
      error: expect.stringContaining('last recording was not saved'),
    });
    await expect(value.freeze()).rejects.toThrow(/final words/);
  });
  it('retains an acknowledged worklet limit stop and exposes send-or-remove recovery', async () => {
    const value = recorder();
    await value.start();
    latest().chunk([1]);
    latest().emit({ type: 'stopped', sequence: 1, frames: 1, limit: true });
    await value.stop();
    expect(value.getSnapshot()).toMatchObject({
      status: 'ready',
      errorRecovery: 'send-or-remove',
      blob: undefined,
    });
    expect((await value.freeze())!.segments).toHaveLength(1);
  });
});
