// GraphGoblin #459 independent native QA packaging: post-run filesystem inventories, a scrubbed
// public folder (the driver's scrub algorithm), private raw separation and a public leak scan.
// Usage: node package.mjs   (paths are fixed to this QA assignment)
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, relative } from 'node:path';

const QA = '<OUT>';
const SCRATCH = '<SCRATCH>';
const CHECKOUT = '<CHECKOUT>';
const MAIN = '<MAIN_CHECKOUT>';
const BASE_QA = '<BASELINE_QA>';
const PUBLIC = join(QA, 'public');
const PRIVATE = join(QA, 'private-raw');
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

// ---- the driver's scrub algorithm (qa459-driver.mjs `scrub`), with this assignment's roots
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const roots = [
  [QA, '<OUT>'], [SCRATCH, '<SCRATCH>'], [CHECKOUT, '<CHECKOUT>'], [MAIN, '<MAIN_CHECKOUT>'], [BASE_QA, '<BASELINE_QA>'],
  [dirname(process.execPath), '<NODE_DIR>'], [os.homedir(), '<HOME>'],
].sort((a, b) => b[0].length - a[0].length);
const patterns = roots.flatMap(([path, token]) => [path, path.replaceAll('\\', '/'), path.replaceAll('\\', '\\\\')].map((variant) => [new RegExp(escapeRegExp(variant), 'gi'), token]));
const username = os.userInfo().username;
function scrub(text) {
  let result = String(text);
  for (const [pattern, token] of patterns) result = result.replace(pattern, token);
  result = result.replace(/\b[A-Za-z]:(?:\\\\|\\|\/)[^\s"'<>|,;]*/g, '<ABS_PATH>');
  if (username.length >= 3) result = result.replace(new RegExp(escapeRegExp(username), 'gi'), '<USER>');
  return result;
}
const textual = (name) => /\.(json|md|txt|log|mjs|cs|ps1|diff|sha256)$/i.test(name);
function copyScrubbed(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  if (textual(source)) writeFileSync(target, scrub(readFileSync(source, 'utf8')));
  else copyFileSync(source, target);
}
function copyTreeScrubbed(source, target, skip = () => false, copy = copyScrubbed) {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    if (skip(from, entry)) continue;
    if (entry.isDirectory()) copyTreeScrubbed(from, join(target, entry.name), skip, copy);
    else copy(from, join(target, entry.name));
  }
}
/** Verbatim copy for driver sources and driver-scrubbed outputs; the leak scan below verifies them. */
function copyVerbatim(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}
function inventory(root) {
  const entries = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      const rel = relative(root, path).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        entries.push({ path: rel, type: 'directory' });
        walk(path);
      } else {
        const stats = statSync(path, { bigint: true });
        entries.push({ path: rel, type: entry.isFile() ? 'file' : 'other', size: Number(stats.size), sha256: entry.isFile() && stats.size < 16n << 20n ? sha(path) : null });
      }
    }
  };
  walk(root);
  return entries;
}
if (existsSync(PUBLIC) || existsSync(PRIVATE)) throw new Error('refusing to overwrite an existing package');

// ---- 1. post-run filesystem inventories of every scratch run folder (base-suite runs had none)
const LANES = {
  matched: 'candidate-20261121T014803Z-3edac9',
  'job-host': 'candidate-20261121T015345Z-4619c4',
  ext: 'candidate-20261121T020839Z-081d57',
  'ext-baseline': 'baseline-20261121T021033Z-3c576e',
  'ext-dev': ['candidate-20261121T020409Z-77d3d7', 'candidate-20261121T020717Z-f694f9'],
};
mkdirSync(join(PRIVATE, 'filesystem'), { recursive: true });
const inventories = {};
for (const runId of Object.values(LANES).flat()) {
  const dir = join(SCRATCH, 'runs', runId);
  const entries = inventory(dir);
  inventories[runId] = { files: entries.filter((entry) => entry.type === 'file').length, directories: entries.filter((entry) => entry.type === 'directory').length };
  writeFileSync(join(PRIVATE, 'filesystem', `${runId}.scratch-inventory.json`), JSON.stringify({ schema: 'gg459-post-run-inventory/1', run: runId, root: '<SCRATCH>/runs/' + runId, takenAt: new Date().toISOString(), entries }, null, 2) + '\n');
}

// ---- 2. public: scrubbed case evidence (the driver already scrubbed run/summary/cases), no raw-private
const skipRaw = (path, entry) => entry.isDirectory() && entry.name === 'raw-private';
for (const [lane, ids] of Object.entries(LANES)) {
  for (const runId of [ids].flat()) {
    copyTreeScrubbed(join(QA, lane, runId), join(PUBLIC, 'runs', lane, runId), skipRaw, copyVerbatim);
    for (const suffix of ['.console.log', '.started-utc.txt'])
      if (existsSync(join(QA, lane, runId + suffix))) copyScrubbed(join(QA, lane, runId + suffix), join(PUBLIC, 'runs', lane, runId + suffix));
  }
}
for (const name of ['dev1.console.log', 'dev2.console.log', 'dev1-driver.sha256', 'dev2-driver.sha256'])
  copyScrubbed(join(QA, 'ext-dev', name), join(PUBLIC, 'runs', 'ext-dev', name));
for (const name of ['main-checkout-before.txt', 'main-checkout-after.txt'])
  copyScrubbed(join(QA, 'ext-baseline', name), join(PUBLIC, 'runs', 'ext-baseline', name));
