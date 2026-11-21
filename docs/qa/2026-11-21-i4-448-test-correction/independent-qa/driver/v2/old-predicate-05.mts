// QA448 run 05: scratch-only old-predicate control against captured real before/after observations.
// Reads only retained evidence: run-04 helper-map manifests + blobs, and run-03b helper-read records +
// observer blobs from the actual candidate test execution. Blob hashes are re-verified before use.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const Q = 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-448-test-independent-01';
const DRIVER = join(Q, 'driver', 'v2');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const run04 = JSON.parse(readFileSync(join(Q, 'observations', '04-sqlite.json'), 'utf8'));

// The generated verbatim modules must be the exact ones used in run 04.
const modules: Record<string, string> = {};
for (const [name, expected] of [
  ['candidate-helper.mts', run04.generated.candidate.moduleSha256],
  ['old-predicate.mts', run04.generated.parent.moduleSha256],
]) {
  const actual = sha(readFileSync(join(DRIVER, 'generated', name)));
  if (actual !== expected) throw new Error(`${name} changed since run 04`);
  modules[name] = actual;
}
const helper = await import(pathToFileURL(join(DRIVER, 'generated', 'candidate-helper.mts')).href);
const old = await import(pathToFileURL(join(DRIVER, 'generated', 'old-predicate.mts')).href);

function load(blobDir: string, entries: Record<string, { sha256: string; size: number }>) {
  const map: Record<string, Buffer> = {};
  for (const [name, { sha256: digest, size }] of Object.entries(entries)) {
    const buf = readFileSync(join(blobDir, `${digest}.bin`));
    if (sha(buf) !== digest || buf.length !== size) throw new Error(`blob mismatch ${digest}`);
    map[name] = buf;
  }
  return map;
}
async function decide(fn: () => unknown) {
  try {
    await fn();
    return { decision: 'accept' };
  } catch (e: any) {
    return { decision: e?.name === 'AssertionError' ? 'reject' : 'error', error: `${e?.name}: ${String(e?.message).split('\n').slice(0, 12).join(' | ').slice(0, 600)}` };
  }
}
const describe = (m: Record<string, Buffer>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { size: v.length, sha256: sha(v) }]));
const out: any = { modules, cases: [] };

const blobs04 = join(Q, 'fixtures', 'blobs-04-sqlite');
for (const [name, s] of Object.entries(run04.scenarios) as [string, any][]) {
  const before = load(blobs04, s.before.helperMap);
  for (const point of ['immediate', 'settled']) {
    const after = load(blobs04, s[point].helperMap);
    out.cases.push({
      source: `run 04 ${name} (${point})`,
      dbFile: 'gateway.db',
      before: describe(before),
      after: describe(after),
      oldStrict: await decide(() => old.oldStrictOnCaptured(after, 'gateway.db', before)),
      candidateHelper: await decide(() => helper.expectStoreUnchanged('gateway.db', before, after)),
    });
  }
}

// The actual candidate test run (03b): the absent-WAL test's own helper samples, reconstructed from the
// observer's helper-read records (name/size/hash) and the independently saved blobs.
const events = readFileSync(join(Q, 'commands', '03b-ordinary-file-guard-observers.guard.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const analysis = JSON.parse(readFileSync(join(Q, 'observations', '03-analysis.json'), 'utf8'))['03b-ordinary-file-guard-observers'];
const absentFixture = analysis.fixtureToTest.find((f: any) => /initially absent WAL/.test(f.test)).fixture;
const blobs03 = join(Q, 'fixtures', 'blobs-03b-ordinary-file-guard-observers');
const samples: Record<string, { sha256: string; size: number }>[] = [];
for (const e of events) {
  if (e.event === 'snapshot' && e.reason === 'at-readdir' && e.snapshot.dir.endsWith(absentFixture)) samples.push({});
  if (e.event === 'helper-read' && e.path.includes(absentFixture)) {
    const n = e.path.split(/[\\/]/).pop();
    if (n.startsWith('gateway.db')) samples.at(-1)![n] = { sha256: e.sha256, size: e.size };
  }
}
if (!existsSync(blobs03)) throw new Error('03b blobs missing');
const inTest = samples.map((m) => load(blobs03, m));
for (let i = 1; i < inTest.length; i++) {
  out.cases.push({
    source: `run 03b actual candidate test "${analysis.fixtureToTest.find((f: any) => f.fixture === absentFixture).test}" fixture ${absentFixture}: sample 1 (before) vs sample ${i + 1}`,
    dbFile: 'gateway.db',
    before: describe(inTest[0]),
    after: describe(inTest[i]),
    oldStrict: await decide(() => old.oldStrictOnCaptured(inTest[i], 'gateway.db', inTest[0])),
    candidateHelper: await decide(() => helper.expectStoreUnchanged('gateway.db', inTest[0], inTest[i])),
  });
}

out.absentToEmptyCases = out.cases.filter((c: any) => !('gateway.db-wal' in c.before) && c.after['gateway.db-wal']?.size === 0);
out.verdict = {
  absentToEmptyObserved: out.absentToEmptyCases.length,
  oldRejectsAllAbsentToEmpty: out.absentToEmptyCases.every((c: any) => c.oldStrict.decision === 'reject'),
  helperAcceptsAllAbsentToEmpty: out.absentToEmptyCases.every((c: any) => c.candidateHelper.decision === 'accept'),
  otherCasesOldAccepts: out.cases.filter((c: any) => !out.absentToEmptyCases.includes(c)).every((c: any) => c.oldStrict.decision === 'accept'),
  otherCasesHelperAccepts: out.cases.filter((c: any) => !out.absentToEmptyCases.includes(c)).every((c: any) => c.candidateHelper.decision === 'accept'),
};
writeFileSync(join(Q, 'observations', '05-old-predicate.json'), JSON.stringify(out, null, 2));
for (const c of out.cases) console.log(`${c.source}\n   before=${JSON.stringify(Object.fromEntries(Object.entries(c.before).map(([k, v]: any) => [k, v.size])))} after=${JSON.stringify(Object.fromEntries(Object.entries(c.after).map(([k, v]: any) => [k, v.size])))} old=${c.oldStrict.decision} helper=${c.candidateHelper.decision}`);
console.log('first old-strict rejection message:', out.absentToEmptyCases[0]?.oldStrict.error);
console.log(JSON.stringify(out.verdict, null, 2));
process.exitCode = out.verdict.absentToEmptyObserved > 0 && out.verdict.oldRejectsAllAbsentToEmpty && out.verdict.helperAcceptsAllAbsentToEmpty && out.verdict.otherCasesHelperAccepts ? 0 : 1;
