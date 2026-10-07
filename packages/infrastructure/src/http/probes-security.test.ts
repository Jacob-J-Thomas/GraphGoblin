import { describe, expect, it } from 'vitest';
import { HttpProbes } from './probes.js';

const request = { method: 'GET' as const, url: 'https://example.invalid/probe', timeoutMs: 10_000 };

describe('probe credential boundaries', () => {
  it('omits credential response headers case-insensitively while preserving ordinary response data', async () => {
    const probes = new HttpProbes(() =>
      Promise.resolve(
        new Response('{"authorization":"user payload unchanged"}', {
          status: 503,
          headers: {
            AUTHORIZATION: 'Bearer private-authorization',
            'Proxy-Authorization': 'Basic private-proxy',
            Cookie: 'private-request-cookie',
            'Set-Cookie': 'private-response-cookie',
            'API-KEY': 'private-api-key',
            'X-Api-Key': 'private-x-api-key',
            'Content-Type': 'application/json',
            ETag: 'public-tag',
            'X-RateLimit-Remaining': '7',
          },
        }),
      ),
    );
    const response = await probes.fetch(request, new AbortController().signal);
    expect(response.status).toBe(503);
    expect(response.body).toBe('{"authorization":"user payload unchanged"}');
    expect(response.json).toEqual({ authorization: 'user payload unchanged' });
    expect(response.headers).toEqual({
      'content-type': 'application/json',
      etag: 'public-tag',
      'x-ratelimit-remaining': '7',
    });
    expect(JSON.stringify(response.headers)).not.toContain('private-');
  });

  it('replaces raw transport and body-reader diagnostics with a safe typed code', async () => {
    const unsafeMessage =
      'https://user:private-password@example.invalid/?token=private-token Authorization: Bearer private-key';
    const brokenFetch = new HttpProbes(() => Promise.reject(new Error(unsafeMessage)));
    const brokenBody = new HttpProbes(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error(unsafeMessage));
            },
          }),
        ),
      ),
    );
    for (const probes of [brokenFetch, brokenBody]) {
      await expect(probes.fetch(request, new AbortController().signal)).rejects.toMatchObject({
        name: 'HttpProbeError',
        code: 'HTTP_PROBE_FAILED',
        message: 'HTTP probe failed',
      });
      try {
        await probes.fetch(request, new AbortController().signal);
      } catch (error) {
        expect(JSON.stringify(error)).not.toContain('private-');
        expect(error).not.toHaveProperty('cause');
      }
    }
  });

  it('preserves caller-abort control semantics without exposing its supplied reason', async () => {
    const caller = new AbortController();
    const reason = new Error('private cancellation reason');
    caller.abort(reason);
    const probes = new HttpProbes(() => Promise.reject(reason));
    await expect(probes.fetch(request, caller.signal)).rejects.toMatchObject({
      name: 'AbortError',
      message: 'HTTP probe aborted',
    });
  });

  it('rejects CRLF header injection through the platform header normalizer with safe diagnostics', async () => {
    const probes = new HttpProbes(() =>
      Promise.resolve(
        new Response('', { headers: { 'X-Public': 'public\r\nAuthorization: private-key' } }),
      ),
    );
    await expect(probes.fetch(request, new AbortController().signal)).rejects.toMatchObject({
      name: 'HttpProbeError',
      code: 'HTTP_PROBE_FAILED',
      message: 'HTTP probe failed',
    });
  });
});
