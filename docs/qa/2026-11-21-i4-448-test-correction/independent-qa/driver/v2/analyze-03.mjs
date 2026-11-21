// QA448 analysis of runs 03a/03b. Uses only the raw guard/observer logs, the Vitest JSON report and the
// TCP poller logs. My contract predicate below is written from D194, independent of the candidate helper.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const Q = 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-448-test-independent-01';
const read = (f) => readFileSync(join(Q, f), 'utf8');
const jsonl = (f) => read(f).replace(/^\uFEFF/, '').split('\n').filter(Boolean).map((l) => JSON.parse(l.replace(/^\uFEFF/, '')));

function contract(before, after, dbName) {
  const b = Object.fromEntries((before.entries ?? []).map((e) => [e.name, e]));
  const a = Object.fromEntries((after.entries ?? []).map((e) => [e.name, e]));
  const reasons = [];
  if (!b[dbName]) reasons.push('no database in before state');
  if (!a[dbName]) reasons.push('database missing after');
  else if (b[dbName] && (a[dbName].sha256 !== b[dbName].sha256 || a[dbName].readSize !== b[dbName].readSize)) reasons.push('database bytes changed');
  const wal = `${dbName}-wal`;
  if (b[wal]) {
    if (!a[wal]) reasons.push('existing WAL removed');
    else if (a[wal].sha256 !== b[wal].sha256 || a[wal].readSize !== b[wal].readSize) reasons.push('existing WAL bytes changed');
  } else if (a[wal] && a[wal].readSize !== 0) reasons.push('new nonempty WAL');
  return { accept: reasons.length === 0, reasons };
}
const state = (s, dbName) => {
  if (s.error) return { error: s.error };
  const e = Object.fromEntries(s.entries.map((x) => [x.name, x]));
  const f = (n) => (e[n] ? { size: e[n].readSize ?? e[n].size, sha256: e[n].sha256, ...(e[n].wal && !e[n].wal.empty ? { frames: e[n].wal.frameCount, validFramePrefix: e[n].wal.validFramePrefix, commitFrames: e[n].wal.commitFramesInValidPrefix, pageSize: e[n].wal.pageSize, magic: e[n].wal.magic, headerChecksumValid: e[n].wal.headerChecksumValid } : {}), ...(e[n].dbHeader ? { walModeHeader: e[n].dbHeader.walModeHeader, pageCount: e[n].dbHeader.pageCount, fileChangeCounter: e[n].dbHeader.fileChangeCounter } : {}) } : 'absent');
  return { db: f(dbName), wal: f(`${dbName}-wal`), shm: f(`${dbName}-shm`) };
};

function analyze(label) {
  const events = jsonl(`commands/${label}.guard.jsonl`);
  const vitest = JSON.parse(read(`commands/${label}.vitest.json`));
  const tests = vitest.testResults.flatMap((f) => f.assertionResults.map((t) => ({ name: t.title, fullName: t.fullName, status: t.status, durationMs: t.duration })));
  const outbound = events.filter((e) => e.event === 'blocked' || e.event === 'attempt-observed');
  const installed = events.filter((e) => e.event === 'installed').map((e) => ({ pid: e.pid, ppid: e.ppid, entry: e.argv[1], layers: e.layers }));
  const out = {
    label,
    vitest: { numTotalTests: vitest.numTotalTests, numPassedTests: vitest.numPassedTests, numFailedTests: vitest.numFailedTests, success: vitest.success },
    tests,
    outboundAttempts: outbound.length,
    outboundDetail: outbound.map((e) => ({ pid: e.pid, kind: e.kind, target: e.target })),
    guardInstalled: installed,
    childSpawns: events.filter((e) => e.event === 'child-spawn').map((e) => ({ by: e.pid, file: e.file, guardInChildEnv: e.guardInChildEnv, args: (e.args ?? []).slice(1, 6) })),
    forwarded: events.filter((e) => e.event === 'forwarded').map((e) => ({ pid: e.pid, kind: e.kind })),
  };
  const fixtures = events.filter((e) => e.event === 'mkdtemp' && /gg-preflight-catalog-/.test(e.path)).map((e) => e.path);
  if (fixtures.length === 0) return out;
  out.fixtureToTest = fixtures.map((p, i) => ({ fixture: p.split(/[\\/]/).pop(), test: tests[i]?.name }));
  const probes = events.filter((e) => e.event === 'startup-chat-audio-probe');
  out.startupPaths = probes.map((e) => {
    const fixture = e.path.match(/gg-preflight-catalog-[^\\/]+/)[0];
    const frames = e.stack.filter((s) => /container\.ts|preflight-catalog\.test\.ts|chat-audio\.ts/.test(s)).map((s) => s.split('GraphGoblin').pop().replace(/\)$/, ''));
    return { fixture, test: tests[fixtures.findIndex((p) => p.endsWith(fixture))]?.name, frames };
  });
  // Per-test storage sequences from independent snapshots.
  const snaps = events.filter((e) => e.event === 'snapshot');
  const reads = events.filter((e) => e.event === 'helper-read');
  // Consistency: each helper read must equal the bytes in the immediately preceding independent snapshot of its dir.
  let consistent = 0;
  const inconsistent = [];
  for (const r of reads) {
    const prior = events.filter((e) => e.seq < r.seq && e.pid === r.pid && e.event === 'snapshot' && e.reason === 'at-readdir');
    const s = prior.at(-1);
    const name = r.path.split(/[\\/]/).pop();
    const entry = s?.snapshot.entries?.find((x) => x.name === name);
    if (entry && entry.sha256 === r.sha256 && entry.readSize === r.size) consistent++;
    else inconsistent.push({ path: r.path, sha256: r.sha256, snapshotSha: entry?.sha256 });
  }
  out.helperReadConsistency = { reads: reads.length, matchingIndependentSnapshot: consistent, inconsistent };
  out.perTest = fixtures.map((root, i) => {
    const id = root.split(/[\\/]/).pop();
    const mine = snaps.filter((s) => s.snapshot.dir.includes(id));
    const storeDirs = [...new Set(mine.filter((s) => s.reason === 'at-readdir' && !s.snapshot.error && s.snapshot.entries.some((x) => x.name === 'gateway.db')).map((s) => s.snapshot.dir))];
    return {
      test: tests[i]?.name,
      fixture: id,
      sequences: storeDirs.map((dir) => {
        const seq = mine.filter((s) => s.snapshot.dir === dir && s.reason === 'at-readdir');
        return { dir: dir.split(id).pop() || '.', states: seq.map((s) => ({ seq: s.seq, utc: s.snapshot.utc, ...state(s.snapshot, 'gateway.db') })) };
      }),
      finalBeforeRm: (() => {
        const r = mine.find((s) => s.reason === 'before-fixture-rm');
        return r ? state(r.snapshot, 'gateway.db') : undefined;
      })(),
      _raw: storeDirs.map((dir) => mine.filter((s) => s.snapshot.dir === dir && s.reason === 'at-readdir').map((s) => s.snapshot)),
    };
  });
  // Contract evaluation (my predicate). Tests 1-13: every later helper sample vs the first (before) sample.
  // Test 14 (negative controls): the explicit before/after pairs of the candidate's own sequence.
  out.contract = out.perTest.map((t, i) => {
    if (/rejects database changes/.test(t.test ?? '')) {
      const [root, frozen] = t._raw;
      const [A, B, C, D, E] = root;
      const [F, G, H, I] = frozen;
      const pairs = [
        ['absent', 'databaseMutation', A, B, false],
        ['absent', 'empty', A, C, true],
        ['empty', 'removedEmpty', C, D, false],
        ['absent', 'realFrames', A, E, false],
        ['empty', 'realFrames', C, E, false],
        ['frozenNonempty', 'walMutation', F, G, false],
        ['frozenNonempty', 'removedWal', F, H, false],
        ['frozenNonempty', 'truncatedWal', F, I, false],
      ];
      return {
        test: t.test,
        pairs: pairs.map(([b, a, sb, sa, expectAccept]) => {
          const c = contract(sb, sa, 'gateway.db');
          return { before: b, after: a, expectedAccept: expectAccept, myPredicateAccept: c.accept, reasons: c.reasons, agrees: c.accept === expectAccept };
        }),
      };
    }
    const seq = t._raw[0];
    return {
      test: t.test,
      before: state(seq[0], 'gateway.db'),
      afters: seq.slice(1).map((s) => ({ ...contract(seq[0], s, 'gateway.db'), state: state(s, 'gateway.db') })),
    };
  });
  for (const t of out.perTest) delete t._raw;
  return out;
}

