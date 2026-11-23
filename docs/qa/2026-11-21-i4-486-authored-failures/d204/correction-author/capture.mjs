import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
const root = 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-review-fixes-author-01';
const repo = 'G:/ggq/gg-i4-486-review-fixes/GraphGoblin';
const base = '633d9ac72c10fe4b8d76f7ba50221f9ed8557cb9';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const paths = ['docs/05-execution-engine.md', 'packages/engine/src/failure-publication.ts', 'packages/engine/src/handlers/inference-context.ts', 'packages/engine/src/run-manager.ts', 'packages/engine/src/handlers/inference-context.test.ts', 'packages/engine/src/handlers/inference-workspace.test.ts'];
function git(args) {
  const result = spawnSync('git.exe', args, { cwd: repo, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}
const files = paths.map(path => {
  const bytes = readFileSync(join(repo, path));
  const snapshot = join(root, 'candidate-source', path);
  mkdirSync(dirname(snapshot), { recursive: true });
  writeFileSync(snapshot, bytes);
  const original = spawnSync('git.exe', ['show', `${base}:${path}`], { cwd: repo });
  if (original.status === 0) {
    const destination = join(root, 'original-source633', path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, original.stdout);
  }
  return { path, bytes: bytes.length, sha256: hash(bytes), baselineSha256: original.status === 0 ? hash(original.stdout) : null };
});
const initialIndex = JSON.parse(readFileSync(join(root, 'initial-index.json'), 'utf8'));
const currentIndex = hash(readFileSync(initialIndex.path));
if (currentIndex !== initialIndex.sha256) throw new Error('Git index bytes changed');
const trackedDiff = git(['diff', '--binary', 'HEAD', '--']);
const untrackedDiff = spawnSync('git.exe', ['diff', '--no-index', '--binary', '--', '/dev/null', paths[5]], { cwd: repo });
if (untrackedDiff.status !== 1) throw new Error(`untracked diff failed: ${untrackedDiff.stderr}`);
writeFileSync(join(root, 'reviewable-complete.patch'), Buffer.concat([trackedDiff, untrackedDiff.stdout]));
const originals = [
  ['task-brief.md', 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-486-review-fixes-sol-BRIEF-01.md'],
  ['decision-204.md', 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/decision-204.md'],
  ['fable-review-cycle1.md', 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-486-fable-review-02/provider/provider-final-message.md'],
  ['preparation-receipt.json', 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-review-fixes-preparation-01/receipt.json'],
];
mkdirSync(join(root, 'inputs'), { recursive: true });
const inputs = originals.map(([name, source]) => {
  const bytes = readFileSync(source);
  writeFileSync(join(root, 'inputs', name), bytes);
  return { name, source, sha256: hash(bytes) };
});
writeFileSync(join(root, 'binding.json'), JSON.stringify({ capturedAt: new Date().toISOString(), repo, head: git(['rev-parse', 'HEAD']).toString().trim(), tree: git(['rev-parse', 'HEAD^{tree}']).toString().trim(), branch: git(['branch', '--show-current']).toString().trim(), status: git(['status', '--porcelain=v1']).toString(), initialIndex, finalIndexSha256: currentIndex, indexByteIdentical: true, files, inputs, patchSha256: hash(readFileSync(join(root, 'reviewable-complete.patch'))) }, null, 2));
process.stdout.write(JSON.stringify({ indexByteIdentical: true, files, patchSha256: hash(readFileSync(join(root, 'reviewable-complete.patch'))) }, null, 2));
