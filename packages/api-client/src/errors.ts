/** RFC 9457 Problem Details as the GraphGoblin API returns them, with a stable `code` (docs/07). */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status: number;
  code: string;
  detail?: string;
  errors?: unknown;
  /** Extension members, such as `draftToken` on a 409 `DRAFT_CONFLICT`. */
  [extension: string]: unknown;
}

/**
 * `status` used when no usable HTTP response arrived. The client maps a `fetch` rejection before
 * any response headers (DNS, refused connection, reset) to it with code `NETWORK_ERROR`, and
 * `runs.get` and `runs.observation` map a successful GET body that the connection cut short to it
 * with code `RESPONSE_INTERRUPTED`. Nothing else maps a failure after headers: raw `client.GET`,
 * other resource wrappers, writes, `parseAs: 'stream'` callers and the SSE helper surface the
 * native body error unchanged.
 */
export const NETWORK_ERROR_STATUS = 0;

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isProblemDetails(value: unknown): value is ProblemDetails {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string' &&
    typeof (value as { status?: unknown }).status === 'number'
  );
}

/**
 * An API call that did not succeed. For HTTP failures it carries the server's problem details.
 * `status` 0 means no usable response arrived: `code` is `NETWORK_ERROR` when `fetch` itself
 * failed, or `RESPONSE_INTERRUPTED` when `runs.get` or `runs.observation` lost a successful body.
 */
export class GraphGoblinApiError extends Error {
  override readonly name = 'GraphGoblinApiError';
  readonly status: number;
  readonly code: string;
  readonly detail: string | undefined;
  readonly errors: unknown;
  /** The parsed problem document, when the server sent one. */
  readonly problem: ProblemDetails | undefined;

  /**
   * @param problem the problem details (server-sent or synthesised)
   * @param options `cause` for chaining; `serverSent: false` when the details were synthesised
   *   client-side, which leaves {@link problem} undefined.
   */
  constructor(problem: ProblemDetails, options: { cause?: unknown; serverSent?: boolean } = {}) {
    super(
      problem.detail ? `${problem.code}: ${problem.detail}` : `${problem.code} (${problem.status})`,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.status = problem.status;
    this.code = problem.code;
    this.detail = problem.detail;
    this.errors = problem.errors;
    this.problem = options.serverSent === false ? undefined : problem;
  }

  /** Build from a non-2xx response and its already-read body (JSON-parsed when possible). */
  static fromResponse(response: Response, body: unknown): GraphGoblinApiError {
    if (isProblemDetails(body)) return new GraphGoblinApiError(body);
    const text = typeof body === 'string' ? body.trim() : '';
    const detail = text ? text.slice(0, 500) : response.statusText;
    return new GraphGoblinApiError(
      { status: response.status, code: `HTTP_${response.status}`, ...(detail ? { detail } : {}) },
      { serverSent: false },
    );
  }

  /** Wrap a transport failure thrown by `fetch` before any response headers arrived. */
  static network(cause: unknown): GraphGoblinApiError {
    return new GraphGoblinApiError(
      { status: NETWORK_ERROR_STATUS, code: 'NETWORK_ERROR', detail: describeCause(cause) },
      { cause, serverSent: false },
    );
  }

  /**
   * Wrap the native read failure of a successful GET body that ended before it was complete. The
   * 2xx headers arrived but no usable answer did, so `status` is 0 like {@link network}; the
   * distinct code says where it failed and `cause` is the original native error.
   */
  static interrupted(cause: unknown): GraphGoblinApiError {
    return new GraphGoblinApiError(
      { status: NETWORK_ERROR_STATUS, code: 'RESPONSE_INTERRUPTED', detail: describeCause(cause) },
      { cause, serverSent: false },
    );
  }
}

/** The shape of every openapi-fetch result. */
export interface FetchResult<D> {
  data?: D;
  error?: unknown;
  response: Response;
}

/**
 * Turn an openapi-fetch result into its data, or throw a {@link GraphGoblinApiError}.
 * A 204 resolves to `undefined`.
 */
export function unwrap<D>(result: FetchResult<D>): D {
  if (!result.response.ok) throw GraphGoblinApiError.fromResponse(result.response, result.error);
  return result.data as D;
}
