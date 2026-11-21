// Manifest, preserve raw probe files, then remove ONLY the owned scratch subtree
// G:\ggq\qa-scratch\i4-363-marker-qa after realpath and no-reparse-point checks.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'G:\\ggq\\qa-scratch\\i4-363-marker-qa';
const PARENT = path.dirname(ROOT);
const E = 'C:\\Users\\98jak\\graphgoblin-qa\\2026-11-17-five-intents\\i4-363-marker-independent-01';
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const real = fs.realpathSync.native(ROOT);
if (real.toLowerCase() !== ROOT.toLowerCase()) throw new Error(`Scratch realpath mismatch: ${real}`);
const top = fs.readdirSync(ROOT).sort();
if (JSON.stringify(top) !== JSON.stringify(['run-01', 'vitest-01'])) throw new Error(`Unexpected top: ${top}`);
const entries = [];
const reparse = [];
const visit = (dir) => {
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const s = fs.lstatSync(full);
    const rel = path.relative(ROOT, full);
    if (s.isSymbolicLink()) {
      reparse.push(rel);
      entries.push({ rel, type: 'reparse' });
    } else if (s.isDirectory()) {
      entries.push({ rel, type: 'dir' });
      visit(full);
    } else entries.push({ rel, type: 'file', size: s.size, sha256: sha256(fs.readFileSync(full)) });
  }
};
visit(ROOT);
const parentBefore = fs.readdirSync(PARENT).sort();
const manifest = { utc: new Date().toISOString(), root: ROOT, realpath: real, top, entryCount: entries.length, reparse, parentBefore, entries };
if (reparse.length) {
  fs.writeFileSync(path.join(E, 'scratch-manifest-final.json'), JSON.stringify({ ...manifest, removed: false }, null, 2) + '\n', { flag: 'wx' });
  throw new Error(`Reparse points present; not removing: ${reparse}`);
}
const rawOut = path.join(E, 'run-01-probe-raw');
fs.mkdirSync(rawOut);
const probeDir = path.join(ROOT, 'run-01', 'probe');
for (const name of fs.readdirSync(probeDir).sort())
  fs.copyFileSync(path.join(probeDir, name), path.join(rawOut, name), fs.constants.COPYFILE_EXCL);
fs.rmSync(ROOT, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 });
const parentAfter = fs.readdirSync(PARENT).sort();
const removed = !fs.existsSync(ROOT);
const othersUntouched =
  JSON.stringify(parentAfter) === JSON.stringify(parentBefore.filter((n) => n !== path.basename(ROOT)));
fs.writeFileSync(
  path.join(E, 'scratch-manifest-final.json'),
  JSON.stringify({ ...manifest, removed, parentAfter, othersUntouched }, null, 2) + '\n',
  { flag: 'wx' },
);
process.stdout.write(JSON.stringify({ entryCount: entries.length, files: entries.filter((e) => e.type === 'file').length, removed, othersUntouched, parentBefore, parentAfter }) + '\n');
if (!removed || !othersUntouched) process.exitCode = 1;
