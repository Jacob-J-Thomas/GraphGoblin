import { ClassifierChoiceResponseSchema, ClassifierEndpointSchema } from '@graphgoblin/contracts';
import type { ClassifierPort, ChoiceRequest, ChoiceResult } from '@graphgoblin/engine';
import type { FetchLike } from './probes.js';

/** Fixed diagnostics intentionally omit provider bodies, headers, URLs, and transport messages. */
export class HttpClassifierError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'HttpClassifierError';
  }
}

export interface HttpClassifierOptions {
  endpoint: string;
  providerModel: string;
  /** Resolved snapshot. Omit for an unauthenticated endpoint. */
  bearer?: string;
  timeoutMs?: number;
  fetch?: FetchLike;
}

export class HttpChoiceClassifier implements ClassifierPort {
  private readonly url: string;
  constructor(private readonly options: HttpClassifierOptions) {
    this.url = `${ClassifierEndpointSchema.parse(options.endpoint).replace(/\/+$/, '')}/v1/systemone`;
  }

  async choose(request: ChoiceRequest, signal: AbortSignal): Promise<ChoiceResult> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 10_000);
    const combined = AbortSignal.any([signal, timeout]);
    let body: unknown;
    try {
      const response = await (this.options.fetch ?? fetch)(this.url, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/json',
          ...(this.options.bearer !== undefined
            ? { Authorization: `Bearer ${this.options.bearer}` }
            : {}),
        },
        signal: combined,
        body: JSON.stringify({
          model: this.options.providerModel,
          state: request.context,
          questions: {
            answer: {
              type: 'choice',
              instructions: request.question,
              criteria: Object.fromEntries(
                request.options.map((option) => [option.label, option.description]),
              ),
            },
          },
        }),
      });
      if (!response.ok) {
        const redirect = response.status >= 300 && response.status < 400;
        const code = redirect
          ? 'DECIDER_REDIRECT'
          : response.status === 401 || response.status === 403
            ? 'DECIDER_NOT_AUTHENTICATED'
            : response.status === 429
              ? 'DECIDER_RATE_LIMITED'
              : 'DECIDER_HTTP_ERROR';
        // Release the response without retaining an untrusted error body that may echo a key.
        await response.body?.cancel();
        throw new HttpClassifierError(
          code,
          redirect
            ? 'Classifier redirects are not followed'
            : `Classifier request failed (HTTP ${response.status})`,
          response.status,
        );
      }
      try {
        body = await response.json();
      } catch {
        if (combined.aborted) throw new DOMException('Classifier request aborted', 'AbortError');
        throw new HttpClassifierError(
          'DECIDER_INVALID_RESPONSE',
          'Classifier returned malformed JSON',
        );
      }
    } catch (error) {
      if (signal.aborted) throw new DOMException('Classifier request aborted', 'AbortError');
      if (timeout.aborted)
        throw new HttpClassifierError('DECIDER_TIMEOUT', 'Classifier request timed out');
      if (error instanceof HttpClassifierError) throw error;
      throw new HttpClassifierError('DECIDER_UNREACHABLE', 'Classifier endpoint is unreachable');
    }
    const parsed = ClassifierChoiceResponseSchema.safeParse(body);
    if (!parsed.success)
      throw new HttpClassifierError(
        'DECIDER_INVALID_RESPONSE',
        'Classifier returned an invalid Choice response',
      );
    const { choice, confidence, probabilities } = parsed.data.answers.answer;
    const labels = new Set(request.options.map((option) => option.label));
    if (
      Object.keys(probabilities).length !== labels.size ||
      [...labels].some((label) => !Object.hasOwn(probabilities, label))
    ) {
      throw new HttpClassifierError(
        'DECIDER_INVALID_RESPONSE',
        'Classifier probabilities must cover exactly the submitted labels',
      );
    }
    if (!labels.has(choice)) {
      throw new HttpClassifierError(
        'DECIDER_INVALID_RESPONSE',
        'Classifier choice must be one of the submitted labels',
      );
    }
    return {
      label: choice,
      // Exact label coverage and choice membership above guarantee a selected probability.
      confidence: confidence ?? probabilities[choice]!,
      alternatives: Object.entries(probabilities)
        .filter(([label]) => label !== choice)
        .sort((a, b) => b[1] - a[1])
        .map(([label, probability]) => ({ label, confidence: probability })),
    };
  }
}
