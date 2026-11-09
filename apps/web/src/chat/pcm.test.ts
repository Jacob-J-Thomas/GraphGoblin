import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { pcmWav, signed16, wavHeader } from './pcm.js';
import { PCM_CHUNK_FRAMES, PCM_QUEUE_CHUNKS, PCM_WORKLET_SOURCE } from './pcm-worklet.js';
interface Message {
  type: string;
  sequence?: number;
  frames?: number;
  samples?: ArrayBuffer;
  limit?: boolean;
}
interface Processor {
  port: { onmessage: (event: { data: { type: string; sequence?: number } }) => void };
  process: (inputs: Float32Array[][]) => boolean;
}
function harness(maxFrames = PCM_CHUNK_FRAMES * (PCM_QUEUE_CHUNKS + 2)) {
  const messages: Message[] = [];
  let Constructor!: new (options: { processorOptions: { maxFrames: number } }) => Processor;
  class Base {
    port = {
      onmessage: () => undefined,
      postMessage: (message: Message) => {
        messages.push(message);
      },
    };
  }
  runInNewContext(PCM_WORKLET_SOURCE, {
    AudioWorkletProcessor: Base,
    registerProcessor: (_name: string, constructor: typeof Constructor) => {
      Constructor = constructor;
    },
    Float32Array,
  });
  return { processor: new Constructor({ processorOptions: { maxFrames } }), messages };
}
describe('canonical PCM encoding and worklet protocol', () => {
  it('writes a complete mono 16k signed16 WAV header and clamps amplitudes', () => {
    const view = new DataView(wavHeader(8));
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(4, true)).toBe(44);
    expect(view.getUint32(28, true)).toBe(32_000);
    const pcm = new DataView(signed16(new Float32Array([-2, -0.5, 0.5, 2])));
    expect([0, 2, 4, 6].map((offset) => pcm.getInt16(offset, true))).toEqual([
      -32_768, -16_384, 16_384, 32_767,
    ]);
    expect(pcmWav([pcm.buffer], 8).size).toBe(52);
    expect(() => wavHeader(3)).toThrow(/complete/);
    expect(() => wavHeader(-2)).toThrow();
    expect(() => signed16(new Float32Array([NaN]))).toThrow(/invalid samples/);
  });
  it('mixes stereo to mono and flushes a short final chunk before the sequence acknowledgement', () => {
    const { processor, messages } = harness();
    processor.process([[new Float32Array([1, 0.5]), new Float32Array([-1, 0.5])]]);
    processor.port.onmessage({ data: { type: 'stop' } });
    expect(messages.map((message) => message.type)).toEqual(['chunk', 'stopped']);
    expect([...new Float32Array(messages[0]!.samples!)]).toEqual([0, 0.5]);
    expect(messages[1]).toMatchObject({ sequence: 1, frames: 2, limit: false });
    processor.port.onmessage({ data: { type: 'stop' } });
    processor.process([[new Float32Array([1])]]);
    expect(messages).toHaveLength(2);
  });
  it('bounds the transfer queue and fails visibly instead of losing samples silently', () => {
    const { processor, messages } = harness();
    for (let i = 0; i <= PCM_QUEUE_CHUNKS; i++)
      processor.process([[new Float32Array(PCM_CHUNK_FRAMES)]]);
    expect(messages.filter((message) => message.type === 'chunk')).toHaveLength(PCM_QUEUE_CHUNKS);
    expect(messages.at(-1)!.type).toBe('error');
    processor.port.onmessage({ data: { type: 'stop' } });
    expect(messages.at(-1)!.type).toBe('error');
  });
  it('keeps 500 ms at 48 kHz through a main-thread stall, then acknowledges the exact final tail', () => {
    const { processor, messages } = harness();
    const frames = 24_000;
    for (let offset = 0; offset < frames; offset += 128)
      processor.process([[new Float32Array(Math.min(128, frames - offset)).fill(0.5)]]);
    expect(messages.some((message) => message.type === 'error')).toBe(false);
    for (const message of [...messages])
      processor.port.onmessage({ data: { type: 'ack', sequence: message.sequence! } });
    processor.port.onmessage({ data: { type: 'stop' } });
    const chunks = messages.filter((message) => message.type === 'chunk');
    expect(chunks.reduce((total, chunk) => total + chunk.samples!.byteLength / 4, 0)).toBe(frames);
    expect(messages.at(-1)).toMatchObject({ type: 'stopped', sequence: chunks.length, frames });
  });
  it('releases one credit per ordered acknowledgement and pauses exactly at the frame limit', () => {
    const { processor, messages } = harness(PCM_CHUNK_FRAMES * 6 + 1);
    for (let i = 0; i < 6; i++) {
      processor.process([[new Float32Array(PCM_CHUNK_FRAMES)]]);
      processor.port.onmessage({ data: { type: 'ack', sequence: i + 1 } });
    }
    processor.port.onmessage({ data: { type: 'ack', sequence: 99 } });
    processor.process([[new Float32Array([1, 1, 1])]]);
    expect(messages.at(-1)).toEqual({
      type: 'stopped',
      sequence: 7,
      frames: PCM_CHUNK_FRAMES * 6 + 1,
      limit: true,
    });
    expect(new Float32Array(messages.at(-2)!.samples!)).toHaveLength(1);
  });
  it('handles no input and empty stop without fabricating samples', () => {
    const { processor, messages } = harness();
    processor.process([]);
    processor.process([[]]);
    processor.port.onmessage({ data: { type: 'stop' } });
    expect(messages).toEqual([{ type: 'stopped', sequence: 0, frames: 0, limit: false }]);
  });
});
