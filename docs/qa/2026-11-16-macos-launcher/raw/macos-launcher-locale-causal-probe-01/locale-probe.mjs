// The local wrapper prepends the exact Swift source as swiftBytes.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TOKEN = '73dce9cf70d04c5fbd3fccc16cf29337';
const NODE = '/opt/homebrew/Cellar/node@22/22.22.2_2/bin/node';
const NODE_SHA = 'e67e9c664f5b3d6d9fc0050ac895d8f30d213ce340c84439750edc9cc449d010';
const HOME = '/Users/jake', CACHE = HOME + '/Library/Caches', DEV = 16777232n;
const ROOT = HOME + '/Library/Logs/GraphGoblin/LauncherInstances/c908e6ef553d4cb4871644a9674a5c7b';
const valid = 'en_US.UTF-8', invalidLang = 'ggcanary17544768eaef/not-a-locale', invalidLC = 'ggcanary17544768eaef';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const must = (test, message) => { if (!test) throw Error(message); };
const stats = (path) => lstatSync(path, { bigint: true });
function privateDirectory(path) {
  const st = stats(path);
  must(st.isDirectory() && st.dev === DEV && st.uid === 501n && (st.mode & 0o077n) === 0n &&
    realpathSync(path) === path, 'unsafe private directory: ' + path);
  return st;
}
const save = (path, bytes) => writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });

function run(label, exe, args, cwd, env, timeoutMs) {
  const CAP = 64 * 1024, EOF = 2_000;
  const start = process.hrtime.bigint();
  const child = spawn(exe, args, { cwd, env, stdio: ['ignore','pipe','pipe'] });
  const receipt = { label, executable: exe, args, env, timeoutMs, pid: child.pid ?? null, exit: null,
    eof: { stdout: false, stderr: false }, received: { stdout: 0, stderr: 0 }, stopped: false, killSent: false };
  const parts = { stdout: [], stderr: [] };
  return new Promise((resolve) => {
    let done = false, drainTimer;
    const timer = setTimeout(() => {
      if (!receipt.exit && child.pid) {
        receipt.stopped = true;
        receipt.killSent = child.kill('SIGKILL');
      }
      drainTimer ??= setTimeout(finish, EOF);
    }, timeoutMs);
    function finish() {
      if (done) return;
      done = true; clearTimeout(timer); clearTimeout(drainTimer);
      child.stdout.destroy(); child.stderr.destroy(); child.unref();
      for (const [name, chunks] of Object.entries(parts)) {
        const observed = Buffer.concat(chunks);
        receipt[name] = { bytes: observed.length, sha256: sha(observed), base64: observed.toString('base64') };
      }
      receipt.ms = Number((process.hrtime.bigint() - start) / 1_000_000n);
      resolve(receipt);
    }
    child.on('exit', (code, signal) => { receipt.exit = { code, signal }; clearTimeout(timer); drainTimer ??= setTimeout(finish, EOF); });
    child.on('error', (e) => { receipt.error = e.code ?? e.name; drainTimer ??= setTimeout(finish, EOF); });
    child.once('close', finish);
    for (const name of Object.keys(parts)) {
      child[name].on('data', (chunk) => {
        const room = CAP - receipt.received[name];
        if (room > 0) parts[name].push(chunk.subarray(0, room));
        receipt.received[name] += chunk.length;
      });
      child[name].once('end', () => { receipt.eof[name] = true; });
      child[name].once('error', (e) => { receipt.pipeError = e.code ?? e.name; });
    }
  });
}
const complete = (row) => Boolean(row.exit) && !row.stopped && !row.error && !row.pipeError &&
  row.eof.stdout && row.eof.stderr && Object.values(row.received).every((size) => size <= 64 * 1024);

must(process.platform === 'darwin' && process.arch === 'arm64' && process.getuid() === 501 && process.geteuid() === 501 &&
  process.execPath === NODE && process.versions.node === '22.22.2' && stats(NODE).isFile() &&
  realpathSync(NODE) === NODE && stats(NODE).size === 84640n && sha(readFileSync(NODE)) === NODE_SHA, 'owner runtime drift');
