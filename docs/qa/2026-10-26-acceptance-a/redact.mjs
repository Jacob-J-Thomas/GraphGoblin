// Redact the local profile path and machine name from the text evidence in this folder (D-030).
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import process from 'node:process';

const dir = dirname(fileURLToPath(import.meta.url));
const profile = os.homedir();
const machine = os.hostname();
const forms = new Set([
  profile,
  profile.replaceAll('\\', '/'),
  profile.replaceAll('\\', '\\\\'),
  '/' + profile.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, d) => d.toLowerCase()),
]);
let changed = 0;
for (const name of await readdir(dir)) {
  if (!/\.(txt|json|mjs|md|cs)$/.test(name) || name === 'redact.mjs') continue;
  const path = join(dir, name);
  let text = await readFile(path, 'utf8');
  const before = text;
  for (const form of forms) text = text.split(form).join('%USERPROFILE%');
  text = text.replace(new RegExp(machine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '%COMPUTERNAME%');
  text = text.replace(/S-1-5-21-\d+-\d+-\d+-\d+/g, '<SID>');
  if (text !== before) {
    await writeFile(path, text);
    changed += 1;
    console.log('redacted ' + name);
  }
}
console.log(`${changed} files redacted`);
process.exitCode = 0;
