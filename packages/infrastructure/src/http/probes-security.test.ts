import { describe, expect, it } from 'vitest';
import { HttpProbes } from './probes.js';
import { HTTP_PROBE_MAX_BODY_BYTES, ProbeBodyOverflowError } from '@graphgoblin/engine';

const request = { method: 'GET' as const, url: 'https://example.invalid/probe', timeoutMs: 10_000 };

describe('probe credential boundaries', () => {
  it('refuses malformed external stream chunks with safe diagnostics', async () => {
    // Deliberately malformed transport input; platform fetch normally guarantees byte chunks.
    const malformed = new ReadableStream<unknown>({
      start(controller) {
        controller.enqueue('private non-byte chunk');
        controller.close();
      },
    });
    const response = new Response(malformed as ReadableStream<Uint8Array>);
    const probes = new HttpProbes(() => Promise.resolve(response));
    await expect(probes.fetch(request, new AbortController().signal)).rejects.toMatchObject({
      code: 'HTTP_PROBE_FAILED',
      message: 'HTTP probe failed',
    });
    expect(response.body?.locked).toBe(false);
  });
  it('keeps the typed overflow safe when transport cancellation itself fails', async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            controller.enqueue(new Uint8Array(HTTP_PROBE_MAX_BODY_BYTES + 1));
          },
          cancel() {
            throw new Error('private transport failure');
          },
        },
        { highWaterMark: 0 },
      ),
    );
    const probes = new HttpProbes(() => Promise.resolve(response));
    await expect(probes.fetch(request, new AbortController().signal)).rejects.toMatchObject({
      name: 'ProbeBodyOverflowError',
      code: 'HTTP_PROBE_BODY_OVERFLOW',
      message: 'HTTP probe body exceeds byte limit',
    });
    expect(response.body?.locked).toBe(false);
  });
  it('rejects an oversized advertised body before reading, cancels it, and releases the lock', async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>(
        {
          pull() {
            throw new Error('must not read private body');
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      ),
      { headers: { 'content-length': String(HTTP_PROBE_MAX_BODY_BYTES + 1) } },
    );
    const probes = new HttpProbes(() => Promise.resolve(response));
    await expect(probes.fetch(request, new AbortController().signal)).rejects.toBeInstanceOf(
      ProbeBodyOverflowError,
    );
    expect(cancelled).toBe(true);
    expect(response.body?.locked).toBe(false);
  });

  it('handles an absent body and cancels a supplied HEAD body without interpreting its length', async () => {
    const probes = new HttpProbes(() => Promise.resolve(new Response(null, { status: 204 })));
    expect(await probes.fetch(request, new AbortController().signal)).toMatchObject({
      status: 204,
      body: '',
    });
    const response = new Response('ignored', { headers: { 'content-length': '999999' } });
    const head = new HttpProbes(() => Promise.resolve(response));
    expect(
      await head.fetch({ ...request, method: 'HEAD' }, new AbortController().signal),
    ).toMatchObject({ body: '' });
    expect(response.bodyUsed).toBe(true);
    expect(response.body?.locked).toBe(false);
  });

  it('cancels a pending injected body read on abort and discards the supplied private reason', async () => {
    const caller = new AbortController();
    let began!: () => void;
    const reading = new Promise<void>((resolve) => {
      began = resolve;
    });
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>(
        {
          pull() {
            began();
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      ),
    );
    const probes = new HttpProbes(() => Promise.resolve(response));
    const result = probes.fetch(request, caller.signal);
    const assertion = expect(result).rejects.toMatchObject({
      name: 'AbortError',
      message: 'HTTP probe aborted',
    });
    await reading;
    caller.abort(new Error('private reason'));
    await assertion;
    expect(cancelled).toBe(true);
    expect(response.body?.locked).toBe(false);
  });
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
