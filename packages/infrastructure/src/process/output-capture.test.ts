import { describe, expect, it } from 'vitest';
import { BoundedOutputCapture } from './output-capture.js';

describe('items-mode byte capture', () => {
  it('admits exactly the cap, detects the first extra byte and retains only the bounded prefix', () => {
    const capture = new BoundedOutputCapture(65_536);
    capture.append(Buffer.from('a'.repeat(65_535)));
    expect(capture.overflow).toBe(false);
    capture.append(Buffer.from('b'));
    expect(capture.byteLength).toBe(65_536);
    expect(capture.overflow).toBe(false);
    capture.append(Buffer.from('private-overflow-content'.repeat(10_000)));
    capture.append(Buffer.from('ignored'));
    expect(capture.overflow).toBe(true);
    expect(capture.byteLength).toBe(65_536);
    expect(capture.text()).toBe('a'.repeat(65_535) + 'b');
    expect(capture.text()).not.toContain('private-');
  });

  it('counts UTF-8 bytes across chunk boundaries and omits a cap-split final character', () => {
    const bytes = Buffer.from('A雪🦎Z', 'utf8');
    const complete = new BoundedOutputCapture(bytes.byteLength);
    for (const byte of bytes) complete.append(Uint8Array.of(byte));
    expect(complete.overflow).toBe(false);
    expect(complete.byteLength).toBe(9);
    expect(complete.text()).toBe('A雪🦎Z');
    const partial = new BoundedOutputCapture(6);
    for (const byte of bytes) partial.append(Uint8Array.of(byte));
    expect(partial.overflow).toBe(true);
    expect(partial.byteLength).toBe(6);
    expect(partial.text()).toBe('A雪');
    expect(Buffer.byteLength(partial.text())).toBeLessThanOrEqual(6);
  });

  it('copies input chunks so reused native buffers cannot alter captured evidence', () => {
    const capture = new BoundedOutputCapture(4);
    const chunk = Buffer.from('safe-tail');
    capture.append(chunk);
    chunk.fill(120);
    expect(capture.text()).toBe('safe');
    expect(capture.overflow).toBe(true);
  });

  it('handles empty output and a zero cap while refusing invalid limits', () => {
    const empty = new BoundedOutputCapture(0);
    empty.append(new Uint8Array());
    expect(empty.text()).toBe('');
    expect(empty.overflow).toBe(false);
    empty.append(Uint8Array.of(1));
    expect(empty.byteLength).toBe(0);
    expect(empty.overflow).toBe(true);
    for (const invalid of [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      expect(() => new BoundedOutputCapture(invalid)).toThrow(RangeError);
  });
});
