import { realpathSync, appendFileSync } from 'node:fs';

const entry = process.argv[1];
if (entry && /[\\/](gen-docs|check-migrations|summary)\.mjs$/u.test(entry)) {
  appendFileSync(process.env.GG_495_PATH_LOG, JSON.stringify({
    cwd: process.cwd(),
    entry,
    entryRealPath: realpathSync.native(entry),
    args: process.argv.slice(2),
    node: process.version,
  }) + '\n');
}
