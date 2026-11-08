import type { PromptSubmission } from '@graphgoblin/contracts';

export type OllamaFetch = typeof fetch;
export class OllamaError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly submission: PromptSubmission = 'definitely-not-submitted',
    readonly retriable = false,
  ) {
    super(message);
    this.name = 'OllamaError';
  }
}
export function aborted(): DOMException {
  return new DOMException('Ollama request cancelled', 'AbortError');
}
export function protocolError(): OllamaError {
  return new OllamaError(
    'HARNESS_PROTOCOL_ERROR',
    'Ollama returned an invalid or incomplete response',
    'delivery-uncertain',
  );
}
export function httpFailure(status: number): OllamaError {
  const submission = [400, 401, 403, 404].includes(status)
    ? 'definitely-not-submitted'
    : 'delivery-uncertain';
  if (status === 401 || status === 403)
    return new OllamaError(
      'HARNESS_NOT_AUTHENTICATED',
      'Ollama service rejected access',
      submission,
    );
  if (status === 404)
    return new OllamaError(
      'HARNESS_MODEL_UNAVAILABLE',
      'Ollama model or service endpoint is unavailable; refresh models and check the connection',
      submission,
    );
  if (status === 429)
    return new OllamaError(
      'HARNESS_QUOTA_EXHAUSTED',
      'Ollama service usage limit reached',
      submission,
    );
  if (status >= 500)
    return new OllamaError('HARNESS_TRANSPORT_FAILED', 'Ollama service is unavailable', submission);
  return new OllamaError('HARNESS_TURN_FAILED', 'Ollama service rejected the request', submission);
}
export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export async function requestJson(
  fetcher: OllamaFetch,
  baseUrl: string,
  path: '/api/tags' | '/api/show' | '/api/version',
  signal: AbortSignal,
  body?: { model: string },
): Promise<unknown> {
  if (signal.aborted) throw aborted();
  const deadline = AbortSignal.timeout(5000);
  const combined = AbortSignal.any([signal, deadline]);
  let response: Response;
  try {
    response = await fetcher(`${baseUrl}${path}`, {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      signal: combined,
      ...(body
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    });
  } catch {
    if (signal.aborted) throw aborted();
    throw new OllamaError(
      'OLLAMA_DISCOVERY_UNAVAILABLE',
      'Ollama metadata request failed; check the connection URL and service',
    );
  }
  if (combined.aborted) {
    await response.body?.cancel();
    if (signal.aborted) throw aborted();
    throw new OllamaError(
      'OLLAMA_DISCOVERY_UNAVAILABLE',
      'Ollama metadata request exceeded its deadline',
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw httpFailure(response.status);
  }
  if (!response.body) throw protocolError();
  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
  const cancelReader = () => {
    void reader.cancel().catch(() => undefined);
  };
  combined.addEventListener('abort', cancelReader, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (combined.aborted) {
        if (signal.aborted) throw aborted();
        throw new OllamaError(
          'OLLAMA_DISCOVERY_UNAVAILABLE',
          'Ollama metadata request exceeded its deadline',
        );
      }
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 2 * 1024 * 1024)
        throw new OllamaError(
          'OLLAMA_DISCOVERY_LIMIT',
          'Ollama metadata response exceeds the discovery limit',
        );
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch (error) {
    if (signal.aborted) throw aborted();
    if (error instanceof OllamaError) throw error;
    throw new OllamaError(
      'OLLAMA_DISCOVERY_INVALID',
      'Ollama returned invalid or incomplete model metadata',
    );
  } finally {
    combined.removeEventListener('abort', cancelReader);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
