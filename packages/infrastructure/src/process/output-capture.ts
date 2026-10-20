import { StringDecoder } from 'node:string_decoder';

/** Raw-byte bounded UTF-8 output. Each capture owns an independent streaming decoder. */
export class BoundedOutputCapture {
  private readonly chunks: string[] = [];
  private readonly decoder = new StringDecoder('utf8');
  private captured = 0;
  private exceeded = false;
  private finished: string | undefined;

  constructor(private readonly maxBytes: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
      throw new RangeError('output byte limit must be a nonnegative safe integer');
  }

  append(chunk: Uint8Array): void {
    if (this.finished !== undefined) throw new Error('output capture is already finished');
    const remaining = this.maxBytes - this.captured;
    if (chunk.byteLength > remaining) this.exceeded = true;
    if (remaining === 0 || chunk.byteLength === 0) return;
    const kept = chunk.subarray(0, remaining);
    const text = this.decoder.write(Buffer.from(kept.buffer, kept.byteOffset, kept.byteLength));
    if (text) this.chunks.push(text);
    this.captured += kept.byteLength;
  }

  get byteLength(): number {
    return this.captured;
  }
  get overflow(): boolean {
    return this.exceeded;
  }

  /** Final read: replace incomplete EOF bytes (also after interruption), but omit a cap-split suffix. */
  text(): string {
    this.finished ??= this.chunks.join('') + (this.exceeded ? '' : this.decoder.end());
    return this.finished;
  }
}
