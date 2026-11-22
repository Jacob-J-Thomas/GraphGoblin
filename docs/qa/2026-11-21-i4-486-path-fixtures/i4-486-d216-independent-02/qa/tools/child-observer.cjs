'use strict';
// D215 independent QA child observer. Loaded only through a process-local NODE_OPTIONS --require
// in QA invocations. It never changes a return value: every tap calls the original builtin and
// returns its result unchanged. It writes only to the G-drive log named by QA_D215_LOG.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { syncBuiltinESMExports } = require('node:module');

const LOG = process.env.QA_D215_LOG;
if (LOG) {
  const write = (record) => {
    try {
      fs.appendFileSync(
        LOG,
        JSON.stringify({ t: new Date().toISOString(), pid: process.pid, ...record }) + '\n',
      );
    } catch {
      // Observation must never alter the observed process.
    }
  };
  const origRelative = path.relative;
  const origResolve = path.resolve;
  const origIsAbsolute = path.isAbsolute;
  const origJoin = path.join;
  const origMkdtempSync = fs.mkdtempSync;
  const origRealpathSync = fs.realpathSync;
  const origRealpathNative = fs.realpathSync.native;
  const safe = (fn) => {
    try {
      return fn();
    } catch (error) {
      return { error: String((error && error.code) || error) };
    }
  };
  const dev = (p) => safe(() => String(fs.statSync(p, { bigint: true }).dev));
  // Only the vitest fork worker executes test code. When QA_D215_WORKER_TEMP is set, that worker
  // (and only it) receives the C-drive TEMP/TMP here, before any vitest worker or test code runs;
  // the vitest main process keeps its G TEMP for its own transformed-module temp directory.
  const isForkWorker =
    typeof process.send === 'function' &&
    /vitest[\\/]dist[\\/]workers[\\/]forks\.js$/i.test(process.argv[1] || '');
  const inheritedTemp = { TEMP: process.env.TEMP, TMP: process.env.TMP };
  const workerTemp = process.env.QA_D215_WORKER_TEMP;
  let workerTempApplied = false;
  if (workerTemp && isForkWorker) {
    process.env.TEMP = workerTemp;
    process.env.TMP = workerTemp;
    workerTempApplied = true;
  }
  const tmp = os.tmpdir();
  const cwd = process.cwd();
  const fixture = process.env.QA_D215_FIXTURE;
  const isVitest = /vitest/i.test(process.argv[1] || '');
  const tap = process.env.QA_D215_TAP === '1' && isVitest;
  write({
    kind: 'process',
    ppid: process.ppid,
    execPath: process.execPath,
    version: process.version,
    platform: process.platform,
    arch: process.arch,
    argv: process.argv.slice(1, 4),
    execArgv: process.execArgv,
    hasIpcChannel: typeof process.send === 'function',
    isForkWorker,
    inheritedTemp,
    workerTempRequested: workerTemp,
    workerTempApplied,
    cwd,
    cwdRoot: path.parse(cwd).root,
    cwdDev: dev(cwd),
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    tmpdir: tmp,
    tmpdirRoot: path.parse(tmp).root,
    tmpdirDev: dev(tmp),
    tmpdirRealpathNative: safe(() => origRealpathNative(tmp)),
    tmpdirRealpathJs: safe(() => origRealpathSync(tmp)),
    tmpdirLexicalEqualsPhysical: safe(() => origRealpathNative(tmp) === tmp),
    fixturePath: fixture,
    fixtureSha256AtStart: fixture
      ? safe(() => crypto.createHash('sha256').update(fs.readFileSync(fixture)).digest('hex'))
      : undefined,
    tapsInstalled: tap,
  });
  if (tap) {
    const caller = () =>
      (new Error().stack || '')
        .split('\n')
        .slice(3, 9)
        .map((line) => line.trim());
    const mentions = (values, needle) =>
      values.some((value) => typeof value === 'string' && value.includes(needle));
    path.relative = function relative(from, to) {
      const out = origRelative.apply(this, arguments);
      if (mentions([from, to], 'gg-wp-'))
        write({
          kind: 'path.relative',
          from,
          to,
          fromRoot: path.parse(String(from)).root,
          toRoot: path.parse(String(to)).root,
          out,
          outIsAbsolute: origIsAbsolute(out),
          stack: caller(),
        });
      return out;
    };
    path.resolve = function resolve(...segments) {
      const out = origResolve.apply(this, segments);
      if (
        segments.length > 0 &&
        typeof segments[0] === 'string' &&
        !origIsAbsolute(segments[0]) &&
        mentions(segments, 'gg-wp-relative-')
      )
        write({ kind: 'path.resolve(relative input)', segments, out, stack: caller() });
      return out;
    };
    fs.mkdtempSync = function mkdtempSync(prefix) {
      const out = origMkdtempSync.apply(this, arguments);
      if (mentions([prefix], 'gg-wp-')) {
        const record = {
          kind: 'fs.mkdtempSync',
          prefix,
          out,
          outRoot: path.parse(String(out)).root,
          outDev: dev(out),
          outRealpathNative: safe(() => origRealpathNative(out)),
          stack: caller(),
        };
        if (process.env.QA_D215_OLD_CONTROL === '1' && String(prefix).includes('gg-wp-e3-')) {
          // The b812 fixtures derived their "relative" inputs from targets under this dataDir.
          const c = process.cwd();
          const adapterOld = origRelative(c, origJoin(out, 'relative'));
          const engineOld = origRelative(c, origJoin(out, 'user-owned'));
          record.oldCrossDriveControl = {
            cwd: c,
            adapterOldFormula: "relative(process.cwd(), join(dataDir, 'relative'))",
            adapterOld,
            adapterOldIsAbsolute: origIsAbsolute(adapterOld),
            engineOldFormula: "relative(process.cwd(), join(dataDir, 'user-owned'))",
            engineOld,
            engineOldIsAbsolute: origIsAbsolute(engineOld),
          };
        }
        write(record);
      }
      return out;
    };
    const realpathSync = function realpathSync(p) {
      const out = origRealpathSync.apply(this, arguments);
      if (mentions([p], 'gg-wp-'))
        write({ kind: 'fs.realpathSync', input: p, out, differs: out !== p, stack: caller() });
      return out;
    };
    realpathSync.native = origRealpathNative;
    fs.realpathSync = realpathSync;
    syncBuiltinESMExports();
  }
}
