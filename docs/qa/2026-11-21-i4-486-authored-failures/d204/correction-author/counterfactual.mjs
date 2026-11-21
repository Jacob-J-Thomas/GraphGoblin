import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
const root = 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-review-fixes-author-01';
const repo = 'G:/ggq/gg-i4-486-review-fixes/GraphGoblin';
const source = '633d9ac72c10fe4b8d76f7ba50221f9ed8557cb9';
const paths = ['packages/engine/src/failure-publication.ts', 'packages/engine/src/handlers/inference-context.ts', 'packages/engine/src/run-manager.ts'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const candidate = new Map(paths.map(path => [path, readFileSync(join(repo, path))]));
const binding = [];
for (const [path, bytes] of candidate) {
  const preserved = join(root, 'counterfactual/candidate', path);
  mkdirSync(dirname(preserved), { recursive: true });
  writeFileSync(preserved, bytes);
  const original = spawnSync('git.exe', ['show', `${source}:${path}`], { cwd: repo });
  if (original.status !== 0) throw new Error(`git show failed: ${path}`);
  const originalPath = join(root, 'counterfactual/original633', path);
  mkdirSync(dirname(originalPath), { recursive: true });
  writeFileSync(originalPath, original.stdout);
  binding.push({ path, candidateSha256: hash(bytes), original633Sha256: hash(original.stdout) });
}
const commands = [];
function check(name, script) {
  const child = spawnSync(process.execPath, [join(root, 'driver.mjs'), name, join(root, 'scripts', script)], { cwd: repo, env: process.env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  process.stdout.write(child.stdout ?? '');
  process.stderr.write(child.stderr ?? '');
  commands.push({ name, status: child.status });
  return child.status;
}
try {
  for (const path of paths) writeFileSync(join(repo, path), readFileSync(join(root, 'counterfactual/original633', path)));
  if (check('16a-original633-f1', 'control-f1.ps1') === 0) throw new Error('old-source F1 unexpectedly passed');
  if (check('16b-original633-f2', 'control-f2.ps1') !== 0) throw new Error('old-source F2 failed');
} finally {
  for (const [path, bytes] of candidate) writeFileSync(join(repo, path), bytes);
  for (const entry of binding) {
    entry.restoredSha256 = hash(readFileSync(join(repo, entry.path)));
    if (entry.restoredSha256 !== entry.candidateSha256) throw new Error(`candidate restore mismatch: ${entry.path}`);
  }
  writeFileSync(join(root, 'counterfactual/binding.json'), JSON.stringify({ source, productionPaths: binding, commands }, null, 2));
}
if (check('16c-candidate-f1', 'control-f1.ps1') !== 0) throw new Error('restored candidate F1 failed');
if (check('16d-candidate-f2', 'control-f2.ps1') !== 0) throw new Error('restored candidate F2 failed');
writeFileSync(join(root, 'counterfactual/result.json'), JSON.stringify({ source, productionPaths: binding, commands, candidateRestoredExactly: true }, null, 2));
