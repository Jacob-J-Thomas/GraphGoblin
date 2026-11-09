export const PCM_CHUNK_FRAMES = 4_096;
// 512 KiB of transferable PCM tolerates a short UI stall even at device rates.
export const PCM_QUEUE_CHUNKS = 32;

/** Standalone AudioWorklet module; tests execute this exact source in a worklet harness. */
export const PCM_WORKLET_SOURCE = `
class GoblinPcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.maximum = options.processorOptions.maxFrames;
    this.buffer = new Float32Array(${PCM_CHUNK_FRAMES});
    this.used = 0;
    this.frames = 0;
    this.sequence = 0;
    this.acked = 0;
    this.stopped = false;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'ack' && data.sequence === this.acked + 1) this.acked = data.sequence;
      if (data.type === 'stop') this.finish();
    };
  }
  flush() {
    if (!this.used) return true;
    if (this.sequence - this.acked >= ${PCM_QUEUE_CHUNKS}) {
      this.port.postMessage({ type: 'error' });
      this.stopped = true;
      return false;
    }
    const samples = this.used === this.buffer.length ? this.buffer : this.buffer.slice(0, this.used);
    this.port.postMessage({ type: 'chunk', sequence: ++this.sequence, samples: samples.buffer }, [samples.buffer]);
    this.buffer = new Float32Array(${PCM_CHUNK_FRAMES});
    this.used = 0;
    return true;
  }
  finish(limit = false) {
    if (this.stopped) return;
    if (!this.flush()) return;
    this.stopped = true;
    this.port.postMessage({ type: 'stopped', sequence: this.sequence, frames: this.frames, limit });
  }
  process(inputs) {
    if (this.stopped) return true;
    const channels = inputs[0];
    if (!channels || !channels.length) return true;
    const count = channels[0].length;
    for (let i = 0; i < count; i++) {
      let mono = 0;
      for (const channel of channels) mono += channel[i] || 0;
      this.buffer[this.used++] = mono / channels.length;
      this.frames++;
      if (this.used === this.buffer.length && !this.flush()) return true;
      if (this.frames >= this.maximum) { this.finish(true); return true; }
    }
    return true;
  }
}
registerProcessor('goblin-pcm-capture', GoblinPcmCapture);
`;
