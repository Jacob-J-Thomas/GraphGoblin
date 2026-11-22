// Read-only summariser for one scenario's raw records (derived from reference-tools/analyze.mjs,
// sha256 ec78163c...). Changes: D216 RAW path; failure messages kept in full; worker TEMP/tap
// fields and instrumentation mode; failure line locations parsed from vitest's own stack text.
// Usage: node analyze.mjs <scenario-id> [--write]
import fs from 'node:fs';
import path from 'node:path';

const RAW =
  'G:\\ggq\\delivery-evidence\\2026-11-17-five-intents\\i4-486-d216-independent-02\\qa\\raw';
const id = process.argv[2];
const write = process.argv.includes('--write');
const read = (name) => {
  const p = path.join(RAW, name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined;
};
const jsonl = (name) =>
  (read(name) ?? '')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

const out = { id };
const report = read(`${id}.vitest.json`);
if (report) {
  const r = JSON.parse(report);
  out.vitest = {
    success: r.success,
    numTotalTestSuites: r.numTotalTestSuites,
    numTotalTests: r.numTotalTests,
    numPassedTests: r.numPassedTests,
    numFailedTests: r.numFailedTests,
    numPendingTests: r.numPendingTests,
    numTodoTests: r.numTodoTests,
    executed: r.testResults.flatMap((f) =>
      f.assertionResults
        .filter((a) => a.status !== 'skipped' && a.status !== 'pending')
        .map((a) => ({
          fullName: a.fullName,
          status: a.status,
          duration: a.duration,
          failureLocations: (a.failureMessages ?? []).flatMap((m) =>
            [...m.matchAll(/fs\.test\.ts:(\d+):(\d+)/g)].map((x) => `fs.test.ts:${x[1]}:${x[2]}`),
          ),
          failureMessages: a.failureMessages ?? [],
        })),
    ),
    skippedCount: r.testResults.flatMap((f) =>
      f.assertionResults.filter((a) => a.status === 'skipped' || a.status === 'pending'),
    ).length,
  };
}
const child = jsonl(`${id}.child.jsonl`);
out.processes = child
  .filter((r) => r.kind === 'process')
  .map((r) => ({
    pid: r.pid,
    ppid: r.ppid,
    role: r.isForkWorker
      ? 'vitest-fork-worker'
      : /vitest/.test(r.argv[0] ?? '')
        ? 'vitest-main'
        : 'other',
    argv0: r.argv[0],
    version: r.version,
    execPath: r.execPath,
    cwd: r.cwd,
    cwdRoot: r.cwdRoot,
    cwdDev: r.cwdDev,
    TEMP: r.TEMP,
    inheritedTemp: r.inheritedTemp,
    workerTempRequested: r.workerTempRequested,
    workerTempApplied: r.workerTempApplied,
    tmpdir: r.tmpdir,
    tmpdirRoot: r.tmpdirRoot,
    tmpdirDev: r.tmpdirDev,
    tmpdirRealpathNative: r.tmpdirRealpathNative,
    tmpdirRealpathJs: r.tmpdirRealpathJs,
    tmpdirLexicalEqualsPhysical: r.tmpdirLexicalEqualsPhysical,
    fixtureSha256AtStart: r.fixtureSha256AtStart,
    tapsInstalled: r.tapsInstalled,
  }));
out.taps = child
  .filter((r) => r.kind !== 'process')
  .map((r) => {
    const { t, pid, stack, ...rest } = r;
    return { ...rest, callSite: (stack ?? []).find((s) => /packages[\\/]/.test(s)) ?? stack?.[0] };
  });
out.watch = {};
for (const label of ['temp-physical-root', 'main-g-temp', 'checkout-package']) {
  const raw = read(`${id}.watch-${label}.jsonl`);
  if (raw === undefined) continue;
  const ev = jsonl(`${id}.watch-${label}.jsonl`);
  const tops = {};
  for (const e of ev) {
    if (!e.filename) continue;
    const parts = e.filename.split(/[\\/]/);
    const top = parts[0];
    tops[top] ??= { events: 0, files: new Set(), dirs: new Set(), maxDepth: 0, firstEvents: [] };
    const t = tops[top];
    t.events++;
    t.maxDepth = Math.max(t.maxDepth, parts.length);
    if (e.stateAtEvent?.startsWith('file')) t.files.add(`${e.filename} [${e.stateAtEvent}]`);
    if (e.stateAtEvent === 'dir') t.dirs.add(e.filename);
    if (t.firstEvents.length < 12)
      t.firstEvents.push(`${e.eventType} ${e.filename} [${e.stateAtEvent}]`);
  }
  const resultFiles = ev
    .filter((e) => e.filename && /nested[\\/]result\.txt$/.test(e.filename) && e.stateAtEvent?.startsWith('file'))
    .map((e) => `${e.filename} [${e.stateAtEvent}]`);
  out.watch[label] = {
    totalEvents: ev.length,
    watcherErrors: ev.filter((e) => e.watcherError).map((e) => e.watcherError),
    resultFileEvents: [...new Set(resultFiles)],
    entries:
      label === 'main-g-temp'
        ? { topLevelEntries: Object.keys(tops).length, events: ev.length }
        : Object.fromEntries(
            Object.entries(tops).map(([k, v]) => [
              k,
              {
                events: v.events,
                distinctFiles: [...v.files].sort(),
                distinctDirs: [...v.dirs].sort(),
                maxDepth: v.maxDepth,
                firstEvents: v.firstEvents,
              },
            ]),
          ),
  };
}
const prepost = read(`${id}.prepost.json`);
if (prepost) {
  const p = JSON.parse(prepost);
  out.prepost = {
    instrumentation: p.instrumentation,
    plan: p.plan,
    preFixtureSha256: p.pre.fixture.sha256,
    postFixtureSha256: p.post.fixture.sha256,
    preStatus: p.pre.status,
    postStatus: p.post.status,
    preTempListing: p.pre.tempRootListing,
    postTempListing: p.post.tempRootListing,
    preLeftovers: p.pre.checkoutRelativeLeftovers,
    postLeftovers: p.post.checkoutRelativeLeftovers,
    preMainGTempListingCount: p.pre.mainGTempListing?.length,
    postMainGTempListing: p.post.mainGTempListing,
  };
}
const swap = read(`${id}.swap.json`);
if (swap) {
  const s = JSON.parse(swap);
  out.swap = {
    beforeSwapSha256: s.beforeSwap.sha256,
    swappedSha256: s.swapped?.sha256,
    swappedIsBaseline: s.swappedIsBaseline,
    statusDuringSwap: s.statusDuringSwap,
    restoredSha256: s.restored.sha256,
    restoredIsCorrected: s.restoredIsCorrected,
    statusAfterRestore: s.statusAfterRestore,
    restoredAt: s.restoredAt,
  };
}
const inv = read(`${id}.invocation.json`);
if (inv) {
  const i = JSON.parse(inv);
  out.invocation = {
    command: i.command,
    exitCode: i.exitCode,
    timedOut: i.timedOut,
    started: i.started,
    ended: i.ended,
    env: i.env,
  };
}
const text = JSON.stringify(out, null, 1);
if (write) fs.writeFileSync(path.join(RAW, `${id}.summary.json`), text + '\n', { flag: 'wx' });
const worker = out.processes.find((p) => p.role === 'vitest-fork-worker');
console.log(
  JSON.stringify({
    id,
    exit: out.invocation?.exitCode,
    counts: out.vitest && [out.vitest.numTotalTests, out.vitest.numPassedTests, out.vitest.numFailedTests, out.vitest.skippedCount],
    executed: out.vitest?.executed.map((e) => [e.fullName.replace(/^.*uses real /, '').slice(0, 20), e.status, e.failureLocations[0]]),
    workerTemp: worker?.TEMP,
    workerFixture: worker?.fixtureSha256AtStart?.slice(0, 12),
    taps: out.taps.length,
    roles: out.processes.map((p) => p.role),
    resultFiles: out.watch['temp-physical-root']?.resultFileEvents.length,
    postTempListing: out.prepost?.postTempListing.length,
    postLeftovers: out.prepost?.postLeftovers,
  }),
);
