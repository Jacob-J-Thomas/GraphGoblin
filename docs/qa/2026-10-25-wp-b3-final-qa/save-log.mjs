// QA tooling: copy a captured command output into this folder as <name>.log.txt, with a header
// line and the local user profile path replaced by %USERPROFILE%.
// Usage: node save-log.mjs <captured-output> <name> <header text>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { QA_DIR, sanitize } from './lib.mjs';

const [source, name, ...header] = process.argv.slice(2);
writeFileSync(
  join(QA_DIR, `${name}.log.txt`),
  sanitize(`${header.join(' ')}\nNode ${process.version}\n\n${readFileSync(source, 'utf8')}`),
);
