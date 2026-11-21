// C5 integrity snapshot for D203 independent QA. Read-only: hashes the frozen candidate checkout,
// its build outputs, index/lock/install metadata and the bound evidence packets, and compares them
// with the preparation inventories. Usage: node c5-integrity.mjs <before|after> <output.json>
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const [phase, output] = process.argv.slice(2);
const REPO = 'G:\\ggq\\gg-i4-364-deadline-qa\\GraphGoblin';
const PREP = 'G:\\ggq\\delivery-evidence\\2026-11-17-five-intents\\i4-364-deadline-qa-preparation-01';
const AUTHOR = 'G:\\ggq\\delivery-evidence\\2026-11-17-five-intents\\i4-364-deadline-author-01';
const Q = 'C:\\Users\\98jak\\graphgoblin-qa\\2026-11-17-five-intents';
const INDEX = 'C:\\Users\\98jak\\source\\repos\\GraphGoblin\\.git\\worktrees\\GraphGoblin158\\index';
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const git = (...args) =>
  execFileSync('git', ['-C', REPO, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
const checks = [];
const check = (name, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({ name, pass, actual, expected });
};

// Git identity and cleanliness (read-only; optional locks disabled).
check('HEAD', git('rev-parse', 'HEAD').trim(), 'e8cf31d51837a4fa362f909604b3070277db6c25');
check('tree', git('rev-parse', 'HEAD^{tree}').trim(), '0927bbbf9f3889791c956e7816e3524c9a5a8fe6');
check('parent', git('rev-parse', 'HEAD^').trim(), '580aded6d295061897b047ac16811e5da230d9e0');
const status = git('status', '--porcelain=v1', '--untracked-files=all');
check('status empty', status, '');
check('detached', (() => {
  try {
    return git('symbolic-ref', '-q', 'HEAD').trim();
  } catch {
    return null;
  }
})(), null);
check('index file sha256', sha(INDEX), 'c806109d89d765a7f1f0ce074f1c03e47d58bd14b72cf39003e455bee7799166');
check('lockfile sha256', sha(join(REPO, 'pnpm-lock.yaml')), 'bcc908d0f7aa32ba4a64302a9f74284c1a0679e2372ca1ba83176af5b5bbcce2');
check('.modules.yaml sha256', sha(join(REPO, 'node_modules', '.modules.yaml')), 'db2014edcfc6302289c955b47e44f24a750114268aeac56dbdb2be6fbbccaa8f');
check('.pnpm/lock.yaml sha256', sha(join(REPO, 'node_modules', '.pnpm', 'lock.yaml')), '022b13b3fca8306ec01501a09cfdf7cbbe757fca1c08d14813b34d8cc8717287');

// Root-freeze five source hashes.
const freeze = JSON.parse(readFileSync(join(Q, 'i4-364-deadline-root-freeze-01', 'receipt.json'), 'utf8'));
for (const [path, expected] of Object.entries(freeze.sourceHashes))
  check(`freeze source ${path}`, sha(join(REPO, ...path.split('/'))), expected);

// Every preparation-inventoried source file.
const inventory = JSON.parse(readFileSync(join(PREP, 'candidate-source-inventory.json'), 'utf8'));
let sourceMismatch = [];
for (const file of inventory.files) {
  const path = join(REPO, ...file.relativePath.split('/'));
  let actual;
  try {
    const bytes = readFileSync(path);
    actual = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  } catch (error) {
    actual = { error: error.code };
  }
  if (actual.sha256 !== file.sha256 || actual.bytes !== file.bytes)
    sourceMismatch.push({ path: file.relativePath, actual, expected: { bytes: file.bytes, sha256: file.sha256 } });
}
check('source inventory members', inventory.files.length > 0, true);
check('source inventory mismatches', sourceMismatch, []);

// Every emitted build output, plus any extra file under the output roots.
const outputs = JSON.parse(readFileSync(join(PREP, 'emitted-output-hashes.json'), 'utf8'));
const listed = new Set(outputs.files.map((file) => file.relativePath));
const outputMismatch = [];
for (const file of outputs.files) {
  const path = join(REPO, ...file.relativePath.split('/'));
  let actual;
  try {
    const bytes = readFileSync(path);
    actual = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  } catch (error) {
    actual = { error: error.code };
  }
  if (actual.sha256 !== file.sha256 || actual.bytes !== file.bytes)
    outputMismatch.push({ path: file.relativePath, actual });
}
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
const extra = [];
for (const root of outputs.outputRoots)
  for (const path of walk(join(REPO, ...root.split('/')))) {
    const rel = relative(REPO, path).split(sep).join('/');
    if (!listed.has(rel)) extra.push(rel);
  }
check('output members', outputs.files.length, 1271);
check('output mismatches', outputMismatch, []);
check('extra output files', extra, []);

// Bound evidence bytes.
check('preparation receipt', sha(join(PREP, 'receipt.json')), '42c1503ae5237be7bfe9966c75c5b12d6d93ab8e6b27cd6d3439173c355a6487');
check('preparation manifest', sha(join(PREP, 'MANIFEST.sha256.json')), '7ca7bcf9538995fadeeae0b256ee255f9b42802774f651097d3cadc6ab8f59bc');
check('preparation output hashes', sha(join(PREP, 'emitted-output-hashes.json')), 'c5462fbbb8992be41e352d9cdaa96bb3a4e6be8cb5146dca90172827ec0d1fc9');
check('root freeze receipt', sha(join(Q, 'i4-364-deadline-root-freeze-01', 'receipt.json')), 'c6c28a0ae15f91f534328adbae808201daa31083b144ce62146402d61e8b9779');
check('author REPORT.md', sha(join(AUTHOR, 'REPORT.md')), '23fa538f64edba6d2d83c6ed3beed1022296f78e96b4da78aa6a3b23cbd32157');
check('author manifest.json', sha(join(AUTHOR, 'manifest.json')), 'd38aea7a632156e0714cea9124a69960c98333bd15be29fe49dee23a66bad9ef');
const authorManifest = JSON.parse(readFileSync(join(AUTHOR, 'manifest.json'), 'utf8'));
const authorMismatch = [];
for (const file of authorManifest.files) {
  const path = join(AUTHOR, ...file.path.split(/[\\/]/));
  let actual;
  try {
    actual = sha(path);
  } catch (error) {
    actual = error.code;
  }
  if (actual !== file.sha256) authorMismatch.push({ path: file.path, actual });
}
check('author manifest members', authorManifest.files.length, authorManifest.member_count ?? authorManifest.files.length);
check('author manifest mismatches', authorMismatch, []);
const astra = sha(join(Q, 'i4-549-final-astra-02', 'REPORT.md'));
check('final scan 3 REPORT.md (D203 cites b7d9f742…)', astra, 'b7d9f7428fbc3bae56e554355e97e0054e1429929107ac9514478f60e3f0ac56');

const result = {
  phase,
  utc: new Date().toISOString(),
  node: process.version,
  sourceMembers: inventory.files.length,
  outputMembers: outputs.files.length,
  authorMembers: authorManifest.files.length,
  decision203Sha256: sha(join(Q, 'decision-203.md')),
  passed: checks.filter((c) => c.pass).length,
  failed: checks.filter((c) => !c.pass).length,
  checks,
};
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(`${phase}: ${result.passed} pass, ${result.failed} fail`);
for (const c of checks.filter((c) => !c.pass)) console.log('FAIL', c.name, JSON.stringify(c.actual).slice(0, 300));
process.exitCode = result.failed ? 1 : 0;
