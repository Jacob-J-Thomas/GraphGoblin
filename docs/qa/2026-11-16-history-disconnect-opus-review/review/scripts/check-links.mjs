// Offline, read-only: resolve relative Markdown links in the listed files against the clean checkout.
// Usage: node check-links.mjs <repo root> <file> [file...]
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const [root, ...files] = process.argv.slice(2);
for (const file of files) {
  const text = readFileSync(resolve(root, file), 'utf8');
  const links = [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]);
  let local = 0;
  const missing = [];
  for (const link of links) {
    if (/^[a-z]+:/i.test(link) || link.startsWith('#')) continue;
    local++;
    const target = decodeURIComponent(link.split('#')[0]);
    if (!existsSync(resolve(root, dirname(file), target))) missing.push(link);
  }
  console.log(`${file} local-links=${local} missing=${missing.length}${missing.length ? ' ' + JSON.stringify(missing) : ''}`);
}
