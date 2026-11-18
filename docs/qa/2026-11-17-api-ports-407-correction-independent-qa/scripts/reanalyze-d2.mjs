// Offline re-derivation of D2 from the raw per-worker grant logs (independent of the in-test analyzer).
// Usage: node reanalyze-d2.mjs <runDir>
import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2];
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const A = read('D2-grants-A.json');
const B = read('D2-grants-B.json');
const sA = read('D2-summary-A.json');
const sB = read('D2-summary-B.json');
const all = [...A, ...B].map((g) => ({ ...g, g0: BigInt(g.tGrant), g1: BigInt(g.tRelCall), g2: BigInt(g.tRelDone) }));
const uuids = new Set(all.map((g) => g.uuid));
const gens = new Set(all.map((g) => g.gen));
// Pairwise cross-worker interval intersection test on [tGrant, tRelCall] (O(n*m), exhaustive).
let crossPairsChecked = 0;
let crossOverlaps = 0;
for (const a of all.filter((g) => g.role === 'A'))
  for (const b of all.filter((g) => g.role === 'B')) {
    crossPairsChecked++;
    if (a.g0 < b.g1 && b.g0 < a.g1) crossOverlaps++;
  }
// Same check on the wider [tGrant, tRelDone] window (release completion), informational.
let crossOverlapsToRelDone = 0;
for (const a of all.filter((g) => g.role === 'A'))
  for (const b of all.filter((g) => g.role === 'B')) if (a.g0 < b.g2 && b.g0 < a.g2) crossOverlapsToRelDone++;
const sortedGen = [...all].sort((x, y) => x.gen - y.gen);
const genTimeMonotone = sortedGen.every((g, i) => i === 0 || sortedGen[i - 1].g1 < g.g0);
const maxGen = Math.max(...gens);
const result = {
  attempts: { A: sA.attempts, B: sB.attempts, total: sA.attempts + sB.attempts },
  grants: { A: A.length, B: B.length, total: all.length },
  exhaustionRefusals: { A: sA.exhausted, B: sB.exhausted, total: sA.exhausted + sB.exhausted },
  unexpectedReservationErrors: sA.unexpectedReserve + sB.unexpectedReserve,
  releaseErrors: sA.releaseErrors + sB.releaseErrors,
  harnessFsErrors: sA.harnessFs + sB.harnessFs,
  attemptsAccounted: sA.attempts === sA.grants + sA.exhausted + sA.unexpectedReserve && sB.attempts === sB.grants + sB.exhausted + sB.unexpectedReserve,
  distinctPids: [...new Set(all.map((g) => g.pid))],
  uniqueGenerations: gens.size,
  uniqueMarkers: uuids.size,
  allMarkersUuid: all.every((g) => /^[0-9a-f-]{36}$/.test(g.uuid)),
  generationsContiguous1toN: gens.size === maxGen && Math.min(...gens) === 1,
  maxGen,
  ownershipFlagsAllTrue: all.every((g) => g.okAtGrant && g.okBefore && g.okAfter && g.relOk),
  crossPairsChecked,
  crossOverlapsGrantToReleaseCall: crossOverlaps,
  crossOverlapsGrantToReleaseDone_informational: crossOverlapsToRelDone,
  generationOrderMatchesTimeOrder: genTimeMonotone,
  contentionWindowMs: {
    overlapStart: Math.max(sA.began, sB.began),
    overlapEnd: Math.min(sA.ended, sB.ended),
    overlapMs: Math.min(sA.ended, sB.ended) - Math.max(sA.began, sB.began),
  },
  latencyMaxMs: { refusalA: sA.maxRefusalMs, refusalB: sB.maxRefusalMs, grantA: sA.maxGrantMs, grantB: sB.maxGrantMs },
};
console.log(JSON.stringify(result, null, 1));
