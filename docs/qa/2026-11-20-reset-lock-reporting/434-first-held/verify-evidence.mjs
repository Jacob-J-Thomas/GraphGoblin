import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(root, name));
const json = (name) => JSON.parse(read(name));
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const inventory = (dir, base = dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory()
      ? inventory(full, base)
      : [path.relative(base, full).replaceAll('\\', '/')];
  });
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 1 && args[0] === '--integrity-only'));
const manifest = json('evidence-manifest.json');
const provenance = json('provenance.json');
assert.equal(manifest.base, '8181f350028e284529c76b51927f32890afcb68a');
assert.equal(manifest.source, 'a8191dd97aacfe9709d2369afd60497214bf00a7');
assert.deepEqual(
  inventory(root)
    .filter((name) => name !== 'evidence-manifest.json')
    .sort(),
  manifest.files.map((entry) => entry.path).sort(),
);
for (const entry of manifest.files) {
  assert.ok(path.resolve(root, entry.path).startsWith(root + path.sep));
  assert.equal(read(entry.path).length, entry.bytes);
  assert.equal(sha256(read(entry.path)), entry.sha256);
}
assert.equal(provenance.publicationReady, false);
assert.equal(provenance.terminal.processExit, 0);
assert.equal(provenance.terminal.providerSubtype, 'success');
assert.equal(provenance.terminal.is_error, false);
assert.equal(provenance.terminal.messageMatchesProviderResult, true);
assert.equal(
  provenance.hold.url,
  'https://github.com/Jacob-J-Thomas/GraphGoblin/pull/531#issuecomment-7033700508',
);
assert.equal(
  sha256(read('records/publication-hold.original.txt')),
  provenance.hold.originalTextSha256,
);
for (const driver of provenance.drivers) {
  const bytes = driver.publishedPath.endsWith('.gz')
    ? zlib.gunzipSync(read(driver.publishedPath))
    : read(driver.publishedPath);
  assert.equal(bytes.length, driver.originalBytes);
  assert.equal(sha256(bytes), driver.originalSha256);
}
const expected = {
  baseline: [282, 218, 64, 15],
  'run-01': [282, 280, 2, 69],
  'run-02': [282, 280, 2, 69],
  'targeted-v1': [231, 224, 7, 52],
  'targeted-v2': [50, 49, 1, 11],
  'targeted-v3': [28, 26, 2, 0],
};
const records = {};
let assertionsRecounted = 0;
for (const selected of provenance.projections) {
  const data = json(selected.path);
  records[selected.label] = data;
  assert.equal(data.originalSource.sha256, selected.originalSha256);
  const assertions = data.scenarios.flatMap((scenario) => scenario.assertions);
  const tally = (list) => ({
    total: list.length,
    pass: list.filter((entry) => entry.outcome === 'pass').length,
    fail: list.filter((entry) => entry.outcome === 'fail').length,
    notRun: list.filter((entry) => !['pass', 'fail'].includes(entry.outcome)).length,
  });
  assert.deepEqual(tally(assertions), data.totals.all);
  for (const [kind, total] of Object.entries(data.totals.byKind))
    assert.deepEqual(tally(assertions.filter((entry) => entry.kind === kind)), total);
  const [total, pass, fail, acceptance] = expected[selected.label];
  assert.deepEqual(
    [
      data.totals.all.total,
      data.totals.all.pass,
      data.totals.all.fail,
      data.totals.byKind.acceptance.pass,
    ],
    [total, pass, fail, acceptance],
  );
  assert.equal(
    data.provenance.head,
    selected.label === 'baseline' ? manifest.base : manifest.source,
  );
  assert.equal(data.provenance.headMatches, true);
  assert.deepEqual(data.provenance.trackedChanges, []);
  assertionsRecounted += assertions.length;
}
assert.equal(assertionsRecounted, 1155);
const assertionMap = (data) =>
  new Map(
    data.scenarios.flatMap((scenario) => scenario.assertions).map((entry) => [entry.id, entry]),
  );
