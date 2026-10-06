import type { JsonValue } from '@graphgoblin/contracts';
import type { PredicateAnswer } from '@graphgoblin/domain';
import {
  describeError,
  type ChoiceRequest,
  type ChoiceResult,
  type DeciderPort,
  type Logger,
  type SecretsPort,
  type YesNoRequest,
} from '@graphgoblin/engine';
import {
  APIConnectionError,
  APIError,
  APIUserAbortError,
  TypeSafeClient,
  choice,
  noul,
  type EntryType,
  type Fetch,
  type RetryPolicy,
} from '@typesafe-ai/sdk';
import { z } from 'zod';

/**
 * `DeciderPort` (`id: 'jev'`) over TypeSafe's hosted Jev model through `@typesafe-ai/sdk`
 * (MIT, no dependencies). Both primitives go through `POST /v1/systemone`:
 *
 * - `choose` asks one `choice` question whose criteria are the route labels and descriptions, and
 *   returns the chosen label, its confidence, and every other label with its probability.
 * - `judge` asks one `noul` (yes/no) question; `noul` is the probability of yes.
 *
 * See docs/research/jev.md for the verified request and response shapes.
 */

export const DEFAULT_BASE_URL = 'https://api.typesafe.ai';
export const DEFAULT_MODEL = 'jev-latest';

export interface JevDeciderOptions {
  secrets: SecretsPort;
  /** Secret holding the API key. Default `jev-api-key`. */
  secretName?: string;
  /** Transport override for tests or proxies. Default: global `fetch`. */
  fetch?: Fetch;
  /** API root. Default `https://api.typesafe.ai`; never read from the environment. */
  baseUrl?: string;
  /** Jev model. Default `jev-latest`. */
  model?: string;
  /** Per-attempt timeout in milliseconds. Default 10 000 (the SDK default). */
  timeoutMs?: number;
  /** Retry overrides passed to the SDK. Default: the SDK's (2 retries on 408, 429, 5xx). */
  retry?: Partial<RetryPolicy>;
  logger?: Logger;
}

const ChoiceAnswerSchema = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
});

const NoulAnswerSchema = z.object({
  type: z.literal('noul'),
  noul: z.number().min(0).max(1),
});

const resultSchema = <T extends z.ZodType>(answer: T) =>
  z.object({ model: z.string().optional(), answers: z.object({ answer }) });

const ChoiceResultSchema = resultSchema(ChoiceAnswerSchema);
const NoulResultSchema = resultSchema(NoulAnswerSchema);

/** An error carrying a code the engine and logs can key off. */
export class JevError extends Error {
  constructor(
    readonly code:
      | 'DECIDER_UNAVAILABLE'
      | 'DECIDER_NOT_AUTHENTICATED'
      | 'DECIDER_RATE_LIMITED'
      | 'DECIDER_HTTP_ERROR'
      | 'DECIDER_UNREACHABLE'
      | 'DECIDER_INVALID_RESPONSE',
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'JevError';
  }
}

/** The SDK accepts text, JSON objects or arrays, or null as state; wrap scalars. */
function toState(context: JsonValue): EntryType {
  if (context === null || typeof context === 'string' || typeof context === 'object') {
    return context;
  }
  return { value: context };
}

function mapError(error: unknown): Error {
  if (error instanceof JevError) return error;
  if (error instanceof APIUserAbortError) {
    return new DOMException('The Jev request was aborted', 'AbortError');
  }
  if (error instanceof APIError) {
    if (error.status === 401 || error.status === 403) {
      return new JevError(
        'DECIDER_NOT_AUTHENTICATED',
        `Jev rejected the API key (${error.status})`,
        error.status,
      );
    }
    if (error.status === 429) {
      return new JevError('DECIDER_RATE_LIMITED', 'Jev rate limit exceeded', error.status);
    }
    return new JevError('DECIDER_HTTP_ERROR', `Jev request failed (${error.status})`, error.status);
  }
  if (error instanceof APIConnectionError) {
    return new JevError('DECIDER_UNREACHABLE', 'Jev is unreachable');
  }
  return new JevError('DECIDER_HTTP_ERROR', 'Jev request failed');
}

export class JevDecider implements DeciderPort {
  readonly id = 'jev' as const;
  private client: TypeSafeClient | undefined;
  private readonly ready: Promise<void>;