must(privateDirectory(CACHE).ino === 48306n, 'cache parent drift');
const log = privateDirectory(ROOT);
const fixture = { version: 1, root: ROOT, device: BigInt.asUintN(64, log.dev).toString(), inode: BigInt.asUintN(64, log.ino).toString() };
const stage = join(CACHE, 'graphgoblin-456-locale-causal-' + TOKEN);
mkdirSync(stage, { mode: 0o700 });
privateDirectory(stage);
for (const name of ['tmp','home','modules']) mkdirSync(join(stage, name), { mode: 0o700 });
const source = join(stage, 'LocaleProbe.swift'), exe = join(stage, 'LocaleProbe');
save(source, swiftBytes);
const base = { HOME, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: join(stage, 'tmp'), LANG: valid, LC_ALL: valid };
const toolEnv = { ...base, HOME: join(stage,'home'), DEVELOPER_DIR: '/Library/Developer/CommandLineTools', XCRUN_NOCACHE: '1',
  CLANG_MODULE_CACHE_PATH: join(stage, 'modules') };
const XCRUN = '/usr/bin/xcrun';
const report = { schema: 'gg456-launcher-locale-causal-probe/v1', token: TOKEN, stage, sourceSha256: sha(swiftBytes),
  fixture, version: null, compile: null, cases: [], status: 'incomplete' };

const version = report.version = await run('swift-version', XCRUN, ['--sdk','macosx','swiftc','--version'], stage, toolEnv, 3_000);
if (complete(version) && version.exit.code === 0 && Buffer.from(version.stdout.base64, 'base64').toString('utf8').includes('Apple Swift version 6.3.1')) {
  const compile = report.compile = await run('compile', XCRUN,
    ['--sdk','macosx','swiftc','-O','-target','arm64-apple-macosx15.0','-module-cache-path',join(stage,'modules'),source,'-o',exe],
    stage, toolEnv, 60_000);
  if (complete(compile) && compile.exit.code === 0) {
    const st = stats(exe);
    must(st.isFile() && st.uid === 501n && st.dev === DEV && st.nlink === 1n &&
      realpathSync(exe) === exe && st.size <= 4n * 1024n * 1024n, 'unbound fixture executable');
    report.executableSha256 = sha(readFileSync(exe));
    for (const [label, serializer, LANG, LC_ALL] of [
      ['A-sorted-clean', 'sorted', valid, valid],
      ['B-sorted-both-invalid', 'sorted', invalidLang, invalidLC],
      ['C-unsorted-both-invalid', 'unsorted', invalidLang, invalidLC],
      ['D-typed-sorted-both-invalid', 'typed', invalidLang, invalidLC],
      ['E-sorted-invalid-lc-all', 'sorted', valid, invalidLC],
      ['F-sorted-invalid-lang', 'sorted', invalidLang, valid],
    ]) {
      const step = await run(label, exe, [serializer, fixture.root, fixture.device, fixture.inode], stage, { ...base, LANG, LC_ALL }, 5_000);
      step.serializer = serializer;
      step.exactDocument = false;
      if (complete(step) && step.exit.code === 0 && step.stderr.bytes === 0) {
        try {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(step.stdout.base64, 'base64'));
          const output = JSON.parse(text);
          step.exactDocument = text.endsWith('\n') && !text.slice(0,-1).includes('\n') && Object.keys(output).length === 4 &&
            Object.entries(fixture).every(([key, value]) => output[key] === value);
        } catch { /* keep actual raw result */ }
      }
      report.cases.push(step);
    }
    if (report.cases.every(complete)) report.status = 'compiled-six-native-cases-captured';
  }
}
save(join(stage, 'result.json'), JSON.stringify(report) + '\n');
process.stdout.write(JSON.stringify(report) + '\n');
if (report.status === 'incomplete') process.exitCode = 2;

