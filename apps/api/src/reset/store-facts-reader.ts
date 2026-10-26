// Copy owner: keep cleanup alive independently of the reset CLI, and let a separate SQLite worker
// exit before deleting its private files (Windows native handles can survive client.close()).
import { readStoreCopy } from './store-copy.js';

const file = process.argv[2];
let result;
try {
  result =
    file === undefined
      ? { readable: false, reason: 'no database path was given' }
      : await readStoreCopy(file, Number(process.argv[3] ?? process.ppid));
} catch (error) {
  result = {
    copyFailure: `the reset reader could not clean its private copy: ${error instanceof Error ? error.message : String(error)}; check the named temporary directory before retrying`,
  };
}
process.stdout.write(JSON.stringify(result));
