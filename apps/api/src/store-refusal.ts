import { UnsupportedStoreError } from '@graphgoblin/infrastructure/sqlite';

/**
 * The reset entry point as typed from a checkout or from `/app` in the container image. The
 * refusal prints the dry run (no `--yes`), which lists what a reset would remove and changes
 * nothing (docs/guide/08-offline-upgrade.md, "Reset and fresh start").
 */
export const RESET_COMMAND = 'node apps/api/dist/main.js --reset';

/** `--data-dir "<path>"`, quoted so a path with spaces can be pasted into a shell as it is. */
export const dataDirArgument = (dataDir: string): string => `--data-dir "${dataDir}"`;

export interface StoreRefusalFacts {
  dataDir: string;
  /** The database file, when the configured database is a local file. */
  databaseFile?: string;
  refusal: UnsupportedStoreError;
}

function found(refusal: UnsupportedStoreError): string {
  if (refusal.foundFormat === undefined) return 'no valid format marker';
  if (refusal.foundFormat === refusal.requiredFormat)
    return `format ${String(refusal.foundFormat)}, but the store is damaged or unfinished`;
  return `format ${String(refusal.foundFormat)}`;
}

/** The startup refusal: where, what was found, what this build needs, and the explicit way out. */
export function describeStoreRefusal({
  dataDir,
  databaseFile,
  refusal,
}: StoreRefusalFacts): string {
  const damaged = refusal.foundFormat === refusal.requiredFormat;
  return [
    `GraphGoblin did not start: this build cannot open the store in data directory ${dataDir}.`,
    `  Database: ${databaseFile ?? '(GG_DB_URL is not a local file)'}`,
    `  Found:    ${found(refusal)}`,
    `  Requires: format ${String(refusal.requiredFormat)}`,
    `  Reason:   ${refusal.reason}`,
    'Nothing was changed. This build does not convert stores from other formats.',
    damaged
      ? 'Repair the store by hand, or start fresh: stop every GraphGoblin process using the data directory, then list what a reset would remove (this removes nothing):'
      : 'To keep that data, run the GraphGoblin build that wrote it. To start fresh, stop every GraphGoblin process using the data directory, then list what a reset would remove (this removes nothing):',
    `  ${RESET_COMMAND} ${dataDirArgument(dataDir)}`,
  ].join('\n');
}

/** Startup refused an unsupported store. Its message is the complete operator explanation. */
export class StoreRefusedError extends Error {
  readonly code = 'STORE_UNSUPPORTED';
  readonly refusal: UnsupportedStoreError;
  constructor(facts: StoreRefusalFacts) {
    super(describeStoreRefusal(facts));
    this.name = 'StoreRefusedError';
    this.refusal = facts.refusal;
  }
}

/** Rethrow a store-format refusal as the operator explanation; other failures pass through. */
export function explainStoreRefusal(facts: Omit<StoreRefusalFacts, 'refusal'>) {
  return (error: unknown): never => {
    if (error instanceof UnsupportedStoreError)
      throw new StoreRefusedError({ ...facts, refusal: error });
    throw error;
  };
}
