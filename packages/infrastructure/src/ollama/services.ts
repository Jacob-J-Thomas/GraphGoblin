import {
  OllamaConnectionUpdateSchema,
  type OllamaConnectionUpdate,
  type OllamaDiscoveryStatus,
} from '@graphgoblin/contracts';
import type { ClockPort, Logger } from '@graphgoblin/engine';
import { discoverOllama } from './discovery.js';
import { OllamaHarness } from './harness.js';
import { OllamaError, type OllamaFetch } from './http.js';
import {
  OLLAMA_OFF_REASON,
  OLLAMA_UNLISTED_REASON,
  type OllamaRepository,
  type OllamaServices,
} from './types.js';

export function createOllamaServices(options: {
  repository: OllamaRepository;
  clock: ClockPort;
  logger: Logger;
  defaults: OllamaConnectionUpdate;
  fetcher?: OllamaFetch;
}): OllamaServices {
  const defaults = canonical(options.defaults);
  const fetcher = options.fetcher ?? fetch;
  const repository = options.repository;
  let observedRevision = 0;
  let observedEnabled = defaults.enabled;
  let ownerDisable = new AbortController();
  const view = async () => {
    const current = await repository.read(defaults);
    if (current.connection.revision >= observedRevision) {
      observedRevision = current.connection.revision;
      observedEnabled = current.connection.enabled;
      if (!observedEnabled) ownerDisable.abort();
      else if (ownerDisable.signal.aborted) ownerDisable = new AbortController();
    }
    return current;
  };
  let started = false;
  let epoch = 0;
  let startup: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let inFlight:
    | { revision: number; controller: AbortController; promise: Promise<OllamaDiscoveryStatus> }
    | undefined;
  const clearTimer = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
  const schedule = () => {
    clearTimer();
    if (started) {
      timer = setInterval(() => {
        void refresh().catch(logFailure);
      }, 5 * 60_000);
      timer.unref();
    }
  };
  const logFailure = () =>
    options.logger.warn({}, 'Ollama discovery could not update its persisted status');
  async function refresh(): Promise<OllamaDiscoveryStatus> {
    const requestedEpoch = epoch;
    const current = await view();
    if (requestedEpoch !== epoch) return current.discovery;
    if (!current.connection.enabled) return current.discovery;
    if (inFlight?.revision === current.connection.revision) return inFlight.promise;
    const revision = current.connection.revision;
    const controller = new AbortController();
    const promise = (async () => {
      const at = options.clock.now().toISOString();
      if (!(await repository.markRefreshing(revision, at))) return (await view()).discovery;
      try {
        const models = await discoverOllama({
          connection: current.connection,
          cached: await repository.cached(revision),
          at,
          signal: AbortSignal.any([controller.signal, ownerDisable.signal]),
          fetcher,
        });
        if (!controller.signal.aborted)
          await repository.reconcile(revision, options.clock.now().toISOString(), models);
      } catch (error) {
        if (!controller.signal.aborted) {
          const safe =
            error instanceof OllamaError
              ? { code: error.code, message: error.message }
              : {
                  code: 'OLLAMA_DISCOVERY_FAILED',
                  message: 'Ollama discovery failed; the last complete model snapshot is retained',
                };
          await repository.fail(revision, at, safe);
        }
      }
      return (await view()).discovery;
    })();
    const active = { revision, controller, promise };
    inFlight = active;
    try {
      return await promise;
    } finally {
      if (inFlight === active) inFlight = undefined;
    }
  }
  const harness = new OllamaHarness({
    fetcher,
    guard: async (connection) => {
      const current = await view();
      const disabled = ownerDisable;
      const check = () => {
        if (!observedEnabled || disabled.signal.aborted)
          throw new OllamaError('HARNESS_INVALID_CONFIGURATION', OLLAMA_OFF_REASON);
        if (observedRevision !== connection.revision)
          throw new OllamaError('HARNESS_MODEL_UNAVAILABLE', OLLAMA_UNLISTED_REASON);
      };
      if (!current.connection.enabled)
        throw new OllamaError('HARNESS_INVALID_CONFIGURATION', OLLAMA_OFF_REASON);
      check();
      return { signal: disabled.signal, check };
    },
    snapshot: async () => {
      const current = await view();
      return {
        connection: current.connection,
        models: await repository.cached(current.connection.revision),
      };
    },
  });
  return {
    harness,
    view,
    refresh,
    async configure(input) {
      const saved = await repository.configure(canonical(input), options.clock.now().toISOString());
      observedRevision = saved.connection.revision;
      observedEnabled = saved.connection.enabled;
      if (!observedEnabled) ownerDisable.abort();
      else if (ownerDisable.signal.aborted) ownerDisable = new AbortController();
      inFlight?.controller.abort();
      clearTimer();
      if (saved.connection.enabled) {
        schedule();
        await refresh();
      }
      return view();
    },
    start() {
      if (started) return;
      started = true;
      startup = view()
        .then(async (current) => {
          if (!started || !current.connection.enabled) return;
          schedule();
          await refresh();
        })
        .catch(logFailure);
    },
    async stop() {
      epoch += 1;
      started = false;
      clearTimer();
      const active = inFlight;
      active?.controller.abort();
      await Promise.all([active?.promise.catch(() => undefined), startup]);
    },
  };
}
function canonical(input: OllamaConnectionUpdate): OllamaConnectionUpdate {
  const parsed = OllamaConnectionUpdateSchema.parse(input);
  return { enabled: parsed.enabled, baseUrl: new URL(parsed.baseUrl).origin };
}
