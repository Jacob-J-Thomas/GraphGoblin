// Tally every real provider invocation recorded by the live drivers' result files (from each run's
// durable harness.turn / decision.made events, plus the one direct CLI diagnostic).
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const files = [
  'attempts/lp1-attempt1-result.json',
  'lp1-result.json',
  'lp2-result.json',
  'lp-effort-result.json',
  'lp5-cli-diagnostic-result.json',
  'l1-own-session-result.json',
  'l2-missing-session-result.json',
  'c7-authoring-result.json',
];
const rows = [];
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(L.OUT, f), 'utf8'));
  for (const t of j.realTurns ?? []) {
    if (t.fake) continue;
    rows.push({ file: f, check: t.check, provider: t.provider, model: t.model, effort: t.effort, kind: t.kind, run: t.run ?? null, nodeId: t.nodeId ?? null, resume: t.resume ?? null });
  }
}
const by = (keyFn) => rows.reduce((m, r) => ((m[keyFn(r)] = (m[keyFn(r)] ?? 0) + 1), m), {});
const ledger = {
  total: rows.length,
  budget: 40,
  byProviderModelEffort: by((r) => `${r.provider} ${r.model} ${r.effort}`),
  byCheck: by((r) => r.check),
  invocations: rows,
};
fs.writeFileSync(path.join(L.OUT, 'turn-ledger.json'), JSON.stringify(ledger, null, 2) + '\n');
process.stdout.write(JSON.stringify({ total: ledger.total, byProviderModelEffort: ledger.byProviderModelEffort, byCheck: ledger.byCheck }, null, 2) + '\n');