  /**
   * `available()` must be synchronous and cheap, but the key lives behind the async `SecretsPort`.
   * The decider therefore resolves the key once at construction (in the background) and caches a
   * client; `init()` awaits that first resolution, and `refresh()` re-reads the secret after it
   * changes. Until the first resolution finishes, `available()` is false and the engine falls
   * through to the next strategy, which is the correct behaviour for a missing key.
   */
  constructor(private readonly options: JevDeciderOptions) {
    this.ready = this.refresh().catch(() => undefined);
  }

  /** Wait for the key resolution started at construction. Never throws. */
  init(): Promise<void> {
    return this.ready;
  }

  /** Re-read the API key secret and rebuild the client; the decider is unavailable without one. */
  async refresh(): Promise<void> {
    let key: string | undefined;
    try {
      key = (await this.options.secrets.resolve(this.options.secretName ?? 'jev-api-key'))?.trim();
    } catch (error) {
      this.options.logger?.warn(
        { err: describeError(error) },
        'jev: could not read the API key secret',
      );
      key = undefined;
    }
    this.client = key ? this.createClient(key) : undefined;
  }

  available(): boolean {
    return this.client !== undefined;
  }

  private createClient(apiKey: string): TypeSafeClient {
    const logger = this.options.logger;
    return new TypeSafeClient({
      apiKey,
      baseURL: this.options.baseUrl ?? DEFAULT_BASE_URL,
      defaultModel: this.options.model ?? DEFAULT_MODEL,
      ...(this.options.timeoutMs !== undefined ? { timeout: this.options.timeoutMs } : {}),
      ...(this.options.retry ? { retry: this.options.retry } : {}),
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      // SDK messages can include response headers, bodies or transport text. Keep fixed summaries.
      logLevel: logger ? 'debug' : 'off',
      ...(logger
        ? {
            logger: {
              debug: () => logger.debug({}, 'jev: SDK debug event'),
              info: () => logger.debug({}, 'jev: SDK information event'),
              warn: () => logger.warn({}, 'jev: SDK warning'),
              error: () => logger.warn({}, 'jev: SDK error'),
            },
          }
        : {}),
    });
  }

  private requireClient(): TypeSafeClient {
    if (!this.client) {
      throw new JevError('DECIDER_UNAVAILABLE', 'Jev API key is unavailable');
    }
    return this.client;
  }

  async choose(request: ChoiceRequest, signal: AbortSignal): Promise<ChoiceResult> {
    const client = this.requireClient();
    const criteria = Object.fromEntries(request.options.map((o) => [o.label, o.description]));
    let body: unknown;
    try {
      body = await client.systemOne(
        {
          state: toState(request.context),
          questions: { answer: choice(request.question, criteria) },
        },
        { signal },
      );
    } catch (error) {
      throw mapError(error);
    }
    const parsed = ChoiceResultSchema.safeParse(body);
    if (!parsed.success) {
      throw new JevError('DECIDER_INVALID_RESPONSE', 'Unexpected Jev choice response');
    }
    const { choice: label, confidence, probabilities } = parsed.data.answers.answer;
    const labels = new Set(request.options.map((option) => option.label));
    const probabilityLabels = Object.keys(probabilities);
    if (
      probabilityLabels.length !== labels.size ||
      probabilityLabels.some((key) => !labels.has(key))
    ) {
      throw new JevError('DECIDER_INVALID_RESPONSE', 'Unexpected Jev choice response');
    }
    const alternatives = Object.entries(probabilities)
      .filter(([other]) => other !== label)
      .sort((a, b) => b[1] - a[1])
      .map(([other, p]) => ({ label: other, confidence: p }));
    return {
      label,
      confidence: confidence ?? probabilities[label] ?? 0,
      alternatives,
    };
  }

  async judge(request: YesNoRequest, signal: AbortSignal): Promise<PredicateAnswer> {
    const client = this.requireClient();
    let body: unknown;
    try {
      body = await client.systemOne(
        { state: toState(request.context), questions: { answer: noul(request.question) } },
        { signal },
      );
    } catch (error) {
      throw mapError(error);
    }
    const parsed = NoulResultSchema.safeParse(body);
    if (!parsed.success) {
      throw new JevError('DECIDER_INVALID_RESPONSE', 'Unexpected Jev yes/no response');
    }
    const yes = parsed.data.answers.answer.noul;
    const holds = yes >= 0.5;
    return { holds, confidence: holds ? yes : 1 - yes };
  }
}

export function createJevDecider(options: JevDeciderOptions): JevDecider {
  return new JevDecider(options);
}
