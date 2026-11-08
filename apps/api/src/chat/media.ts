import { ChatError } from './errors.js';

const AUDIO_TYPES = new Set([
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
const CODECS = new Set(['opus', 'vorbis', 'pcm', 'flac', 'mp3', 'aac', 'mp4a.40.2', 'mp4a.40.5']);

/** Container metadata is validated without claiming that the audio has been decoded. */
export function normalizeChatMediaType(header: string | undefined): string {
  const [rawType, ...parameters] = (header ?? '').split(';');
  const mimeType = rawType?.trim().toLowerCase() ?? '';
  if (!AUDIO_TYPES.has(mimeType))
    throw new ChatError('CHAT_MEDIA_UNSUPPORTED', 415, 'use a supported audio container');
  if (parameters.length > 1)
    throw new ChatError('CHAT_MEDIA_UNSUPPORTED', 415, 'unsupported audio content-type parameters');
  for (const parameter of parameters) {
    const match = /^\s*codecs\s*=\s*(?:"([A-Za-z0-9., -]+)"|([A-Za-z0-9.,-]+))\s*$/i.exec(
      parameter,
    );
    const codecs = (match?.[1] ?? match?.[2])
      ?.split(',')
      .map((codec) => codec.trim().toLowerCase());
    if (!codecs?.length || codecs.some((codec) => !CODECS.has(codec)))
      throw new ChatError('CHAT_MEDIA_UNSUPPORTED', 415, 'unsupported audio codec parameter');
  }
  return mimeType === 'audio/x-wav' ? 'audio/wav' : mimeType;
}

/** The guided preset accepts one canonical uncompressed WAV; no decoder or transcoder is invoked. */
export function validateCanonicalChatWav(bytes: Uint8Array): { durationSeconds: number } {
  const invalid = (): never => {
    throw new ChatError(
      'CHAT_AUDIO_INVALID_WAV',
      400,
      'voice requires 16 kHz mono PCM16 WAV with a complete aligned payload',
    );
  };
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    data.length < 46 ||
    data.toString('ascii', 0, 4) !== 'RIFF' ||
    data.toString('ascii', 8, 12) !== 'WAVE' ||
    data.readUInt32LE(4) !== data.length - 8
  )
    return invalid();
  if (
    data.toString('ascii', 12, 16) !== 'fmt ' ||
    data.readUInt32LE(16) !== 16 ||
    data.readUInt16LE(20) !== 1 ||
    data.readUInt16LE(22) !== 1 ||
    data.readUInt32LE(24) !== 16000 ||
    data.readUInt32LE(28) !== 32000 ||
    data.readUInt16LE(32) !== 2 ||
    data.readUInt16LE(34) !== 16 ||
    data.toString('ascii', 36, 40) !== 'data'
  )
    return invalid();
  const size = data.readUInt32LE(40);
  if (!size || size % 2 || size !== data.length - 44) return invalid();
  const durationSeconds = size / 32000;
  if (durationSeconds > 120)
    throw new ChatError('CHAT_AUDIO_TOO_LONG', 413, 'voice drafts can contain at most 120 seconds');
  return { durationSeconds };
}