const result = {};
for (const label of ['03a-ordinary-file-guard-only', '03b-ordinary-file-guard-observers']) {
  if (!existsSync(join(Q, 'commands', `${label}.guard.jsonl`))) continue;
  result[label] = analyze(label);
  const tcp = jsonl(`commands/${label}.tcp.jsonl`);
  result[label].nativeTcpPoller = {
    tracked: tcp.filter((e) => e.event === 'process-tracked').map((e) => `${e.name}/${e.pid}<-${e.ppid}`),
    rows: tcp.filter((e) => e.event === 'tcp-row' || e.event === 'udp-endpoint'),
    stop: tcp.find((e) => e.event === 'poller-stop'),
  };
}
writeFileSync(join(Q, 'observations', '03-analysis.json'), JSON.stringify(result, null, 2));
for (const [label, r] of Object.entries(result)) {
  console.log(`== ${label}: vitest ${r.vitest.numPassedTests}/${r.vitest.numTotalTests} success=${r.vitest.success}; outbound attempts=${r.outboundAttempts}; guard installed in ${r.guardInstalled.map((g) => g.pid + '<-' + g.ppid).join(', ')}; tcp rows=${r.nativeTcpPoller.rows.length}, tracked=${r.nativeTcpPoller.tracked.length}`);
  if (r.startupPaths) {
    console.log(`   startup paths: ${r.startupPaths.length}: ${r.startupPaths.map((s) => s.test).join(' | ')}`);
    console.log(`   helper reads consistent with independent snapshots: ${r.helperReadConsistency.matchingIndependentSnapshot}/${r.helperReadConsistency.reads}`);
    for (const c of r.contract) {
      if (c.pairs) {
        console.log(`   [${c.test}]`);
        for (const p of c.pairs) console.log(`      ${p.before} -> ${p.after}: expectedAccept=${p.expectedAccept} mine=${p.myPredicateAccept} agrees=${p.agrees} ${p.reasons.join('; ')}`);
      } else {
        const b = c.before;
        console.log(`   [${c.test}] before wal=${typeof b.wal === 'string' ? b.wal : b.wal.size + 'B'} shm=${typeof b.shm === 'string' ? b.shm : 'present'} db#${b.db.sha256?.slice(0, 8)} walModeHeader=${b.db.walModeHeader}; afters: ${c.afters.map((a) => `${a.accept ? 'ACCEPT' : 'REJECT ' + a.reasons.join('/')} (wal=${typeof a.state.wal === 'string' ? a.state.wal : a.state.wal.size + 'B#' + a.state.wal.sha256.slice(0, 6)}, shm=${typeof a.state.shm === 'string' ? a.state.shm : 'present'})`).join(', ')}`);
      }
    }
  }
}
