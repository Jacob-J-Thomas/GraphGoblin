// QA459C public-subset leak scan. Not product code. Read-only.
// node qa459c-scan-public.mjs <publicDir> --scratch <dir> --checkout <dir> --out <dir> --baseline <dir>
// Reports every file containing an unscrubbed private root (any slash form, case-insensitive), the
// home directory or the account name. The two frozen extension drivers carry the account name only
// as a literal scrub pattern; those occurrences are reported separately as expected.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join, relative } from 'node:path';
import process from 'node:process';

const directory = process.argv[2];
const option = (name) => process.argv[process.argv.indexOf(name) + 1];
const needles = [option('--scratch'), option('--checkout'), option('--out'), option('--baseline'), homedir()]
  .flatMap((path) => [path.replace(/\//g, '\\'), path.replace(/\\/g, '/'), path.replace(/\//g, '\\').replace(/\\/g, '\\\\')])
  .map((text) => text.toLowerCase());
const user = userInfo().username.toLowerCase();
const SCRUB_PATTERN_FILES = ['sources/f4/v1/qa459t-f4.mjs', 'sources/native/v1/qa459n-native.mjs'];
const findings = [];
const expected = [];
const walk = (path) => {
  for (const entry of readdirSync(path)) {
    const full = join(path, entry);
    if (statSync(full).isDirectory()) walk(full);
    else {
      const rel = relative(directory, full).replace(/\\/g, '/');
      const text = readFileSync(full, 'utf8').toLowerCase();
      const roots = needles.filter((needle) => text.includes(needle));
      const userHits = text.split(user).length - 1;
      if (roots.length) findings.push({ file: rel, kind: 'private-root', roots: [...new Set(roots)].length });
      if (userHits) {
        const patternOnly = SCRUB_PATTERN_FILES.includes(rel) && text.split(`/${user}/gi`).length - 1 === userHits;
        (patternOnly ? expected : findings).push({ file: rel, kind: patternOnly ? 'literal scrub pattern only' : 'account-name', occurrences: userHits });
      }
    }
  }
};
walk(directory);
console.log(JSON.stringify({ findings, expected }, null, 1));
process.exit(findings.length === 0 ? 0 : 1);
