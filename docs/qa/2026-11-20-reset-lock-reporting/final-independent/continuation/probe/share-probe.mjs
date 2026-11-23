// One-off mechanism probe: does a FileShare.Read hold leave a file readable but undeletable?
import { spawn } from 'node:child_process';
import { constants, openSync, closeSync, readFileSync, unlinkSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = dirname(fileURLToPath(import.meta.url));
const f = join(dir, 'dummy.txt');
writeFileSync(f, 'disposable probe');
const ps = ["$ErrorActionPreference='Stop'", "$f=[System.IO.File]::Open($env:QA_HOLD_PATH,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::Read)", "[Console]::Out.WriteLine('{\"ready\":true}')", '[Console]::Out.Flush()', 'while ($true) { Start-Sleep -Seconds 5 }'].join('\n');
const sys = process.env.SystemRoot;
const child = spawn(join(sys, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { env: { SystemRoot: sys, windir: sys, PATH: join(sys, 'System32'), QA_HOLD_PATH: f, TEMP: dir, TMP: dir, USERPROFILE: dir, LOCALAPPDATA: dir, APPDATA: dir }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let out = '';
child.stdout.on('data', (d) => (out += d));
await new Promise((r) => { const t = setInterval(() => { if (out.includes('ready') || child.exitCode !== null) { clearInterval(t); r(); } }, 50); });
const res = { ready: out.trim() };
try { res.read = readFileSync(f, 'utf8'); } catch (e) { res.read = e.code; }
try { closeSync(openSync(f, constants.O_RDONLY | 0x10000000)); res.exlock = 'opened'; } catch (e) { res.exlock = e.code; }
try { unlinkSync(f); res.unlink = 'deleted'; } catch (e) { res.unlink = e.code; }
res.existsWhileHeld = existsSync(f);
child.kill('SIGKILL');
await new Promise((r) => child.on('exit', r));
try { unlinkSync(f); res.unlinkAfterRelease = 'deleted'; } catch (e) { res.unlinkAfterRelease = e.code; }
console.log(JSON.stringify(res));
