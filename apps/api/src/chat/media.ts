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
