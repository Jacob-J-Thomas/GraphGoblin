import type { HarnessId, HarnessPreflight } from '@graphgoblin/contracts';
import { readinessFailure } from '@graphgoblin/domain';
import type { HarnessPort } from '@graphgoblin/engine';

/** A request/operation owns this memo, including rejected probes. Never retain it on a container. */
export function readinessOperation(harnesses: Partial<Record<HarnessId, HarnessPort>>) {
  const probes = new Map<HarnessId, Promise<HarnessPreflight>>();
  return {
    probe(harness: HarnessId): Promise<HarnessPreflight> {
      let result = probes.get(harness);
      if (!result) {
        result = Promise.resolve()
          .then(() => harnesses[harness]?.preflight() ?? readinessFailure(harness, 'cli-missing'))
          .catch(() => readinessFailure(harness, 'unknown'));
        probes.set(harness, result);
      }
      return result;
    },
  };
}
export type ReadinessOperation = ReturnType<typeof readinessOperation>;
