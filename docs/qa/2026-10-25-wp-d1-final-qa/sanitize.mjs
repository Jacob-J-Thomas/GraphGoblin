// Replace the local user profile path with %USERPROFILE% in every kept text output here.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { qaDir } from './lib.mjs';

const profile = homedir(); // e.g. C:\Users\name
const forward = profile.replaceAll('\\', '/');
const variants = new Set([
  profile.replaceAll('\\', '\\\\'), // JSON-escaped
  profile,
  forward,
  forward.replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`),
  encodeURIComponent(profile),
]);
const all = [...variants].flatMap((v) => [v, v.toLowerCase()]).sort((a, b) => b.length - a.length);
const changed = [];
for (const name of readdirSync(qaDir)) {
  if (!/\.(txt|json|md)$/.test(name)) continue;
  const path = `${qaDir}/${name}`;
  const before = readFileSync(path, 'utf8');
  let after = before;
  for (const v of all) after = after.split(v).join('%USERPROFILE%');
  if (after !== before) {
    writeFileSync(path, after);
    changed.push(name);
  }
}
console.log(JSON.stringify({ changed }));
