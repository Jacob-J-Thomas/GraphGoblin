import type { HttpProbePort, ProbeRequest, ProbeResponse } from '@graphgoblin/engine';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** HTTP probe over the platform fetch. Bodies are read as text; JSON content types are parsed. */
export class HttpProbes implements HttpProbePort {
  constructor(private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init)) {}

  async fetch(request: ProbeRequest, signal: AbortSignal): Promise<ProbeResponse> {
    const response = await this.fetchImpl(request.url, {
      method: request.method,
      headers: request.headers ?? {},
      ...(request.body !== undefined && request.method !== 'GET' && request.method !== 'HEAD'
        ? { body: request.body }
        : {}),
      signal: AbortSignal.any([signal, AbortSignal.timeout(request.timeoutMs)]),
      redirect: 'follow',
    });
    const body = request.method === 'HEAD' ? '' : await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
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
  }
}
