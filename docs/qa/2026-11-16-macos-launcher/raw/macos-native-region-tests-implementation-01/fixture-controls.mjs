import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

const source = readFileSync(process.argv[2], 'utf8');
const statement = source.match(/^  const databaseURL = .*;$/mu)?.[0];
assert.ok(statement);
const makeURL = runInNewContext(statement + '\ndatabaseURL', {
  pathToFileURL: (path) => pathToFileURL(path, { windows: false }),
});
const database = '/private/fixture/GraphGoblin α%/graphgoblin.db';
assert.equal(makeURL(database), 'file://localhost/private/fixture/GraphGoblin%20%CE%B1%25/graphgoblin.db');
assert.equal(fileURLToPath(makeURL(database), { windows: false }), database);

const verifyFresh = source.slice(
  source.indexOf('  function expectFreshAbsent()'),
  source.indexOf("  install(\n    'installer-fresh-staged-assets-refusal'"),
);
const verifyStage = source.slice(
  source.indexOf('  for (const [label, releasePath]'),
  source.indexOf('  assert.equal(lstatSync(missing,'),
);
assert.ok(verifyFresh.includes('function expectFreshAbsent') && verifyStage.includes('rmdirSync(stage)'));
const assertions = Object.assign((...args) => assert(...args), assert, {
  deepEqual(actual, expected) {
    assert.deepEqual(structuredClone(actual), structuredClone(expected));
  },
});

function execute(scenario) {
  const stageName = '.graphgoblin-launcher-stage-' + 'a'.repeat(32);
  const stagePath = '/fixture/Applications/' + stageName;
  const previousStage = '.graphgoblin-launcher-stage-' + 'b'.repeat(32);
  const initialStages = [previousStage];
  const receiptsBefore = ['prior.json'];
  const apps = '/fixture/Applications';
  const fresh = apps + '/GraphGoblin QA unique.app';
  const data = '/fixture/store';
  const receiptRoot = '/fixture/receipts';
  const candidate = ['missing', 'alias', 'short', 'wrongMachO'];
  const capture = [];
  const removed = [];
  let created = false;
  let error;
  try {
    runInNewContext(verifyFresh + verifyStage, {
      assert: assertions, initialStages, receiptsBefore, apps, fresh, data, receiptRoot,
      missing: candidate[0], alias: candidate[1], short: candidate[2], wrongMachO: candidate[3],
      repo: '/fixture/repo',
      freshName: 'GraphGoblin QA unique.app',
      join: posix.join,
      stages: () => (created ? [...initialStages, stageName] : initialStages),
      install(label, repo, name, exit, stdout, stderr, env, { releasePath }) {
        assert.equal(exit, 1);
        assert.equal(stdout, '');
        assert.equal(stderr, 'The candidate bundle could not be staged and verified.\n');
        capture.push(releasePath);
        created = true;
      },
      identity() {
        return { device: '1', inode: '2' };
      },
      lstatSync(path) {
        if (path === stagePath) return { mode: 0o700 };
        if (scenario === 'unexpected-target' && path === fresh) return { mode: 0o600 };
        assert.ok(path === data || path === fresh);
        return undefined;
      },
      readdirSync(path) {
        if (path === receiptRoot) return [...receiptsBefore];
        assert.equal(path, stagePath);
        return scenario === 'foreign-stage-content' ? ['unknown'] : [];
      },
      rmdirSync(path) {
        assert.equal(path, stagePath);
        assert.ok(created);
        removed.push(path);
        created = false;
      },
    });
  } catch (failure) {
    error = failure;
  }
  return { candidate, capture, removed, error };
}

const closed = execute('closed');
assert.ifError(closed.error);
assert.deepEqual(closed.capture, closed.candidate);
assert.equal(closed.removed.length, 4);
const foreign = execute('foreign-stage-content');
assert.equal(foreign.error?.code, 'ERR_ASSERTION');
assert.equal(foreign.removed.length, 0);
const unexpected = execute('unexpected-target');
assert.equal(unexpected.error?.code, 'ERR_ASSERTION');
assert.equal(unexpected.capture.length, 1);
console.log('Verified local database URL encoding and rejected unexpected targets or foreign stage content');
