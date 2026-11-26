// Diagnostic companion: real private-copy store reads (gg-reset-store-* directories in the shared
// TEMP) for <seconds>, as reset.test.ts does in parallel with the sidecar tests.
// Run from apps/api: node --import tsx --conditions=development <this> <seconds> <databaseFile>
import { pathToFileURL } from 'node:url';

const { readStoreFacts } = (await import(
  pathToFileURL('G:/ggq/gg-fu-538/GraphGoblin/apps/api/src/reset/store-facts.ts').href
)) as typeof import('G:/ggq/gg-fu-538/GraphGoblin/apps/api/src/reset/store-facts.ts');
const { READER_ARGUMENTS } = (await import(
  pathToFileURL('G:/ggq/gg-fu-538/GraphGoblin/apps/api/src/reset/__fixtures__/stores.ts').href
)) as typeof import('G:/ggq/gg-fu-538/GraphGoblin/apps/api/src/reset/__fixtures__/stores.ts');

const [seconds = '60', database] = process.argv.slice(2);
if (!database) throw new Error('usage: diag-reader-churn.ts <seconds> <databaseFile>');
const until = Date.now() + Number(seconds) * 1000;
let reads = 0;
const outcomes: Record<string, number> = {};
while (Date.now() < until) {
  const facts = await readStoreFacts(database, { readerArguments: READER_ARGUMENTS });
  reads += 1;
  const key = facts.readable ? 'readable' : `unreadable: ${facts.reason.slice(0, 80)}`;
  outcomes[key] = (outcomes[key] ?? 0) + 1;
}
process.stdout.write(JSON.stringify({ reads, outcomes }) + '\n');
