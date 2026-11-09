export const VOICE_SAMPLE_RATE = 16_000;
export const WAV_HEADER_BYTES = 44;

/** Convert without changing frame count, including single-sample utterances. */
export function signed16(samples: Float32Array): ArrayBuffer {
  const bytes = new ArrayBuffer(samples.length * 2);
  const view = new DataView(bytes);
  for (let i = 0; i < samples.length; i++) {
    if (!Number.isFinite(samples[i])) throw new Error('Voice audio contains invalid samples.');
    const sample = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(i * 2, Math.round(sample * (sample < 0 ? 32_768 : 32_767)), true);
  }
  return bytes;
}

export function wavHeader(pcmBytes: number): ArrayBuffer {
  if (
    !Number.isSafeInteger(pcmBytes) ||
    pcmBytes < 0 ||
    pcmBytes > 0xffff_ffff - 36 ||
    pcmBytes % 2
  ) {
    throw new Error('PCM frames must be complete signed 16-bit samples.');
  }
  const bytes = new ArrayBuffer(WAV_HEADER_BYTES);
  const view = new DataView(bytes);
  for (const [offset, text] of [
    [0, 'RIFF'],
    [8, 'WAVE'],
    [12, 'fmt '],
    [36, 'data'],
  ] as const) {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  }
  view.setUint32(4, pcmBytes + 36, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, VOICE_SAMPLE_RATE, true);
  view.setUint32(28, VOICE_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, pcmBytes, true);
  return bytes;
}

export function pcmWav(parts: BlobPart[], pcmBytes: number): Blob {
  return new Blob([wavHeader(pcmBytes), ...parts], { type: 'audio/wav' });
}

/** Native, bounded resampling; verify the rendered format before labelling it. */
export async function resamplePcm(
  chunks: readonly Float32Array[],
  sourceFrames: number,
  sourceRate: number,
  maxFrames: number,
): Promise<ArrayBuffer> {
  const frames = Math.min(
    maxFrames,
    Math.max(1, Math.round((sourceFrames * VOICE_SAMPLE_RATE) / sourceRate)),
  );
  const context = new OfflineAudioContext(1, frames, VOICE_SAMPLE_RATE);
  const input = context.createBuffer(1, sourceFrames, sourceRate);
  const channel = input.getChannelData(0);
  let offset = 0;
  for (const chunk of chunks) {
    channel.set(chunk, offset);
    offset += chunk.length;
  }
  const source = context.createBufferSource();
  source.buffer = input;
  source.connect(context.destination);
  source.start();
  const output = await context.startRendering();
  if (
    output.sampleRate !== VOICE_SAMPLE_RATE ||
    output.numberOfChannels !== 1 ||
    output.length !== frames
  ) {
    throw new Error('This browser could not produce mono 16-kHz voice audio.');
  }
  return signed16(output.getChannelData(0));
}
