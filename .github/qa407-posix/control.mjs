import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { arch, platform, release } from 'node:os';
import { join, relative } from 'node:path';
import assert from 'node:assert/strict';

const binding = JSON.parse(readFileSync(new URL('./source-binding.json', import.meta.url)));
const evidence = process.env.GG_407_EVIDENCE;
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const save = (name, value) => writeFileSync(join(evidence, name + '.json'), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const range = { start: 18470, end: 18489 };
const suites = {
  maintained: { count: 13, files: ['apps/api/src/testing/api-port.test.ts'] },
  witness: { count: 2, files: ['apps/api/src/qa407-posix/owner.test.ts', 'apps/api/src/qa407-posix/peer.test.ts'] },
};

function verifySource() {
  const overlay = [
    '.github/qa407-posix/control.mjs',
    '.github/qa407-posix/owner.test.ts',
    '.github/qa407-posix/peer.test.ts',
    '.github/qa407-posix/run-suite.sh',
    '.github/qa407-posix/shared.ts',
    '.github/qa407-posix/source-binding.json',
    '.github/workflows/qa-407-posix-control.yml',
  ];
  const head = git('rev-parse', 'HEAD');
  const genealogy = git('rev-list', '--parents', '-n', '1', head).split(' ');
  const candidateGenealogy = git('rev-list', '--parents', '-n', '1', binding.candidate).split(' ');
  const diff = git('diff', '--name-status', binding.candidate, head).split('\n');
  const sources = binding.frozenSources.map(({ path }) => ({ path, sha256: sha256(path) }));
  save('source', {
    head, genealogy, candidateGenealogy, diff, sources,
    headTree: git('rev-parse', 'HEAD^{tree}'),
    candidateTree: git('rev-parse', binding.candidate + '^{tree}'),
    overlay: overlay.map((path) => ({ path, sha256: sha256(path) })),
    ref: process.env.GITHUB_REF,
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
    runner: { platform: platform(), arch: arch(), kernel: release(), image: process.env.ImageOS, imageVersion: process.env.ImageVersion },
    node: process.version,
    libuv: process.versions.uv,
    pnpm: execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim(),
  });
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.ok(['darwin', 'linux'].includes(platform()));
  assert.match(process.version, /^v22\./);
  assert.equal(process.env.GITHUB_EVENT_NAME, 'push');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/' + binding.branch);
  assert.equal(process.env.GITHUB_SHA, head);
  assert.deepEqual(genealogy, [head, binding.candidate]);
  assert.deepEqual(candidateGenealogy, [binding.candidate, binding.base]);
  assert.deepEqual(diff, overlay.map((path) => 'A\t' + path));
  assert.equal(git('status', '--porcelain', '--untracked-files=no'), '');
  assert.deepEqual(sources, binding.frozenSources);
}

async function tryBind(host, port) {
  const server = createServer((socket) => socket.destroy());
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    return { host, port, bound: true };
  } catch (error) {
    return { host, port, bound: false, errno: error.code ?? error.name };
  }
}

async function checkPorts(label) {
  assert.match(label, /^(maintained|witness)-(before|after)$/);
  assert.equal(process.env.GG_TEST_PORT_START, String(range.start));
  assert.equal(process.env.GG_TEST_PORT_COUNT, String(range.end - range.start + 1));
  const observations = [];
  for (let port = range.start; port <= range.end; port++) {
    for (const host of ['127.0.0.1', '0.0.0.0', '::']) {
      observations.push(await tryBind(host, port));
    }
  }
  const residue = readdirSync(process.env.TMPDIR);
  const knownResidue = residue.filter((entry) => /^gg-(api-ports|api-process|wp-c2-tests)-|^gg407-api-/.test(entry));
  save('ports-' + label, { range, observations, temporaryRoot: process.env.TMPDIR, knownResidue, entryCount: residue.length });
  assert.deepEqual(observations.filter(({ bound }) => !bound), [], 'Owned preflight/postflight native binds');
  assert.deepEqual(knownResidue, [], 'Temporary roots or fixture stores survived');
}

function verifyReport(suite) {
  const { count, files } = suites[suite];
  const result = JSON.parse(readFileSync(join(evidence, suite + '.json')));
  assert.equal(result.success, true);
  assert.equal(result.numTotalTests, count);
  assert.equal(result.numPassedTests, count);
  assert.equal(result.numFailedTests, 0);
  assert.equal(result.numPendingTests, 0);
  assert.equal(result.numTodoTests, 0);
  assert.deepEqual(result.testResults.map(({ name }) => relative(process.cwd(), name)).sort(), files);
  const assertions = result.testResults.flatMap(({ assertionResults }) => assertionResults);
  assert.equal(assertions.length, count);
  assert.ok(assertions.every(({ status }) => status === 'passed'));
}

assert.ok(evidence, 'Missing selected-evidence directory');
const [operation, argument] = process.argv.slice(2);
if (operation === 'source') verifySource();
else if (operation === 'build') {
  assert.equal(git('status', '--porcelain', '--untracked-files=no'), '');
  const paths = ['apps/api/dist/main.js', 'pnpm-lock.yaml'];
  save('build', { head: git('rev-parse', 'HEAD'), hash: paths.map((path) => ({ path, sha256: sha256(path) })) });
} else if (operation === 'ports') await checkPorts(argument);
else if (operation === 'report') verifyReport(argument);
else throw new Error('Unrecognized control operation');
