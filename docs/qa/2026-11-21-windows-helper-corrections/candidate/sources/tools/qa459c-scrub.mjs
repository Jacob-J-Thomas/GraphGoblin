// QA459C public scrubber for text or JSON records. Not product code. Never overwrites.
// node qa459c-scrub.mjs <input> <output> --scratch <dir> --checkout <dir> --out <dir> --baseline <dir>
// Replaces the scratch, checkout, output, baseline and home roots (backslash, escaped-backslash and
// forward-slash forms, case-insensitive) with placeholders and the account name with <user>.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import process from 'node:process';

const [input, output] = process.argv.slice(2);
const option = (name) => process.argv[process.argv.indexOf(name) + 1];
if (existsSync(output)) throw new Error('output exists; never overwritten');
const roots = [
  [option('--scratch'), '<scratch>'],
  [option('--checkout'), '<checkout>'],
  [option('--out'), '<out>'],
  [option('--baseline'), '<baseline>'],
  [homedir(), '<home>'],
];
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let text = readFileSync(input, 'utf8');
for (const [path, token] of roots) {
  const back = path.replace(/\//g, '\\');
  for (const form of [back.replace(/\\/g, '\\\\'), back, path.replace(/\\/g, '/')]) text = text.replace(new RegExp(escapeRegExp(form), 'gi'), token);
}
text = text.replace(new RegExp(escapeRegExp(userInfo().username), 'gi'), '<user>');
writeFileSync(output, text);
