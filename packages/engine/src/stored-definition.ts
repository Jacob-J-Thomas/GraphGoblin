import type { LoopVersionRecord } from '@graphgoblin/contracts';
import { retiredEventDestinations } from '@graphgoblin/domain';
import { LoopUpgradeRequiredError } from './errors.js';

type StoredVersion = Pick<LoopVersionRecord, 'id' | 'loopId' | 'version' | 'status' | 'definition'>;

/**
 * Why a stored definition must be refused before it is served or executed, or undefined when it
 * is current. An exit that publishes an Event (retired by ADR-0044) would otherwise run to its exit
 * and then fail to record that delivery. The error names the loop, the version and every such
 * destination, and how to repair or remove them.
 */
export function definitionUpgradeRequired(
  version: StoredVersion,
): LoopUpgradeRequiredError | undefined {
  const paths = retiredEventDestinations(version.definition);
  if (paths.length === 0) return undefined;
  const which =
    version.status === 'snapshot'
      ? `the draft-run snapshot ${version.id} of version ${version.version}`
      : `${version.status} version ${version.version} (${version.id})`;
  return new LoopUpgradeRequiredError(
    version.loopId,
    version.id,
    version.version,
    paths,
    `Loop ${version.loopId}: ${which} has an exit that publishes an Event at ${paths.join(', ')}. ` +
      'Event destinations were retired (ADR-0044) and this definition cannot be served or run. ' +
      'Replace each such destination with a Subloop call to the receiving loop and publish a new version. ' +
      'A published version or draft that still holds one can be repaired by removing the destination ' +
      'from its stored JSON by hand with GraphGoblin stopped. A draft-run snapshot cannot be edited, ' +
      `even then: delete the loop (DELETE /loops/${version.loopId}, once its runs are terminal, removes ` +
      'its runs and snapshots) or reset the store.',
  );
}

/** Throw `LoopUpgradeRequiredError` for a stored definition the current contract refuses. */
export function assertCurrentDefinition(version: StoredVersion): void {
  const refused = definitionUpgradeRequired(version);
  if (refused) throw refused;
}
