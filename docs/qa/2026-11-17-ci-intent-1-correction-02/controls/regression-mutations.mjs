// Red proof for the correction-02 regressions (#496 roots 1 and 2; author-side, not independent QA).
//
// Each mutation reverts exactly one correction-02 change in the helper of the checkout, runs the
// focused helper suite once with Vitest's JSON reporter, restores the original bytes and checks
// their SHA-256. A revert must turn its named target regressions red. The over-tightening control
// is not a revert: it shows the genuine-overflow regression fails if the closer rule demanded
// equality even with omissions. The unmutated green run is logs/02-focused-helper-coverage.log.
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
const tests = join(checkout, 'tooling/scripts/windows-launcher-evidence.test.mjs');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

const replace = (from, to) => (text) => {
  assert.equal(text.split(from).length, 2, `anchor not unique: ${from}`);
  return text.replace(from, () => to);
};
const IDENTITY_TEST =
  'complete evidence needs every run identity value, while runner diagnostics may be unavailable';
const IDENTITY_CLI_TEST =
  'through the real CLI, a verified run without its run ID keeps its files and is not complete';
const CLOSER_TEST =
  "a closer's rejected count must equal the stream's unless it also counts omitted records";
const OVERFLOW_TEST = 'a genuine overflow that omits rejections stays valid partial evidence';
const STAMP_TEST = 'a rejection the recorder could not stamp is neither written nor counted';

const MUTATIONS = [
  {
    name: 'root1-run-identity-not-required',
    kind: 'revert',
    targets: [IDENTITY_TEST, IDENTITY_CLI_TEST],
    change: replace(
      "    ...(RUN_IDENTITY.some((name) => binding[name] === null) ? ['binding-identity'] : []),\n",
      '',
    ),
  },
  {
    name: 'root2-closer-may-claim-unwritten-rejections',
    kind: 'revert',
    targets: [CLOSER_TEST],
    change: replace('          record.rejected > rejections + record.omittedRecords ||\n', ''),
  },
  {
    name: 'root2-rejection-counted-before-its-record-exists',
    kind: 'revert',
    targets: [STAMP_TEST],
    change: replace(
      `  #rejection(type) {
    const record = {
      seq: ++this.#seq,
      at: this.#now().toISOString(),
      type: 'rejected',
      recordType: Object.hasOwn(SCHEMAS, type) ? type : 'unknown',
    };
    // Counted only once the record exists, so every counted rejection is written or omitted.
    this.#rejected++;
    return record;
  }`,
      `  #rejection(type) {
    this.#rejected++;
    return {
      seq: ++this.#seq,
      at: this.#now().toISOString(),
      type: 'rejected',
      recordType: Object.hasOwn(SCHEMAS, type) ? type : 'unknown',
    };
  }`,
    ),
  },
  {
    name: 'control-closer-must-equal-even-with-omissions',
    kind: 'over-tightening control',
    targets: [OVERFLOW_TEST],
    change: replace(
      '          record.rejected < rejections ||\n          record.rejected > rejections + record.omittedRecords ||\n',
      '          record.rejected !== rejections ||\n',
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
  const results = json.testResults.flatMap((file) => file.assertionResults);
  return {
    exit: result.status,
    passed: results.filter((test) => test.status === 'passed').length,
    failed: results.filter((test) => test.status === 'failed').map((test) => test.title),
  };
}

const original = readFileSync(helper);
const receipt = {
  node: process.version,
  sources: {
    'tooling/scripts/windows-launcher-evidence.mjs': sha(original),
    'tooling/scripts/windows-launcher-evidence.test.mjs': sha(readFileSync(tests)),
  },
  mutations: [],
};
for (const mutation of MUTATIONS) {
  const mutated = mutation.change(original.toString('utf8'));
  assert.notEqual(mutated, original.toString('utf8'), mutation.name);
  let run;
  try {
    writeFileSync(helper, mutated);
    run = runSuite(mutation.name);
  } finally {
    writeFileSync(helper, original);
  }
  const restored = sha(readFileSync(helper));
  assert.equal(restored, sha(original), `${mutation.name} restored`);
  receipt.mutations.push({
    name: mutation.name,
    kind: mutation.kind,
    mutatedSha256: sha(Buffer.from(mutated)),
    targets: mutation.targets,
    ...run,
    targetsFailed: mutation.targets.every((title) => run.failed.includes(title)),
    restoredSha256: restored,
  });
}
receipt.restored = {
  'tooling/scripts/windows-launcher-evidence.mjs': sha(readFileSync(helper)),
  'tooling/scripts/windows-launcher-evidence.test.mjs': sha(readFileSync(tests)),
};
receipt.ok =
  receipt.mutations.every((mutation) => mutation.exit !== 0 && mutation.targetsFailed) &&
  JSON.stringify(receipt.restored) === JSON.stringify(receipt.sources);
writeFileSync(join(output, 'regression-mutations.json'), `${JSON.stringify(receipt, null, 2)}\n`);
for (const mutation of receipt.mutations)
  console.log(
    `${mutation.targetsFailed && mutation.exit !== 0 ? 'KILLED  ' : 'SURVIVED'} ${mutation.name} ` +
      `(${mutation.passed} passed): ${mutation.failed.join(' | ')}`,
  );
console.log(`restored identical: ${JSON.stringify(receipt.restored) === JSON.stringify(receipt.sources)}; ok=${receipt.ok}`);
process.exitCode = receipt.ok ? 0 : 1;
