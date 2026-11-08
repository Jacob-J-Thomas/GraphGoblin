import { ModelNameSchema, type Effort, type OllamaConnection } from '@graphgoblin/contracts';
import { OllamaError, object, requestJson, type OllamaFetch } from './http.js';
import { contextProfile, contextRuntimeVersion, OLLAMA_CONTEXT_PROFILE } from './context.js';
import type { OllamaDiscoveredModel } from './types.js';

const NAMED_EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
/** No-thinking models omit think; thinking controls must be explicitly established by metadata. */
export function discoveredModel(
  model: string,
  digest: string,
  connectionRevision: number,
  at: string,
  detail: unknown,
): OllamaDiscoveredModel {
  if (
    !object(detail) ||
    !Array.isArray(detail.capabilities) ||
    !detail.capabilities.every((entry) => typeof entry === 'string')
  )
    throw new OllamaError(
      'OLLAMA_DISCOVERY_INVALID',
      'Ollama model capability metadata is invalid',
    );
  const thinkingByEffort: OllamaDiscoveredModel['thinkingByEffort'] = {};
  const completion = detail.capabilities.includes('completion');
  const thinking = detail.capabilities.includes('thinking');
  const metadata = object(detail.thinking) ? detail.thinking : undefined;
  const values = metadata && Array.isArray(metadata.values) ? metadata.values : [];
  const efforts: Effort[] = [];
  if (!thinking) efforts.push('none');
  else {
    const qwen35 = object(detail.details) && detail.details.family === 'qwen35';
    const qwenRenderer = detail.renderer === 'qwen3.5';
    // Ollama's Qwen3.5 renderer supports an explicit false control even on older show metadata.
    const qwenFalse =
      (detail.thinking === undefined || detail.thinking === null) && (qwen35 || qwenRenderer);
    if (values.includes(false) || qwenFalse) {
      efforts.push('none');
      thinkingByEffort.none = false;
    }
    for (const effort of NAMED_EFFORTS)
      if (values.includes(effort)) {
        efforts.push(effort);
        thinkingByEffort[effort] = effort;
      }
  }
  const reason = !completion
    ? 'This model does not advertise text completion capability'
    : efforts.length === 0
      ? 'Thinking model does not advertise a supported explicit thinking control'
      : undefined;
  const defaultEffort = efforts.includes('none')
    ? 'none'
    : (efforts.find((effort) => effort === metadata?.default) ?? efforts[0] ?? 'none');
  return {
    model,
    digest,
    connectionRevision,
    displayName: model,
    efforts,
    defaultEffort,
    enabled: true,
    thinkingByEffort,
    availability: {
      state: reason ? 'unsupported' : 'available',
      checkedAt: at,
      ...(reason ? { reason } : {}),
    },
  };
}
export async function discoverOllama(options: {
  connection: OllamaConnection;
  cached: OllamaDiscoveredModel[];
  at: string;
  signal: AbortSignal;
  fetcher: OllamaFetch;
}): Promise<OllamaDiscoveredModel[]> {
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal, AbortSignal.timeout(30_000)]);
  const tags = await requestJson(options.fetcher, options.connection.baseUrl, '/api/tags', signal);
  if (!object(tags) || !Array.isArray(tags.models) || tags.models.length > 256)
    throw new OllamaError(
      'OLLAMA_DISCOVERY_INVALID',
      'Ollama model list is invalid or exceeds the 256-model discovery limit',
    );
  const identities = tags.models.map((entry: unknown) => {
    if (
      !object(entry) ||
      !ModelNameSchema.safeParse(entry.model).success ||
      typeof entry.digest !== 'string' ||
      !entry.digest.length ||
      entry.digest.length > 256
    )
      throw new OllamaError(
        'OLLAMA_DISCOVERY_INVALID',
        'Ollama model identity metadata is invalid',
      );
    return { model: entry.model as string, digest: entry.digest };
  });
  if (new Set(identities.map((entry) => entry.model)).size !== identities.length)
    throw new OllamaError(
      'OLLAMA_DISCOVERY_INVALID',
      'Ollama model list contains duplicate identities',
    );
  if (identities.length === 0) return [];
  const version = await requestJson(
    options.fetcher,
    options.connection.baseUrl,
    '/api/version',
    signal,
  );
  let supportedRuntime = false;
  try {
    contextRuntimeVersion(version);
    supportedRuntime = true;
  } catch (error) {
    if (!(error instanceof OllamaError) || error.code !== 'HARNESS_CONTEXT_UNSUPPORTED')
      throw error;
  }
  const results: OllamaDiscoveredModel[] = [];
  let next = 0;
  try {
    await Promise.all(
      Array.from({ length: Math.min(4, identities.length) }, async () => {
        while (next < identities.length) {
          const identity = identities[next++];
          if (!identity) break;
          const cached = options.cached.find(
            (entry) =>
              entry.model === identity.model &&
              entry.digest === identity.digest &&
              entry.connectionRevision === options.connection.revision &&
              entry.availability.state !== 'missing' &&
              entry.contextProfile === OLLAMA_CONTEXT_PROFILE &&
              supportedRuntime,
          );
          if (cached)
            results.push({
              ...cached,
              availability: { ...cached.availability, checkedAt: options.at },
            });
          else {
            const detail = await requestJson(
              options.fetcher,
              options.connection.baseUrl,
              '/api/show',
              signal,
              { model: identity.model },
            );
            const entry = discoveredModel(
              identity.model,
              identity.digest,
              options.connection.revision,
              options.at,
              detail,
            );
            let reason: string | undefined;
            let qualified: string | undefined;
            try {
              qualified = contextProfile(detail, version).profile;
              if (!entry.efforts.includes('none'))
                reason =
                  'This supported context profile requires explicit no-thinking mode. Named thinking modes need a separately qualified context profile.';
            } catch (error) {
              if (!(error instanceof OllamaError) || error.code !== 'HARNESS_CONTEXT_UNSUPPORTED')
                throw error;
              reason = error.message;
            }
            const supportsNone = entry.efforts.includes('none');
            results.push({
              ...entry,
              efforts: qualified && supportsNone ? ['none'] : [],
              defaultEffort: 'none',
              thinkingByEffort:
                qualified && supportsNone && entry.thinkingByEffort.none !== undefined
                  ? { none: entry.thinkingByEffort.none }
                  : {},
              ...(qualified ? { contextProfile: qualified } : {}),
              availability:
                entry.availability.state === 'available' && reason
                  ? { state: 'unsupported', checkedAt: options.at, reason }
                  : entry.availability,
            });
          }
        }
      }),
    );
  } catch (error) {
    controller.abort();
    throw error;
  }
  return results.sort((a, b) => a.model.localeCompare(b.model));
}