for (const file of readdirSync(join(PRIVATE, 'filesystem')))
  copyScrubbed(join(PRIVATE, 'filesystem', file), join(PUBLIC, 'filesystem', file));

// ---- 3. public: reusable driver sources (ext copy) and the untouched baseline driver hashes
copyTreeScrubbed(join(SCRATCH, 'driver-ext'), join(PUBLIC, 'driver', 'qa459-ext'), () => false, copyVerbatim);
copyScrubbed(join(SCRATCH, 'driver-ext-copy-initial.sha256'), join(PUBLIC, 'driver', 'baseline-driver-copy-initial.sha256'));
copyScrubbed(join(SCRATCH, 'driver-ext-v1-frozen.sha256'), join(PUBLIC, 'driver', 'qa459-ext-v1-frozen.sha256'));
copyScrubbed(join(SCRATCH, 'tools', 'qa459-ext.diff'), join(PUBLIC, 'driver', 'qa459-ext-vs-baseline.diff'));
for (const name of ['analyze.mjs', 'run-maintained-helper-checks.mjs'])
  copyVerbatim(join(SCRATCH, 'tools', name), join(PUBLIC, 'tools', name));
// This packager names local roots; its public copy is path-scrubbed and documented as such.
copyScrubbed(join(SCRATCH, 'tools', 'package.mjs'), join(PUBLIC, 'tools', 'package.scrubbed.mjs'));

// ---- 4. setup exploration: scripts + JSON results public (scrubbed); every raw output private
for (const name of ['nest-explore.mjs', 'quota-explore.mjs']) copyVerbatim(join(SCRATCH, 'explore', name), join(PUBLIC, 'setup-exploration', name));
for (const [dir, file] of [['out-1', 'nest-explore.json'], ['out-2', 'nest-explore.json'], ['quota-1', 'quota-explore.json']])
  copyScrubbed(join(SCRATCH, 'explore', dir, file), join(PUBLIC, 'setup-exploration', `${dir}.${file}`));
for (const dir of ['out-1', 'out-2', 'quota-1']) cpSync(join(SCRATCH, 'explore', dir), join(PRIVATE, 'setup-exploration', dir), { recursive: true });
writeFileSync(join(PRIVATE, 'setup-exploration', 'witness-builds.sha256'),
  ['bin/QaWitness.exe', 'bin/QaWitness2.exe', 'bin3/QaWitness.exe'].map((file) => `${sha(join(SCRATCH, 'explore', file))} *explore/${file}`).join('\n') + '\n');
copyScrubbed(join(PRIVATE, 'setup-exploration', 'witness-builds.sha256'), join(PUBLIC, 'setup-exploration', 'witness-builds.sha256'));

// ---- 5. maintained control and analysis
copyScrubbed(join(QA, 'maintained-control', 'maintained-helper-checks.json'), join(PUBLIC, 'maintained-control', 'maintained-helper-checks.json'));
copyScrubbed(join(QA, 'analysis.json'), join(PUBLIC, 'analysis.json'));

// ---- 6. private raw index: originals stay in place inside each run folder
const rawIndex = [];
for (const [lane, ids] of Object.entries(LANES))
  for (const runId of [ids].flat()) {
    const raw = join(QA, lane, runId, 'raw-private');
    if (!existsSync(raw)) continue;
    for (const entry of inventory(raw).filter((item) => item.type === 'file')) rawIndex.push({ path: `${lane}/${runId}/raw-private/${entry.path}`, size: entry.size, sha256: entry.sha256 });
  }
writeFileSync(join(PRIVATE, 'RAW-INDEX.json'), JSON.stringify({ schema: 'gg459-private-raw-index/1', note: 'Unscrubbed original launcher stdout/stderr bytes, events, launcher.log, configs and probe reports stay in each run folder raw-private/ (not public).', files: rawIndex }, null, 2) + '\n');

// ---- 7. leak scan of public
const leaks = [];
// The sentinel needle is the generated value's prefix plus at least one hex digit, so the
// driver's generator template and this scan's own source are not reported.
const needles = [username, '<ABS_PATH>', '<ABS_PATH>', '<ABS_PATH>', '<ABS_PATH>'];
const sentinelValue = /QA459-SENTINEL-[0-9a-f]{12}/;
const scan = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) scan(path);
    else {
      const text = readFileSync(path, 'latin1');
      for (const needle of needles) if (text.toLowerCase().includes(needle.toLowerCase())) leaks.push({ file: relative(PUBLIC, path), needle: needle === username ? '<USER>' : needle });
      if (sentinelValue.test(text)) leaks.push({ file: relative(PUBLIC, path), needle: 'sentinel-value' });
      const drive = /\b[A-Za-z]:\\\\?[A-Za-z]/.exec(text);
      if (drive) leaks.push({ file: relative(PUBLIC, path), needle: 'drive-path', at: text.slice(Math.max(0, drive.index - 20), drive.index + 40) });
    }
  }
};
scan(PUBLIC);
writeFileSync(join(QA, 'public-leak-scan.json'), JSON.stringify({ scannedAt: new Date().toISOString(), needles: needles.map((needle) => (needle === username ? '<USER>' : needle)), leaks }, null, 2) + '\n');
console.log(JSON.stringify({ inventories, rawFiles: rawIndex.length, leaks }, null, 1));
