// Bounded native spawn observation for #364 (attempt 2). Harmless Node executable only,
// disposable paths. Records error code/errno/syscall, whether error.path names the binary,
// stat outcomes and any stdio stream errors. Attempt 1 crashed on an unhandled stdio socket
// 'read ENOTCONN' error; this version attaches stream error handlers and logs each case first.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, stat, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

const handlers = process.argv.includes('--no-stream-handlers') ? false : true;
const only = process.argv.find((a) => a.startsWith('--case='))?.slice(7);
const root = await mkdtemp(join(tmpdir(), 'gg-364-native-'));
const results = [];
function start(binary, cwd) {
  return new Promise((done) => {
    const streamErrors = [];
    let child;
    try {
      child = spawn(binary, ['-e', 'process.stdout.write(process.cwd().length+"")'], { cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      done({ threw: true, code: error.code ?? null });
      return;
    }
    if (handlers)
      for (const name of ['stdin', 'stdout', 'stderr'])
        child[name]?.on('error', (error) => streamErrors.push({ stream: name, code: error.code ?? null, syscall: error.syscall ?? null }));
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    let spawnError;
    child.on('error', (error) => { spawnError = { code: error.code ?? null, errno: error.errno ?? null, syscall: error.syscall ?? null, errorPathIsBinary: error.path === binary, errorPathIsCwd: error.path === cwd }; setTimeout(() => done({ event: 'error', ...spawnError, streamErrors }), 100); });
    child.on('close', (code) => { if (!spawnError) setTimeout(() => done({ event: 'close', exitCode: code, childCwdLength: Number(out) || null, streamErrors }), 50); });
    child.stdin.end();
  });
}
async function observe(path) {
  try {
    const s = await stat(path);
    return { stat: 'ok', isDirectory: s.isDirectory(), isFile: s.isFile() };
  } catch (error) {
    return { stat: 'error', code: error.code ?? null };
  }
}
async function longDirectory(length) {
  let dir = join(root, 'long');
  while (dir.length < length - 21) dir = join(dir, 'segment-abcdefghij');
  dir = join(dir, 'x'.repeat(length - dir.length - 1));
  if (dir.length !== length) throw new Error('length mismatch ' + dir.length);
  await mkdir(dir, { recursive: true });
  return dir;
}
const node = process.execPath;
const valid = join(root, 'valid');
await mkdir(valid);
const file = join(root, 'a-file.txt');
await writeFile(file, 'x');
const cases = [
  ['control-valid', node, valid],
  ['cwd-missing', node, join(root, 'missing')],
  ['cwd-missing-parent', node, join(root, 'missing', 'child')],
  ['cwd-is-file', node, file],
  ['cwd-beneath-file', node, join(file, 'child')],
  ['binary-missing-abs', join(root, 'no-such-claude.exe'), valid],
  ['binary-missing-abs-cwd-missing', join(root, 'no-such-claude.exe'), join(root, 'missing')],
  ['binary-missing-bare', 'gg-364-no-such-binary', valid],
  ['binary-is-directory', valid, valid],
];
for (const length of [240, 258, 259, 260, 300]) cases.push([`cwd-long-${length}`, node, await longDirectory(length)]);
try {
  for (const [name, binary, cwd] of cases) {
    if (only && name !== only) continue;
    process.stderr.write('case ' + name + '\n');
    results.push({ name, cwdLength: cwd.length, cwdObservation: await observe(cwd), binaryObservation: binary.includes(sep) ? await observe(binary) : 'bare-name', spawn: await start(binary, cwd) });
  }
} finally {
  const resolved = await realpath(root);
  const base = await realpath(tmpdir());
  if (!resolved.startsWith(base + sep) || !resolved.includes('gg-364-native-')) throw new Error('refusing cleanup outside owned temp root');
  await rm(resolved, { recursive: true, force: true });
  process.stderr.write('cleaned ' + ((await observe(resolved)).code === 'ENOENT') + '\n');
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, streamHandlers: handlers, tmpdirLength: tmpdir().length, rootLength: root.length, results }, null, 1));
