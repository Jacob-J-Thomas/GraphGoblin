// Correction 01 (#496): analyse the bounded native negative run and remove only the two QA-created
// junctions (the logs fixture's qa-linked-directory and the junction alias retained by the forced
// unverified release). Each is checked as a link with its exact expected target, then unlinked
// without recursion. Other fixtures are retained by design.
//
// Usage: node analyze-and-clean.mjs <checkout> <native-dir>
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [checkout, native] = process.argv.slice(2);
const exits = JSON.parse(readFileSync(join(native, 'exits.json'), 'utf8'));
const directory = join(native, 'runner-temp', exits.dir);
const result = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8'));
const records = readFileSync(join(directory, 'observations.ndjson'), 'utf8')
  .trimEnd()
  .split('\n')
  .map((line) => JSON.parse(line));
const canary = readFileSync(join(native, 'canary-seed.txt'), 'utf8').trim();
const of = (type) => records.filter((record) => record.type === type);
const closed = of('recorder-closed')[0];

// The author's unchanged verifier, with this run's canaries and TAP.
const verifier = join(native, '..', 'hosted', 'verify-evidence-bundle.py');
const verify = spawnSync(
  'python',
  ['-I', verifier, directory, '--tap', join(native, 'native.log'), '--expect-status', 'native-failed',
    '--expect-observations', 'valid', '--canary', canary, '--canary', `${canary}-ENV`,
    '--canary', `${canary}-PLAINENV`],
  { encoding: 'utf8' },
);
writeFileSync(join(native, 'verify.json'), verify.stdout);

const tap = readFileSync(join(native, 'native.log'), 'utf8');
const top = [...tap.matchAll(/^(ok|not ok) (\d+) - (.*)$/gm)].map((m) => [m[1], Number(m[2]), m[3]]);
const sub = [...tap.matchAll(/^ {4}(ok|not ok) (\d+) - (.*)$/gm)].map((m) => [m[1], Number(m[2]), m[3]]);
const analysis = {
  exits,
  status: result.status,
  observations: result.observations,
  missing: result.missing,
  steps: result.steps,
  verifierExit: verify.status,
  closed,
  checks: {
    exactlyOneRejectedAndItIsTheInjectedChild:
      of('rejected').length === 1 && of('rejected')[0].recordType === 'child' && closed?.rejected === 1,
    oneOverflowWithOmissions: of('overflow').length === 1 && closed?.omittedRecords > 0,
    contentionTrialsOnceEach: JSON.stringify(of('contention').map((r) => r.trial)) === '[1,2,3]',
    junctionRoundsOnceEach:
      JSON.stringify(of('alias-round').filter((r) => r.kind === 'junction').map((r) => r.spelling)) ===
      '["alias","direct"]',
    aliasRecords: of('alias').map((r) => [r.kind, r.disposition, r.failureStage, r.failureCode]),
    caseStartsUnique:
      new Set(of('case-start').map((r) => `${r.case}:${r.subtest}`)).size === of('case-start').length,
    noBindingContradiction: !result.missing.includes('binding-contradiction'),
    canaryAbsent: ['manifest.json', 'result.json', 'observations.ndjson'].every(
      (name) => !readFileSync(join(directory, name), 'utf8').includes(canary),
    ),
  },
  tap: { top, subtests: sub.length, failedSubtests: sub.filter(([s]) => s === 'not ok') },
};

// Cleanup of the two QA-created junctions only.
const fixture = (kind) => of('fixture-state').filter((record) => record.kind === kind);
const cleanup = [];
const unlinkLink = (path, expectedTarget) => {
  const entry = lstatSync(path, { throwIfNoEntry: false });
  const before = entry ? (entry.isSymbolicLink() ? 'link' : entry.isDirectory() ? 'directory' : 'other') : 'absent';
  let action = 'none';
  if (before === 'link') {
    const target = realpathSync.native(path);
    assert.ok(expectedTarget(target), `unexpected target for ${path}`);
    unlinkSync(path);
    action = 'unlinked';
  }
  cleanup.push({ path, before, action, after: existsSync(path) || lstatSync(path, { throwIfNoEntry: false }) ? 'present' : 'absent' });
};
const [logs] = fixture('logs');
if (logs) {
  const base = join(checkout, '.tmp', `windows-launcher-logs-${logs.fixture}`);
  unlinkLink(join(base, 'qa-linked-directory'), (target) =>
    target.startsWith(realpathSync.native(tmpdir())) && /qa496-linked-[A-Za-z0-9]{6}$/.test(target));
}
const [sandbox] = fixture('alias-sandbox');
const junctionFixture = of('fixture').find((record) => record.kind === 'alias-fixture');
if (sandbox && junctionFixture) {
  const parent = join(realpathSync.native(tmpdir()), `graphgoblin-launcher-alias-${sandbox.fixture}`);
  const name = readdirSync(parent).find((entry) => entry === `junction-${junctionFixture.fixture}`);
  if (name)
    unlinkLink(join(parent, name, 'checkout alias-α'), (target) => target === realpathSync.native(checkout));
}
analysis.cleanup = cleanup;
writeFileSync(join(native, 'analysis.json'), `${JSON.stringify(analysis, null, 2)}\n`);
console.log(JSON.stringify({ status: analysis.status, verifierExit: analysis.verifierExit, checks: analysis.checks, cleanup }, null, 2));
