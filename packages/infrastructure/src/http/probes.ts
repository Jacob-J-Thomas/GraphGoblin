import type { HttpProbePort, ProbeRequest, ProbeResponse } from '@graphgoblin/engine';

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

/** HTTP probe over platform fetch. Bodies remain text/JSON; credential response headers are omitted. */
export class HttpProbes implements HttpProbePort {
  constructor(private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init)) {}

  async fetch(request: ProbeRequest, signal: AbortSignal): Promise<ProbeResponse> {
    const timeout = AbortSignal.timeout(request.timeoutMs);
    try {
      const response = await this.fetchImpl(request.url, {
        method: request.method,
        headers: request.headers ?? {},
        ...(request.body !== undefined && request.method !== 'GET' && request.method !== 'HEAD'
          ? { body: request.body }
          : {}),
        signal: AbortSignal.any([signal, timeout]),
        redirect: 'follow',
      });
      const body = request.method === 'HEAD' ? '' : await response.text();
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
    } catch {
      if (signal.aborted) throw new DOMException('HTTP probe aborted', 'AbortError');
      if (timeout.aborted) throw new DOMException('HTTP probe timed out', 'TimeoutError');
      throw new HttpProbeError();
    }
  }
}
