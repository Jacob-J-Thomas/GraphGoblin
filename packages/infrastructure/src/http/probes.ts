import type { HttpProbePort, ProbeRequest, ProbeResponse } from '@graphgoblin/engine';
import { HTTP_PROBE_MAX_BODY_BYTES, ProbeBodyOverflowError } from '@graphgoblin/engine';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const CREDENTIAL_RESPONSE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'api-key',
  'x-api-key',
]);

/** Probe diagnostics can be persisted; never include transport URLs, headers or raw exceptions. */
export class HttpProbeError extends Error {
  readonly code = 'HTTP_PROBE_FAILED';
  constructor() {
    super('HTTP probe failed');
    this.name = 'HttpProbeError';
  }
}

/** Platform fetch yields decompressed bytes. Bound them before allocating text or parsing JSON. */
async function boundedBody(response: Response, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader();
  const onAbort = (): void => {
    void reader?.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    signal.throwIfAborted();
    if (!reader) return '';
    const length = response.headers.get('content-length');
    const encoding = response.headers.get('content-encoding');
    // Encoded Content-Length counts wire bytes; the stream budget counts decompressed bytes.
    if (
      (encoding === null || encoding.trim().toLowerCase() === 'identity') &&
      length !== null &&
      /^\d+$/.test(length) &&
      Number(length) > HTTP_PROBE_MAX_BODY_BYTES
    )
      throw new ProbeBodyOverflowError();
    // One fixed buffer also bounds bookkeeping for streams of tiny chunks.
    const bytes = new Uint8Array(HTTP_PROBE_MAX_BODY_BYTES);
    let size = 0;
    while (true) {
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      const value: unknown = part.value;
      if (!(value instanceof Uint8Array)) throw new HttpProbeError();
      if (value.byteLength > bytes.byteLength - size) throw new ProbeBodyOverflowError();
      bytes.set(value, size);
      size += value.byteLength;
    }
    return new TextDecoder().decode(bytes.subarray(0, size));
  } finally {
    signal.removeEventListener('abort', onAbort);
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        /* Preserve the safe primary failure. */
      }
      reader.releaseLock();
    }
  }
}

/** HTTP probe over platform fetch. Bodies remain text/JSON; credential response headers are omitted. */
export class HttpProbes implements HttpProbePort {
  constructor(private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init)) {}

  async fetch(request: ProbeRequest, signal: AbortSignal): Promise<ProbeResponse> {
    const timeout = AbortSignal.timeout(request.timeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    try {
      const response = await this.fetchImpl(request.url, {
        method: request.method,
        headers: request.headers ?? {},
        ...(request.body !== undefined && request.method !== 'GET' && request.method !== 'HEAD'
          ? { body: request.body }
          : {}),
        signal: combined,
        redirect: 'follow',
      });
      // HEAD's Content-Length describes the representation, not a response body.
      let body = '';
      if (request.method === 'HEAD') await response.body?.cancel();
      else body = await boundedBody(response, combined);
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        const name = key.toLowerCase();
        if (!CREDENTIAL_RESPONSE_HEADERS.has(name)) headers[name] = value;
      });
      let json: unknown;
      if (/json/i.test(headers['content-type'] ?? '')) {
        try {
          json = JSON.parse(body);
        } catch {
          json = undefined;
        }
      }
      return { status: response.status, headers, body, ...(json !== undefined ? { json } : {}) };
    } catch (error) {
      if (signal.aborted) throw new DOMException('HTTP probe aborted', 'AbortError');
      if (timeout.aborted) throw new DOMException('HTTP probe timed out', 'TimeoutError');
      if (error instanceof ProbeBodyOverflowError) throw error;
      throw new HttpProbeError();
    }
  }
}
