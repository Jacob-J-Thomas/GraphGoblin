// Portable, read-only evidence replay. Never calls init/finalize, tests, Git or a process.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SCHEMA,
  parseManifest,
  parseObservations,
  summarize,
  missingRequirements,
  bindingRequirements,
} from "./reader/windows-launcher-evidence.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(path.join(root, name));
const json = (name) => JSON.parse(read(name));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const source = "5d55926eb3451e5260edbfa9c634535ff10026c8";
const base = "8181f350028e284529c76b51927f32890afcb68a";
const tree = "142e832f9116451f8e40b14619cacffe3c2e9165";
const merge = "d10adbc595badd2d41162f1707fca177ff3954f9";
const run = 44703546329;
const inventory = (dir, prefix = "") =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const name = prefix + entry.name;
    assert.equal(lstatSync(path.join(dir, entry.name)).isSymbolicLink(), false);
    return entry.isDirectory()
      ? inventory(path.join(dir, entry.name), name + "/")
      : [name];
  });
assert.equal(process.argv.length, 2);
const manifest = json("evidence-manifest.json");
assert.equal(manifest.source, source);
assert.equal(manifest.base, base);
const names = inventory(root);
assert.deepEqual(
  names.filter((name) => name !== "evidence-manifest.json").sort(),
  manifest.files.map((row) => row.path).sort(),
);
for (const item of manifest.files) {
  assert.ok(path.resolve(root, item.path).startsWith(root + path.sep));
  const bytes = read(item.path);
  assert.equal(bytes.length, item.bytes);
  assert.equal(hash(bytes), item.sha256);
}
assert.equal(
  hash(read("reader/windows-launcher-evidence.mjs")),
  "33f2e0fd9070592ab9d201deff090bfa192ff140d1059e8a51035bf2e9bbc9d8",
);
const ci = json("hosted/ci-verified.original.json");
const nativeReceipt = json("hosted/windows-verified.original.json");
assert.deepEqual(
  [ci.head, ci.target, ci.testedMerge, ci.headTree, ci.testedTree, ci.run],
  [source, base, merge, tree, tree, run],
);
assert.equal(Object.keys(ci.jobs).length, 6);
assert.ok(
  Object.values(ci.jobs).every(
    (job) =>
      job.conclusion === "success" && job.failedOrCancelledSteps.length === 0,
  ),
);
assert.deepEqual(
  [ci.unitPassed, ci.unitSkipped, ci.browserPassed, ci.nativeWindowsPassed],
  [9982, 49, 488, 25],
);
assert.deepEqual(
  [
    nativeReceipt.head,
    nativeReceipt.base,
    nativeReceipt.merge,
    nativeReceipt.sourceTree,
    nativeReceipt.run,
  ],
  [source, base, merge, tree, run],
);
for (const [name, expected] of Object.entries(nativeReceipt.files))
  assert.equal(hash(read("hosted/native/" + name)), expected);
for (const [name, expected] of Object.entries(ci.coverage.members)) {
  const bytes = read("hosted/coverage/" + name);
  assert.equal(hash(bytes), expected.sha256);
  const total = JSON.parse(bytes).total;
  for (const metric of ["lines", "branches", "functions", "statements"])
    assert.equal(total[metric].pct, expected[metric]);
  assert.ok(total.lines.pct >= 90 && total.branches.pct >= 90);
}

const replayed = [];
for (const [folder, expectedStatus, expectedRecords] of [
  ["local-native/run-1", "native-failed", 222],
  ["local-native/run-2", "native-failed", 223],
  ["hosted/native", "complete", 255],
  ["coordinator/short-run-1", "native-failed", 205],
  ["coordinator/short-run-2", "native-failed", 224],
]) {
  const nativeManifest = parseManifest(read(folder + "/manifest.json"));
  const bytes = read(folder + "/observations.ndjson");
  const parsed = parseObservations(bytes, nativeManifest.evidenceId);
  assert.equal(parsed.state, "valid");
  const summary = summarize(parsed.records);
  const original = json(folder + "/result.json");
  const missing = [
    ...missingRequirements(summary),
    ...bindingRequirements(nativeManifest.binding),
  ];
  const status =
    original.steps.native === "success"
      ? missing.length === 0
        ? "complete"
        : "incomplete"
      : original.steps.native === "failure" ||
          original.steps.native === "cancelled"
        ? "native-failed"
        : original.steps.native === "skipped"
          ? "not-run"
          : "incomplete";
  const result = {
    schema: SCHEMA,
    evidenceId: nativeManifest.evidenceId,
    status,
    finalizedAt: original.finalizedAt,
    steps: original.steps,
    observations: {
      state: parsed.state,
      reason: parsed.reason,
      bytes: bytes.length,
      records: summary.records,
      closed: summary.closed,
      rejected: summary.rejected,
      omittedRecords: summary.omittedRecords,
      omittedBytes: summary.omittedBytes,
      byType: summary.byType,
    },
    cases: summary.cases,
    missing,
    uploaded: ["manifest.json", "result.json", "observations.ndjson"],
  };
  assert.deepEqual(result, original);
  assert.equal(result.status, expectedStatus);
  assert.equal(result.observations.records, expectedRecords);
  assert.equal(nativeManifest.binding.checkout.tree, tree);
  if (folder === "hosted/native") {
    assert.equal(nativeManifest.binding.checkout.head, merge);
    assert.equal(nativeManifest.binding.eventHead, source);
    assert.equal(nativeManifest.binding.eventBase, base);
    assert.equal(Number(nativeManifest.binding.runId), run);
  } else assert.equal(nativeManifest.binding.checkout.head, source);
  replayed.push({ folder, status, records: summary.records });
}

