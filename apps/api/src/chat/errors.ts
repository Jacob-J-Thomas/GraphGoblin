/** Safe, bounded public failures for chat commands; never attach engine/provider details. */
export class ChatError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ChatError';
  }
}

export const CHAT_ERROR_STATUS: Readonly<Record<string, number>> = {
  CHAT_NOT_READY: 409,
  CHAT_AUDIO_UNAVAILABLE: 409,
  CHAT_BUSY: 409,
  CHAT_STALE_CONTEXT: 409,
  CHAT_REQUEST_CONFLICT: 409,
  CHAT_HISTORY_DELETED: 410,
  CHAT_AUDIO_EXPIRED: 410,
  CHAT_AUDIO_CONSUMED: 409,
  CHAT_AUDIO_TOO_LARGE: 413,
  CHAT_MEDIA_UNSUPPORTED: 415,
  CHAT_PAIRING_INVALID: 401,
  CHAT_PAIRING_UNAVAILABLE: 409,
  CHAT_NOT_FOUND: 404,
  CHAT_AUDIO_QUOTA: 429,
  CHAT_AUDIO_BUSY: 429,
  CHAT_BINDING_INVALID: 409,
};
