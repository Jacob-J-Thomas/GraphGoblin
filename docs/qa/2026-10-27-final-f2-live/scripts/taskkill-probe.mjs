// F1-B1 precondition: does native `taskkill /T /F` work in this shell? Start one Node child that
// starts one Node grandchild, run taskkill /PID <child> /T /F, and check both PIDs with tasklist.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as L from './lib.mjs';

const rec = new L.Recorder('taskkill-probe');
const dir = L.makeStore('tkprobe');
const gcFile = path.join(dir, 'grandchild.pid');
const child = spawn(
  process.execPath,
  [
    '-e',
    `const cp=require('node:child_process');const g=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(gcFile)},String(g.pid));setInterval(()=>{},1000);`,
  ],
  { windowsHide: true, stdio: 'ignore' },
);
const exited = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })));
const grandchild = Number(await L.waitFile(gcFile));
rec.log('started', { child: child.pid, grandchild, os: os.release() });
rec.check('both alive before taskkill', L.tasklistAlive(child.pid) && L.tasklistAlive(grandchild), null);
let result;
try {
  const r = await promisify(execFile)('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 });
  result = { code: 0, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
} catch (e) {
  result = { code: e.code, stdout: String(e.stdout).trim(), stderr: String(e.stderr).trim() };
}
rec.log('taskkill result', result);
const exit = await Promise.race([exited, L.sleep(5000).then(() => null)]);
await L.sleep(500);
rec.check('taskkill /T /F exits 0', result.code === 0, result);
rec.check('child exited', exit !== null && !L.tasklistAlive(child.pid), exit);
rec.check('grandchild gone (tree kill)', !L.tasklistAlive(grandchild), { grandchild });
rec.finish();
fs.rmSync(dir, { recursive: true, force: true });