const evidence = json("evidence.json");
assert.equal(evidence.source, source);
assert.equal(evidence.ordinaryLocalNativeOutcome, "native-failed");
assert.deepEqual(
  evidence.ordinaryQa.focusedSuites.map((suite) => suite.passed),
  [95, 95],
);
assert.deepEqual(
  evidence.ordinaryQa.nativeRuns.map((item) => [
    item.tap.counts.pass,
    item.tap.counts.fail,
    item.tap.counts.cancelled,
  ]),
  [
    [17, 6, 2],
    [20, 5, 0],
  ],
);
const trials = evidence.ordinaryQa.nativeRuns.flatMap(
  (item) => item.contentionTrials,
);
assert.equal(trials.length, 6);
assert.ok(
  trials.every(
    (item) =>
      item.contention.acquired === 1 &&
      item.contention.refused === 4 &&
      item.ownershipCheck.liveOwners === 1 &&
      item.ownershipCheck.recordedOwnerMatched &&
      item.ownershipCheck.seededMarker === "absent" &&
      item.cleanup.released === 1 &&
      item.cleanup.unrelatedIntact,
  ),
);
assert.equal(evidence.ordinaryQa.tapRecorderMismatch.tap, "cancelledByParent");
assert.equal(
  evidence.ordinaryQa.tapRecorderMismatch.laterRecorder.result,
  "pass",
);
assert.equal(evidence.supersededWorkers.certifiedTerminalQa, false);
const old = json("earlier-held/independent/corrected/full-run-01.json");
assert.deepEqual(
  [
    old.summary.candidate.total,
    old.summary.candidate.pass,
    old.summary.candidate.fail,
  ],
  [649, 648, 1],
);
const audio = json("audio-comparison.json");
assert.deepEqual(
  audio.records.map((row) => row.sha).sort(),
  [base, source].sort(),
);
assert.ok(audio.records.every((row) => row.exit === 0));
assert.equal(new Set(audio.records.map((row) => row.testSha256)).size, 1);
const serial = json("serial-api-result.json");
assert.equal(serial.source, source);
assert.equal(serial.projection.exit, 0);
assert.equal(serial.projection.oneWorkerFlagObserved, true);
assert.deepEqual(serial.projection.emittedTotals.tests, {
  failed: 0,
  passed: 2119,
  skipped: 17,
  total: 2136,
});
assert.equal(serial.projection.coverageTotal.lines.pct, 95.51);
assert.equal(serial.projection.coverageTotal.branches.pct, 91.04);
const coordinator = json("coordinator-short-native.json");
assert.deepEqual(
  [
    coordinator.tap.tests,
    coordinator.tap.pass,
    coordinator.tap.fail,
    coordinator.nativeExit,
  ],
  [25, 22, 3, 1],
);
assert.equal(coordinator.nativeOutcome, "native-failed");
const coordinatorOs = json("coordinator-short-native-os.json");
assert.deepEqual(
  [
    coordinatorOs.tap.tests,
    coordinatorOs.tap.pass,
    coordinatorOs.tap.fail,
    coordinatorOs.nativeExit,
  ],
  [25, 23, 2, 1],
);
assert.equal(coordinatorOs.nativeOutcome, "native-failed");
for (const name of names.filter((name) => name.endsWith(".md"))) {
  for (const match of read(name)
    .toString("utf8")
    .matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const link = match[1].replace(/^<|>$/g, "");
    if (/^[a-z][a-z\d+.-]*:/i.test(link) || link.startsWith("#")) continue;
    assert.ok(
      existsSync(
        path.resolve(
          root,
          path.dirname(name),
          decodeURIComponent(link.split("#")[0]),
        ),
      ),
      `${name}: ${link}`,
    );
  }
}
console.log(
  JSON.stringify({
    verified: true,
    source,
    run,
    files: manifest.files.length,
    replayed,
    earlierFailureRetained: true,
    coordinatorPublicationReview: "pending",
  }),
);
