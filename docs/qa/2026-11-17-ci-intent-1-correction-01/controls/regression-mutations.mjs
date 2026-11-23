// Red/green proof for the maintained #496 correction regressions (author-side, not independent QA).
//
// For each mutation the script reverts exactly one correction in the candidate checkout, runs the
// focused helper suite once with Vitest's JSON reporter, restores the original bytes and checks
// their SHA-256. A mutation must turn named regression tests red; the unmutated run must be green.
//
// Usage: node regression-mutations.mjs <checkout> <output-dir>
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [checkout, output] = process.argv.slice(2);
mkdirSync(output, { recursive: true });
const helper = join(checkout, 'tooling/scripts/windows-launcher-evidence.mjs');
const workflow = join(checkout, '.github/workflows/ci.yml');
const originalWorkflow = join(output, '..', '..', 'original-candidate/.github/workflows/ci.yml');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

const replace = (from, to) => (text) => {
  assert.equal(text.split(from).length, 2, `anchor not unique: ${from}`);
  return text.replace(from, () => to);
};
const MUTATIONS = [
  {
    name: 'root1-original-windows-job',
    root: 1,
    file: workflow,
    change: () => readFileSync(originalWorkflow, 'utf8'),
  },
  {
    name: 'root1-outputs-of-a-failed-prepare-are-used',
    root: 1,
    file: workflow,
    change: (text) =>
      replace(
        "${{ steps.evidence.outcome == 'success' && steps.evidence.outputs.dir || '' }}",
        '${{ steps.evidence.outputs.dir }}',
      )(
        replace(
          "if: ${{ always() && steps.evidence.outcome == 'success' }}",
          "if: ${{ always() && steps.evidence.outputs.dir != '' }}",
        )(text),
      ),
  },
  {
    name: 'root2-manifest-bytes-not-compared',
    root: 2,
    file: helper,
    change: replace(
      "if (!Buffer.from(serializeManifest(manifest), 'utf8').equals(content))",
      'if (false)',
    ),
  },
  {
    name: 'root2-observation-bom-accepted',
    root: 2,
    file: helper,
    change: replace("if (decoded.charCodeAt(0) === 0xfeff) return rejected('byte-order-mark');", ''),
  },
  {
    name: 'root3-binding-not-required',
    root: 3,
    file: helper,
    change: replace('...bindingRequirements(manifest.binding),', ''),
  },
  {
    name: 'root3-recorder-accepts-repeated-facts',
    root: 3,
    file: helper,
    change: replace('if (this.#facts.has(key)) return false;', ''),
  },
  {
    name: 'root3-recorder-lifecycle-public',
    root: 3,
    file: helper,
    change: replace('(internal || !INTERNAL.has(type))', 'true'),
  },
  {
    name: 'root3-stream-repeated-facts-accepted',
    root: 3,
    file: helper,
    change: replace("if (facts.has(key)) return 'duplicate-fact';", ''),
  },
  {
    name: 'root3-stream-second-open-accepted',
    root: 3,
    file: helper,
    change: replace("(index > 0 && record.type === 'recorder-open') ||", ''),
  },
  {
    name: 'root3-trials-counted-not-distinct',
    root: 3,
    file: helper,
    change: replace(
      'if (!CONTENTION_TRIALS.every((trial) => summary.contention.includes(trial)))',
      'if (summary.contention.length < 3)',
    ),
  },
];

function runSuite(name) {
  const report = join(output, `${name}.vitest.json`);
  const result = spawnSync(
    process.execPath,
    [
      join(checkout, 'tooling/node_modules/vitest/vitest.mjs'),
      'run',
      'scripts/windows-launcher-evidence.test.mjs',
      '--reporter=json',
      `--outputFile=${report}`,
    ],
    { cwd: join(checkout, 'tooling'), encoding: 'utf8', timeout: 300_000, windowsHide: true },
  );
  const json = JSON.parse(readFileSync(report, 'utf8'));
  const tests = json.testResults.flatMap((file) => file.assertionResults);
  return {
    exit: result.status,
    passed: tests.filter((test) => test.status === 'passed').length,
    failed: tests.filter((test) => test.status === 'failed').map((test) => test.title),
  };
}

const sources = { [helper]: readFileSync(helper), [workflow]: readFileSync(workflow) };
const receipt = {
  node: process.version,
  sources: Object.fromEntries(
    Object.entries(sources).map(([path, bytes]) => [path.slice(checkout.length + 1), sha(bytes)]),
  ),
  baseline: runSuite('baseline'),
  mutations: [],
};
for (const mutation of MUTATIONS) {
  const original = sources[mutation.file];
  const mutated = mutation.change(original.toString('utf8'));
  assert.notEqual(mutated, original.toString('utf8'), mutation.name);
  try {
    writeFileSync(mutation.file, mutated);
    receipt.mutations.push({ name: mutation.name, root: mutation.root, mutatedSha256: sha(Buffer.from(mutated)), ...runSuite(mutation.name) });
  } finally {
    writeFileSync(mutation.file, original);
  }
  assert.equal(sha(readFileSync(mutation.file)), sha(original), `${mutation.name} restored`);
}
receipt.restored = Object.fromEntries(
  Object.keys(sources).map((path) => [path.slice(checkout.length + 1), sha(readFileSync(path))]),
);
receipt.ok =
  receipt.baseline.exit === 0 &&
  receipt.baseline.failed.length === 0 &&
  receipt.mutations.every((mutation) => mutation.exit !== 0 && mutation.failed.length > 0) &&
  JSON.stringify(receipt.restored) === JSON.stringify(receipt.sources);
writeFileSync(join(output, 'regression-mutations.json'), `${JSON.stringify(receipt, null, 2)}\n`);
for (const mutation of receipt.mutations)
  console.log(`${mutation.exit === 0 ? 'SURVIVED' : 'KILLED  '} ${mutation.name}: ${mutation.failed.join(' | ')}`);
console.log(`baseline exit ${receipt.baseline.exit}, ${receipt.baseline.passed} passed; ok=${receipt.ok}`);
process.exitCode = receipt.ok ? 0 : 1;
