import { GraphGoblinApiError, unwrap, type FetchResult } from './errors.js';

/**
 * Response types `fetch` gives a network response: same-origin (`basic`) or CORS. A `Response`
 * built in user code is `default`, and `Response.error()` is `error`.
 */
const NATIVE_RESPONSE_TYPES: ReadonlySet<Response['type']> = new Set<Response['type']>([
  'basic',
  'cors',
]);

/**
 * Read the JSON body of an openapi-fetch result requested with `parseAs: 'stream'`, from the
 * original `Response` and without replacing it.
 *
 * A non-2xx result goes through {@link unwrap} unchanged, so a refusal stays typed and a refusal
 * whose own body failed has already rejected inside openapi-fetch with its raw error. A result
 * without a body (204, HEAD, `Content-Length: 0`) and a complete empty body resolve to
 * `undefined`. Otherwise the body is decoded as streaming UTF-8 and parsed once it is complete,
 * so malformed JSON still rejects with `SyntaxError`.
 *
 * Only one failure is classified: a rejected `read()` of a successful native (`basic` or `cors`)
 * response to a GET, while `signal` is not aborted. The connection ended after the server's 2xx
 * headers and before a usable body, so it becomes {@link GraphGoblinApiError.interrupted}
 * (status 0, `RESPONSE_INTERRUPTED`, the native error as `cause`). A write is never classified:
 * its 2xx headers already prove the server accepted it. A read rejected after `signal` aborted
 * rethrows the identical rejection; constructed or proxied responses, a locked or used body,
 * decoding and parsing all keep their own errors. No error text or class is inspected and nothing
 * is retried.
 */
export async function readJson<D>(
  method: string,
  result: FetchResult<Response['body']>,
  signal: AbortSignal | undefined,
): Promise<D> {
  const body = unwrap(result);
  if (!body) return undefined as D;
  const eligible = method === 'GET' && NATIVE_RESPONSE_TYPES.has(result.response.type);
  // Acquired outside the classified region: a locked or used body keeps its own TypeError.
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    let chunk: Awaited<ReturnType<typeof reader.read>>;
    try {
      chunk = await reader.read();
    } catch (error) {
      if (!eligible || signal?.aborted) throw error;
      throw GraphGoblinApiError.interrupted(error);
    }
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  return (text === '' ? undefined : JSON.parse(text)) as D;
}
