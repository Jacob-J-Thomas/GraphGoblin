import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-review-fixes-author-01';
const repo = 'G:/ggq/gg-i4-486-review-fixes/GraphGoblin';
const scratch = 'G:\\ggq\\qa-scratch\\i4-486-review-fixes-author-01';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (process.version !== 'v22.23.4' || process.env.TEMP !== scratch || process.env.TMP !== scratch) throw new Error('runtime/TEMP binding mismatch');
const binding = JSON.parse(readFileSync(join(root, 'binding.json'), 'utf8'));
function verifySource() {
  if (hash(readFileSync(binding.initialIndex.path)) !== binding.initialIndex.sha256) throw new Error('index changed');
  for (const file of binding.files) if (hash(readFileSync(join(repo, file.path))) !== file.sha256) throw new Error(`candidate changed: ${file.path}`);
}
verifySource();
const facts = {};
for (const [key, args] of Object.entries({ head: ['rev-parse', 'HEAD'], tree: ['rev-parse', 'HEAD^{tree}'], branch: ['branch', '--show-current'], status: ['status', '--porcelain=v1'], stagedDiff: ['diff', '--cached', '--exit-code'], diffCheck: ['diff', '--check'] })) {
  const result = spawnSync('git.exe', args, { cwd: repo, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`final git check failed: ${key}`);
  facts[key] = result.stdout.trim();
}
if (facts.head !== binding.head || facts.tree !== binding.tree || facts.branch !== binding.branch) throw new Error('Git binding changed');
writeFileSync(join(root, 'final-state.json'), JSON.stringify({ ...facts, runtime: process.execPath, nodeVersion: process.version, TEMP: process.env.TEMP, TMP: process.env.TMP, indexByteIdentical: true, finalIndexSha256: binding.finalIndexSha256, sourceFiles: binding.files }, null, 2));
writeFileSync(join(root, 'final-seal-command.json'), JSON.stringify({ cwd: repo, command: "$env:TEMP='G:\\ggq\\qa-scratch\\i4-486-review-fixes-author-01'; $env:TMP=$env:TEMP; & 'C:\\Users\\98jak\\.claude\\codex-runs\\GraphGoblin\\runtime\\node-v22.23.4-win-x64\\node.exe' 'G:\\ggq\\delivery-evidence\\2026-11-17-five-intents\\i4-486-review-fixes-author-01\\seal.mjs'", verifies: 'All existing author files, source bytes and Git index. Only seal files themselves are excluded.' }, null, 2));
const entries = [];
const excluded = new Set(['seal.json', 'seal-verification.json', 'SEAL.sha256']);
function walk(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    const key = relative(root, path).replaceAll('\\', '/');
    if (excluded.has(key)) continue;
    if (item.isDirectory()) walk(path);
    else if (item.isFile()) {
      const bytes = readFileSync(path);
      entries.push({ path: key, bytes: bytes.length, sha256: hash(bytes) });
    } else throw new Error(`unexpected artifact type: ${key}`);
  }
}
walk(root);
entries.sort((a, b) => a.path.localeCompare(b.path));
const seal = { sealedAt: new Date().toISOString(), root, sourceHead: binding.head, sourceTree: binding.tree, patchSha256: binding.patchSha256, reportSha256: hash(readFileSync(join(root, 'REPORT.md'))), indexByteIdentical: true, exclusions: [...excluded], files: entries };
writeFileSync(join(root, 'seal.json'), JSON.stringify(seal, null, 2));
const sealSha256 = hash(readFileSync(join(root, 'seal.json')));
writeFileSync(join(root, 'SEAL.sha256'), `${sealSha256}  seal.json\n`);
for (const entry of entries) if (hash(readFileSync(join(root, entry.path))) !== entry.sha256) throw new Error(`sealed file mismatch: ${entry.path}`);
verifySource();
const result = { verifiedAt: new Date().toISOString(), verified: true, sealedFiles: entries.length, sealSha256, reportSha256: seal.reportSha256, patchSha256: seal.patchSha256, indexByteIdentical: true };
writeFileSync(join(root, 'seal-verification.json'), JSON.stringify(result, null, 2));
process.stdout.write(JSON.stringify(result, null, 2));
