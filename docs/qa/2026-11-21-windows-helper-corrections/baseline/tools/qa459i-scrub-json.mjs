// QA459I JSON scrubber for public projections. Not product code.
// node qa459i-scrub-json.mjs <input.json> <output.json> --scratch <dir> --checkout <dir> --out <dir>
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import process from 'node:process';

const [input, output] = process.argv.slice(2);
const option = (name) => process.argv[process.argv.indexOf(name) + 1];
if (existsSync(output)) throw new Error('output exists; never overwritten');
const roots = [[option('--scratch'), '<scratch>'], [option('--checkout'), '<checkout>'], [option('--out'), '<out>'], [homedir(), '<home>']];
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function scrub(value) {
  if (typeof value === 'string') {
    let text = value;
    for (const [path, token] of roots) {
      const back = path.replace(/\//g, '\\');
      for (const form of [back.replace(/\\/g, '\\\\'), back, path.replace(/\\/g, '/')]) text = text.replace(new RegExp(escapeRegExp(form), 'gi'), token);
    }
    return text.replace(new RegExp(escapeRegExp(userInfo().username), 'gi'), '<user>');
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]));
  return value;
}
writeFileSync(output, JSON.stringify(scrub(JSON.parse(readFileSync(input, 'utf8'))), null, 2) + '\n');
