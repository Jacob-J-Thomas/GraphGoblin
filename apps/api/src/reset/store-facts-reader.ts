// Child-process entry for `readStoreFacts`: read one database copy, print its facts as JSON and
// exit, so the process exit releases every native SQLite handle.
import { readStoreFactsFromFile } from './store-facts.js';

const file = process.argv[2];
process.stdout.write(
  JSON.stringify(
    file === undefined
      ? { readable: false, reason: 'no database path was given' }
      : await readStoreFactsFromFile(file),
  ),
);
