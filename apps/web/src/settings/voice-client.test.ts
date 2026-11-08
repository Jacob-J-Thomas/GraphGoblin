import { createGraphGoblinClient, GraphGoblinApiError } from '@graphgoblin/api-client';
import { describe, expect, it, vi } from 'vitest';
import { voiceErrorMessage, voiceErrorNeedsEditor, voiceSetup } from './voice-client.js';

describe('owner voice transport', () => {
  it('preserves configured owner headers and validates a setup response', async () => {
    const fetch = vi.fn((request: Request) => {
      expect(request.url).toBe('https://gateway.test/chat/voice/config');
      expect(request.headers.get('authorization')).toBe('Bearer owner-test');
      expect(request.cache).toBe('no-store');
      return Promise.resolve(Response.json({ bad: 'shape' }));
    });
    const client = createGraphGoblinClient({
      baseUrl: 'https://gateway.test',
      apiKey: 'owner-test',
      fetch,
    });
    await expect(voiceSetup.get(client)).rejects.toMatchObject({
      code: 'VOICE_RESPONSE_INVALID',
      status: 502,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('reports request failure without exposing private diagnostics in the UI', async () => {
    const client = createGraphGoblinClient({
      baseUrl: 'https://gateway.test',
      fetch: () =>
        Promise.resolve(
          Response.json(
            { code: 'VOICE_LOCAL_UNAVAILABLE', status: 503, detail: '/private/path/raw error' },
            { status: 503 },
          ),
        ),
    });
    const error = await voiceSetup.get(client).catch((error: unknown) => error);
    expect(voiceErrorMessage(error)).toBe(
      'The local voice engine is unavailable. Install it here or choose Cloud provider.',
    );
    expect(voiceErrorMessage(error)).not.toContain('/private/');
  });

  it('wraps network failure and preserves abort', async () => {
    const client = createGraphGoblinClient({
      baseUrl: 'https://gateway.test',
      fetch: () => Promise.reject(new Error('offline')),
    });
    await expect(voiceSetup.get(client)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
    });
    const controller = new AbortController();
    controller.abort();
    const abort = new DOMException('Aborted', 'AbortError');
    const aborted = createGraphGoblinClient({
      baseUrl: 'https://gateway.test',
      fetch: () => Promise.reject(abort),
    });
    await expect(voiceSetup.get(aborted, controller.signal)).rejects.toBe(abort);
  });

  it.each([
    [401, 'AUTH', 'Use the gateway owner key'],
    [403, 'AUTH', 'Use the gateway owner key'],
    [409, 'CONFLICT', 'changed. Check again'],
    [409, 'VOICE_PREVIEW_INVALID', 'Review the loop in the editor'],
    [409, 'VOICE_PRESET_PROMPT_UNSUPPORTED', 'raw input can miss voice transcripts'],
    [429, 'VOICE_OPERATION_CAPACITY', 'review its operation-history capacity'],
    [503, 'VOICE_OPERATION_RETIRED', 'will not be restarted'],
    [409, 'VOICE_PROBE_STALE', 'explicitly run a new sample test'],
    [400, 'VOICE_CLOUD_DISCLOSURE_REQUIRED', 'Confirm the test sample upload'],
    [429, 'LIMIT', 'limit was reached'],
    [400, 'VOICE_CLOUD_AUTH', 'Re-enter the key'],
    [400, 'VOICE_CREDENTIAL_INVALID', 'Re-enter the key'],
    [0, 'NETWORK_ERROR', 'Couldn’t reach this gateway'],
    [500, 'UNEXPECTED', 'Couldn’t complete voice setup'],
  ])('has a safe next action for %s / %s', (status, code, copy) => {
    expect(
      voiceErrorMessage(new GraphGoblinApiError({ status, code, detail: 'private diagnostic' })),
    ).toContain(copy);
  });

  it('does not reveal non-API exception messages', () => {
    expect(voiceErrorMessage(new Error('secret diagnostic'))).not.toContain('secret');
  });

  it('reserves the guided editor exit for authored-loop refusals', () => {
    for (const code of ['VOICE_PREVIEW_INVALID', 'VOICE_PRESET_PROMPT_UNSUPPORTED']) {
      expect(voiceErrorNeedsEditor(new GraphGoblinApiError({ status: 409, code }))).toBe(true);
    }
    expect(
      voiceErrorNeedsEditor(new GraphGoblinApiError({ status: 409, code: 'VOICE_PROBE_STALE' })),
    ).toBe(false);
    expect(voiceErrorNeedsEditor(new Error('VOICE_PRESET_PROMPT_UNSUPPORTED'))).toBe(false);
  });
});
