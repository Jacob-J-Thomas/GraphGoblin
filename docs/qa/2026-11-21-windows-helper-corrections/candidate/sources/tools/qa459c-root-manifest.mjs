// QA459C root evidence manifest writer. Not product code. Never overwrites.
// node qa459c-root-manifest.mjs <outRoot>
// Writes <outRoot>/evidence-manifest.sha256: "<sha256>  <bytes>  <relative/path>" (LF, sorted) for
// every root file, setup/, tools/, the freeze records and the subtree manifests of f4/v1, native/v1,
// private and public (whose contents those manifests bind). The runner-owned provider-candidate/
// folder and the manifest itself are excluded.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.argv[2];
const target = join(root, 'evidence-manifest.sha256');
if (existsSync(target)) throw new Error('manifest exists; never overwritten');
const SUBTREES = ['f4/v1', 'native/v1', 'private', 'public'];
const files = [];
const walk = (path) => {
  for (const entry of readdirSync(path)) {
    const full = join(path, entry);
    const rel = relative(root, full).replace(/\\/g, '/');
    if (rel === 'provider-candidate' || rel === 'evidence-manifest.sha256') continue;
    if (statSync(full).isDirectory()) {
      if (SUBTREES.includes(rel)) files.push(join(full, 'MANIFEST.sha256'));
      else walk(full);
    } else files.push(full);
  }
};
walk(root);
const lines = files
  .map((full) => ({ full, rel: relative(root, full).replace(/\\/g, '/') }))
  .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  .map(({ full, rel }) => {
    const bytes = readFileSync(full);
    return `${createHash('sha256').update(bytes).digest('hex')}  ${bytes.length}  ${rel}`;
  });
const text = lines.join('\n') + '\n';
writeFileSync(target, text);
console.log(`${lines.length} entries; evidence-manifest sha256 ${createHash('sha256').update(text).digest('hex')}`);
