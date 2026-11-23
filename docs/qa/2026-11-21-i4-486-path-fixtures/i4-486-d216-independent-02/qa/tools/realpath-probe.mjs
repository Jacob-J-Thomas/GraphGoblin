// D216 independent QA: uninstrumented resolver probe (no --require, no wrappers, no mocks).
// Usage: node realpath-probe.mjs <label> <inputPath>
// Run with TEMP/TMP set by the runner to the spelling under test. Records, for the input, for
// os.tmpdir() and for one owned mkdtemp child (a dataDir analogue), the outputs of the JS
// fs.realpathSync, fs.realpathSync.native and fs/promises.realpath, plus followed dev/ino.
// The child and its marker file are removed before exit; removal is recorded.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const [label, input] = process.argv.slice(2);
const safe = async (fn) => {
  try {
    return { ok: await fn() };
  } catch (error) {
    return { error: String((error && error.code) || error) };
  }
};
const ident = (p) => {
  const s = fs.statSync(p, { bigint: true });
  return { dev: String(s.dev), ino: String(s.ino), birthtimeNs: String(s.birthtimeNs) };
};
const resolveAll = async (p) => {
  const r = {
    input: p,
    jsRealpathSync: await safe(() => fs.realpathSync(p)),
    nativeRealpathSync: await safe(() => fs.realpathSync.native(p)),
    promisesRealpath: await safe(() => fsp.realpath(p)),
    followedIdentity: await safe(() => ident(p)),
  };
  r.nativeEqualsPromises = r.nativeRealpathSync.ok !== undefined && r.nativeRealpathSync.ok === r.promisesRealpath.ok;
  r.jsEqualsInputLexical = r.jsRealpathSync.ok === p;
  r.nativeEqualsInputLexical = r.nativeRealpathSync.ok === p;
  r.jsEqualsNative = r.jsRealpathSync.ok === r.nativeRealpathSync.ok;
  if (r.nativeRealpathSync.ok) {
    r.nativeTargetIdentity = await safe(() => ident(r.nativeRealpathSync.ok));
    r.inputAndNativeSameDevIno =
      !!r.followedIdentity.ok &&
      !!r.nativeTargetIdentity.ok &&
      r.followedIdentity.ok.dev === r.nativeTargetIdentity.ok.dev &&
      r.followedIdentity.ok.ino === r.nativeTargetIdentity.ok.ino;
  }
  return r;
};
const out = {
  label,
  at: new Date().toISOString(),
  pid: process.pid,
  node: process.version,
  execPath: process.execPath,
  instrumentation: 'none: no NODE_OPTIONS require, no wrappers; builtins called directly',
  nodeOptionsPresent: Object.keys(process.env).some((k) => k.toUpperCase() === 'NODE_OPTIONS'),
  envTEMP: process.env.TEMP,
  envTMP: process.env.TMP,
  tmpdir: os.tmpdir(),
  cwd: process.cwd(),
};
out.inputRecord = await resolveAll(input);
out.tmpdirRecord = await resolveAll(os.tmpdir());
const child = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-probe-'));
out.childLexical = child;
out.childRecord = await resolveAll(child);
const marker = path.join(child, 'marker.txt');
fs.writeFileSync(marker, label);
const viaNative = out.childRecord.nativeRealpathSync.ok;
out.markerWrittenViaLexicalReadViaNative = viaNative
  ? fs.readFileSync(path.join(viaNative, 'marker.txt'), 'utf8') === label
  : false;
fs.unlinkSync(marker);
fs.rmdirSync(child);
out.childRemoved = !fs.existsSync(child);
out.childRemovedViaNativeSpellingAlsoAbsent = viaNative ? !fs.existsSync(viaNative) : null;
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
