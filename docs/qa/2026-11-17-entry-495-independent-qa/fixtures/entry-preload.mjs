import { realpathSync } from 'node:fs';
if (process.argv[1]?.match(/(?:gen-docs|check-migrations|summary)\.mjs$/)) {
  console.error(JSON.stringify({
    receipt: 'qa-entry-spelling',
    cwd: process.cwd(),
    argv1: process.argv[1],
    realEntry: realpathSync(process.argv[1]),
  }));
}