const baseline = assertionMap(records.baseline);
const first = assertionMap(records['run-01']);
const second = assertionMap(records['run-02']);
assert.deepEqual([...first.keys()], [...second.keys()]);
let failToPass = 0,
  passToPass = 0,
  passToFail = 0,
  failToFail = 0;
for (const [id, item] of first) {
  assert.equal(item.outcome, second.get(id).outcome);
  const before = baseline.get(id).outcome;
  if (before === 'fail' && item.outcome === 'pass') failToPass++;
  if (before === 'pass' && item.outcome === 'pass') passToPass++;
  if (before === 'pass' && item.outcome === 'fail') passToFail++;
  if (before === 'fail' && item.outcome === 'fail') failToFail++;
}
assert.deepEqual([failToPass, passToPass, passToFail, failToFail], [63, 217, 1, 1]);
for (const data of [records['run-01'], records['run-02']]) {
  const map = assertionMap(data);
  assert.equal(map.get('S08.confirmed.dirLockReleasedAndReported').outcome, 'fail');
  assert.equal(map.get('S11.confirmed.nestedUnrelatedListedAsKept').outcome, 'fail');
  const s08 = data.scenarios
    .find((entry) => entry.id === 'S08')
    .runs.find((entry) => entry.name === 'confirmed');
  assert.ok(s08.stderr.includes('removed graphgoblin.lock (data-directory lock)'));
  assert.equal(Object.hasOwn(s08.treeAfter, 'data/graphgoblin.lock'), false);
  assert.equal(Object.hasOwn(s08.treeAfter, 'data/graphgoblin.db.graphgoblin.lock'), false);
  const s11 = data.scenarios
    .find((entry) => entry.id === 'S11')
    .runs.find((entry) => entry.name === 'confirmed');
  assert.ok(Object.hasOwn(s11.treeBefore, 'data/db/readme.txt'));
  assert.deepEqual(s11.treeBefore['data/db/readme.txt'], s11.treeAfter['data/db/readme.txt']);
}
assert.equal(baseline.get('S11.confirmed.nestedUnrelatedListedAsKept').outcome, 'fail');
for (const id of ['T01R', 'T01']) {
  const scenario = records['targeted-v1'].scenarios.find((entry) => entry.id === id);
  assert.ok(scenario.assertions.every((entry) => entry.outcome === 'pass'));
}
assert.equal(assertionMap(records['targeted-v1']).get('T07a.driver').outcome, 'fail');
for (const data of [records['targeted-v1'], records['targeted-v2']])
  assert.equal(assertionMap(data).get('T09.confirmed.nothingAddedOrChanged').outcome, 'fail');
for (const suffix of ['dry', 'confirmed'])
  assert.equal(
    assertionMap(records['targeted-v3']).get('T04f.' + suffix + '.refusalNamesPath').outcome,
    'fail',
  );
let localLinks = 0;
for (const name of inventory(root).filter((entry) => entry.endsWith('.md'))) {
  for (const match of read(name)
    .toString('utf8')
    .matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const href = match[1].replace(/^<|>$/g, '');
    if (/^[a-z][a-z\d+.-]*:/i.test(href)) continue;
    assert.ok(
      fs.existsSync(path.resolve(root, path.dirname(name), decodeURIComponent(href.split('#')[0]))),
    );
    localLinks++;
  }
}
console.log(
  JSON.stringify(
    {
      result: 'held-first-candidate',
      integrity: 'pass',
      publicationReady: false,
      base: manifest.base,
      source: manifest.source,
      manifestSha256: sha256(read('evidence-manifest.json')),
      entriesVerified: manifest.files.length,
      originalCandidateRuns: ['280/282', '280/282'],
      originalSupplementalFailures: [7, 1, 2],
      assertionsRecounted,
      unchangedRepeatOutcomes: 282,
      driversVerified: provenance.drivers.length,
      localLinks,
      productOrDriverExecution: false,
    },
    null,
    2,
  ),
);
if (!args.includes('--integrity-only')) process.exitCode = 2;
