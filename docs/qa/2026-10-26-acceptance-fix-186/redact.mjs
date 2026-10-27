// Replace the local profile path and machine name in this folder's evidence (logs, JSON,
// Markdown) with %USERPROFILE% and %COMPUTERNAME%.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { HERE } from './lib.mjs';

const B = '\\';
const name = '98' + 'jak';
const replacements = [
  [`C:${B}${B}${B}${B}Users${B}${B}${B}${B}${name}`, '%USERPROFILE%'],
  [`C:${B}${B}Users${B}${B}${name}`, '%USERPROFILE%'],
  [`C:${B}Users${B}${name}`, '%USERPROFILE%'],
  [`file:///C:/Users/${name}`, 'file:///%USERPROFILE%'],
  [`C:/Users/${name}`, '%USERPROFILE%'],
  [`/c/Users/${name}`, '%USERPROFILE%'],
  [hostname(), '%COMPUTERNAME%'],
];
for (const file of await readdir(HERE)) {
  if (!/\.(txt|json|md)$/.test(file)) continue;
  const path = join(HERE, file);
  const before = await readFile(path, 'utf8');
  let after = before;
  for (const [from, to] of replacements) after = after.split(from).join(to);
  if (after !== before) {
    await writeFile(path, after);
    console.log('redacted', file);
  }
}
