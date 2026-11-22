// Read-only summariser for one scenario's raw records. Usage: node analyze.mjs <scenario-id> [--write]
import fs from 'node:fs';
import path from 'node:path';

const RAW =
  'G:\\ggq\\delivery-evidence\\2026-11-17-five-intents\\i4-486-d215-independent-01\\qa\\raw';
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
          failureMessages: (a.failureMessages ?? []).map((m) => m.slice(0, 1600)),
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
    role: r.hasIpcChannel && /forks/.test(r.argv[0]) ? 'vitest-fork-worker' : /vitest/.test(r.argv[0]) ? 'vitest-main' : 'other',
    version: r.version,
    execPath: r.execPath,
    cwd: r.cwd,
    cwdRoot: r.cwdRoot,
    cwdDev: r.cwdDev,
    TEMP: r.TEMP,
    tmpdir: r.tmpdir,
    tmpdirRoot: r.tmpdirRoot,
    tmpdirDev: r.tmpdirDev,
    tmpdirRealpathNative: r.tmpdirRealpathNative,
    tmpdirRealpathJs: r.tmpdirRealpathJs,
    tmpdirLexicalEqualsPhysical: r.tmpdirLexicalEqualsPhysical,
    inheritedTemp: r.inheritedTemp,
    workerTempApplied: r.workerTempApplied,
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
  const ev = jsonl(`${id}.watch-${label}.jsonl`);
  if (!read(`${id}.watch-${label}.jsonl`) && ev.length === 0) continue;
  const tops = {};
  for (const e of ev) {
    if (!e.filename) continue;
    const parts = e.filename.split(/[\\/]/);
    const top = parts[0];
    tops[top] ??= { events: 0, files: new Set(), dirs: new Set(), maxDepth: 0, firstEvents: [] };
    const t = tops[top];
    t.events++;
    t.maxDepth = Math.max(t.maxDepth, parts.length);
    if (e.stateAtEvent?.startsWith('file')) t.files.add(e.filename);
    if (e.stateAtEvent === 'dir') t.dirs.add(e.filename);
    if (t.firstEvents.length < 12) t.firstEvents.push(`${e.eventType} ${e.filename} [${e.stateAtEvent}]`);
  }
  out.watch[label] = {
    totalEvents: ev.length,
    entries: Object.fromEntries(
      Object.entries(tops).map(([k, v]) => [
        k,
        {
          events: v.events,
          distinctFiles: v.files.size,
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
    temp: p.temp,
    watchDir: p.watchDir,
    preFixtureSha256: p.pre.fixture.sha256,
    postFixtureSha256: p.post.fixture.sha256,
    preStatus: p.pre.status,
    postStatus: p.post.status,
    preTempListing: p.pre.tempRootListing,
    postTempListing: p.post.tempRootListing,
    preLeftovers: p.pre.checkoutRelativeLeftovers,
    postLeftovers: p.post.checkoutRelativeLeftovers,
    workerTemp: p.workerTemp,
    preMainGTempListing: p.pre.mainGTempListing,
    postMainGTempListing: p.post.mainGTempListing,
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
console.log(text);
