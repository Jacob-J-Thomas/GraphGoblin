import { describe, it, expect } from 'vitest';
import { validateCanonicalChatWav } from './media.js';
import { voiceProbeSample } from './voice-sample.js';
describe('canonical voice WAV boundary', () => {
  it('accepts included PCM16 speech and rejects malformed rate, lengths, alignment and excess duration', () => {
    const good = voiceProbeSample();
    expect(validateCanonicalChatWav(good).durationSeconds).toBeGreaterThan(1);
    for (const mutate of [
      (b: Buffer) => b.writeUInt32LE(48000, 24),
      (b: Buffer) => b.writeUInt16LE(2, 22),
      (b: Buffer) => b.writeUInt32LE(1, 40),
      (b: Buffer) => b.writeUInt32LE(1, 4),
      (b: Buffer) => b.writeUInt16LE(3, 20),
    ]) {
      const bad = Buffer.from(good);
      mutate(bad);
      expect(() => validateCanonicalChatWav(bad)).toThrow();
    }
    expect(() => validateCanonicalChatWav(good.subarray(0, 43))).toThrow();
    const long = Buffer.alloc(44 + 32000 * 121);
    good.copy(long, 0, 0, 44);
    long.writeUInt32LE(long.length - 8, 4);
    long.writeUInt32LE(long.length - 44, 40);
    expect(() => validateCanonicalChatWav(long)).toThrow('120 seconds');
  });
});
