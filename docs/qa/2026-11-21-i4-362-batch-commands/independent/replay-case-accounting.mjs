// Administrative replay of saved raw-data predicates. No product code or fixture is run.
// Run with Node 22: node --experimental-vm-modules replay-case-accounting.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const packet = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.join(packet, 'evidence');
const originalBuilder = path.join(evidence, 'fixtures', 'build-observations.mjs');
const originalObservations = path.join(evidence, 'observations.json');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readRecords = new Map();
let capturedOutput;
const consoleLines = [];

const confinedRead = (name, encoding) => {
  const absolute = path.resolve(name);
  assert(absolute.startsWith(evidence + path.sep), 'read must remain inside selected evidence');
  const bytes = fs.readFileSync(absolute);
  readRecords.set(path.relative(evidence, absolute).replaceAll('\\', '/'), { bytes: bytes.length, sha256: hash(bytes) });
  return encoding ? bytes.toString(encoding) : bytes;
};
const readOnlyFs = {
  readFileSync: confinedRead,
  writeFileSync(name, value) {
    assert.equal(path.resolve(name), originalObservations, 'builder may only emit observations');
    assert.equal(capturedOutput, undefined, 'exactly one captured write');
    capturedOutput = String(value); // Capture in memory; original evidence is never overwritten.
  },
};
const context = vm.createContext({
  process: { argv: ['node', originalBuilder, evidence] },
  console: { log: (...values) => consoleLines.push(values.map(String).join(' ')) },
});
const fsModule = new vm.SyntheticModule(['default'], function () { this.setExport('default', readOnlyFs); }, { context });
const pathModule = new vm.SyntheticModule(['default'], function () { this.setExport('default', path); }, { context });
const builderBytes = fs.readFileSync(originalBuilder);
const module = new vm.SourceTextModule(builderBytes.toString('utf8'), { context, identifier: originalBuilder });
await module.link((specifier) => {
  if (specifier === 'node:fs') return fsModule;
  if (specifier === 'node:path') return pathModule;
  throw new Error(`Unexpected module import: ${specifier}`);
});
await module.evaluate();
assert(capturedOutput);
const replay = JSON.parse(capturedOutput);
const saved = JSON.parse(fs.readFileSync(originalObservations, 'utf8'));
assert.equal(replay.cases.length, 64);
assert.equal(new Set(replay.cases.map((row) => row.id)).size, 64);
assert.deepEqual(replay.cases, saved.cases, 'every case including expected/actual/kind/result/evidence must reproduce');
assert.deepEqual(replay.summary, saved.summary);
assert.deepEqual(replay.source, saved.source);
assert.deepEqual(replay.runtime, saved.runtime);
const inventories = replay.cases.map((row) => ({
  id: row.id, kind: row.kind, tier: row.tier, evidenceTier: row.evidenceTier, result: row.result,
  evidence: row.evidence.map((rel) => {
    const bytes = confinedRead(path.join(evidence, rel));
    return { path: 'evidence/' + rel, bytes: bytes.length, sha256: hash(bytes) };
  }),
}));
const totals = replay.cases.reduce((o, row) => ((o[row.result] = (o[row.result] || 0) + 1), o), {});
assert.deepEqual(totals, { PASS: 63, 'OBSERVED-AS-PREDICTED': 1 });
const out = {
  schema: 'graphgoblin-qa-administrative-case-replay/1',
  scope: 'Original builder bytes evaluated in a VM with only confined evidence reads and one in-memory captured write. No product fixtures, native processes, engine/API, build, tests or provider are executed. The original builder and observations bytes remain unchanged.',
  runtime: process.version,
  originalBuilder: { path: 'evidence/fixtures/build-observations.mjs', sha256: hash(builderBytes) },
  originalObservations: { path: 'evidence/observations.json', sha256: hash(fs.readFileSync(originalObservations)) },
  comparison: { all64CasesIdentical: true, summaryIdentical: true, sourceBindingIdentical: true, runtimeBindingIdentical: true, ignoredField: 'generatedAt (administrative replay time)' },
  totals, typedCounts: replay.summary,
  uniqueCases: replay.cases.length,
  providerFinalWordingsPreserved: true,
  accountingClarification: '64 total records comprise 63 PASS records plus one adjacent-pre-existing-observation with result OBSERVED-AS-PREDICTED. The original report/provider wording 64 PASS overstates PASS by one and is preserved unchanged. No failure or assertion is waived by this clarification.',
  rawPredicateInputs: [...readRecords.entries()].map(([rel, value]) => ({ path: 'evidence/' + rel, ...value })),
  cases: inventories,
  originalBuilderConsole: consoleLines,
};
fs.writeFileSync(path.join(packet, 'case-accounting-replay.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ uniqueCases: out.uniqueCases, totals, typedCounts: out.typedCounts, all64CasesIdentical: true }));
