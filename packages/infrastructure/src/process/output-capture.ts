import { StringDecoder } from 'node:string_decoder';

/** Raw-byte bounded process output for items-mode probes; overflow is an explicit failure signal. */
export class BoundedOutputCapture {
  private readonly chunks: Buffer[] = [];
  private captured = 0;
  private exceeded = false;

  constructor(private readonly maxBytes: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
      throw new RangeError('output byte limit must be a nonnegative safe integer');
  }

  append(chunk: Uint8Array): void {
    const remaining = this.maxBytes - this.captured;
    if (chunk.byteLength > remaining) this.exceeded = true;
    if (remaining === 0 || chunk.byteLength === 0) return;
    const kept = chunk.subarray(0, remaining);
    this.chunks.push(Buffer.from(kept));
    this.captured += kept.byteLength;
  }

  get byteLength(): number {
    return this.captured;
  }
  get overflow(): boolean {
    return this.exceeded;
  }

  /** Streaming decode avoids manufacturing a replacement character for a cap-split UTF-8 suffix. */
  text(): string {
    const decoder = new StringDecoder('utf8');
    const prefix = decoder.write(Buffer.concat(this.chunks, this.captured));
    return this.exceeded ? prefix : prefix + decoder.end();
  }
}
