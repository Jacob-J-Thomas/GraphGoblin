import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { runInNewContext } from 'node:vm';

const source = readFileSync(process.argv[2], 'utf8');
const main = source.slice(source.indexOf('function main()'));
const capture = main.indexOf('const zeroProfileInput = sentinel(');
const verifyObjects = main.indexOf('assert.deepEqual(objects.map(witness), objectWitnesses);');
const indexZero = main.indexOf("tools.merge('swift-zero-profile', [zeroProfileInput])");
const exportZero = main.indexOf("tools.load('swift-zero-baseline', zeroProfile, objects, pkg)");
assert.ok(capture >= 0 && capture < verifyObjects && verifyObjects < indexZero && indexZero < exportZero);

const join = posix.join;
const scratch = '/fixture';
const leftRaw = join(scratch, 'sentinel/Left.profraw');
const measurements = [join(scratch, 'default.profdata'), join(scratch, 'entry.profraw')];
const objects = ['test-bundle', 'GraphGoblin', 'GraphGoblinLauncherInstaller', 'PresentationFixture'];
const pkg = join(scratch, 'package');
const sources = new Map();
const sourceDigests = new Map();
const calls = [];
const baseline = new Map();
const observed = new Map();
const indexedPath = (label) => join(scratch, label + '.profdata');
const sandbox = {
  assert,
  join,
  scratch,
  pkg,
  sources,
  sourceDigests,
  objects,
  profiles: measurements,
  out: join(scratch, 'output'),
  process: { env: {} },
  mkdirSync() {},
  writeFileSync() {},
  witness: (path) => path,
  record() {},
  verifyCoverageSentinel() {},
  copyFileSync() {},
  run(label, program, args, options) {
    if (label === 'run-sentinel-Left') assert.equal(options.env.LLVM_PROFILE_FILE, leftRaw);
    return { stdout: Buffer.from(label === 'run-sentinel-Left' ? '11\n' : '22\n') };
  },
  tools: {
    xcrun() {},
    merge(label, inputs) {
      calls.push([label, Array.from(inputs)]);
      return indexedPath(label);
    },
    load(label, profile, inputObjects, packageRoot) {
      calls.push([label, profile, inputObjects, packageRoot]);
      return { 'swift-zero-baseline': baseline, 'swift-coverage': observed }[label] ?? new Map();
    },
  },
  checkCoverage(inputs) {
    assert.equal(inputs.baseline, baseline);
    assert.equal(inputs.observed, observed);
    calls.push(['check']);
  },
};

const sentinel = source.slice(source.indexOf('function sentinel('), source.indexOf('// Diagnostics run'));
const collection = main.slice(
  main.indexOf("  const indexed = tools.merge('swift-coverage-profile'"),
  main.indexOf("  record('coverage-summary.json'"),
);
runInNewContext(
  sentinel + 'const zeroProfileInput = sentinel(scratch, run, record, tools);\n' + collection,
  sandbox,
);
assert.deepEqual(calls[0], ['left-sentinel-profile', [leftRaw]]);
assert.deepEqual(calls.slice(-5), [
  ['swift-coverage-profile', measurements],
  ['swift-zero-profile', [leftRaw]],
  ['swift-zero-baseline', indexedPath('swift-zero-profile'), objects, pkg],
  ['swift-coverage', indexedPath('swift-coverage-profile'), objects, pkg],
  ['check'],
]);
console.log('Verified post-object baseline indexing, isolated sentinel input, and identical export objects');
