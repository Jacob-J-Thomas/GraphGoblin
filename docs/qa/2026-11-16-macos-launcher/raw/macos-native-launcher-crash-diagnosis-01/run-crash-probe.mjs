import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = readFileSync(join(root, 'crash-probe.mjs'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const NODE = '/opt/homebrew/Cellar/node@22/22.22.2_2/bin/node';
const loader = "const{gunzipSync}=await import('node:zlib');const{createHash}=await import('node:crypto');" +
  "const b=gunzipSync(Buffer.from('" + gzipSync(source).toString('base64') + "','base64'),{maxOutputLength:32768});" +
  "if(createHash('sha256').update(b).digest('hex')!=='" + sha(source) + "')throw Error('Fixed probe SHA-256 mismatch');" +
  "await import('data:text/javascript;base64,'+b.toString('base64'));";
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const command = '/usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME=/Users/jake LANG=C LC_ALL=C ' +
  NODE + ' --input-type=module --eval ' + quote(loader);
const args = ['-F','none','-T','-i','C:/Users/98jak/.ssh/graphgoblin_qa_macmini_20261114',
  '-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','IdentityAgent=none','-o','PreferredAuthentications=publickey',
  '-o','PasswordAuthentication=no','-o','KbdInteractiveAuthentication=no','-o','NumberOfPasswordPrompts=0',
  '-o','HostKeyAlias=jakes-mac-mini.local','-o','UserKnownHostsFile=C:/Users/98jak/.ssh/known_hosts',
  '-o','StrictHostKeyChecking=yes','-o','UpdateHostKeys=no','-o','GlobalKnownHostsFile=none',
  '-o','ClearAllForwardings=yes','-o','ForwardAgent=no','-o','ForwardX11=no','-o','PermitLocalCommand=no',
  '-o','ConnectTimeout=8','-o','ConnectionAttempts=1','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2',
  'jake@10.0.0.85',command];
const preview = { argv: args, probeSha256: sha(source), probeBytes: source.length, commandSha256: sha(command),
  timeoutMs: 25_000, maxBuffer: 4 * 1024 ** 2, noAutomaticRetry: true };
if (process.argv.length === 3 && process.argv[2] === '--preview') {
  process.stdout.write(JSON.stringify(preview, null, 2) + '\n');
  process.exit(0);
}
if (process.argv.length !== 4 || process.argv[2] !== '--run' || process.argv[3] !== preview.commandSha256)
  throw Error('Expected --preview or --run with the inspected command SHA-256.');

const out = join(root, 'receipt');
mkdirSync(out);
const save = (name, bytes) => writeFileSync(join(out, name), bytes, { flag: 'wx', mode: 0o600 });
save('requested.json', JSON.stringify({ at: new Date().toISOString(), ...preview }, null, 2) + '\n');
let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), code = 0, signal = null, error = null;
try {
  stdout = execFileSync('C:/Windows/System32/OpenSSH/ssh.exe', args, {
    timeout: preview.timeoutMs, maxBuffer: preview.maxBuffer, windowsHide: true, stdio: ['ignore','pipe','pipe'],
  });
} catch (failure) {
  stdout = failure.stdout ?? stdout; stderr = failure.stderr ?? stderr;
  code = failure.status; signal = failure.signal; error = failure.code ?? failure.name;
}
save('stderr.raw', stderr);
let report, readbackFailure;
if (code === 0) {
  try {
    report = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stdout));
    if (report.schema !== 'gg456-launcher-crash-diagnosis/v1' || report.runId !== '54a825d1' ||
      report.pid !== 45243 || report.observedCrashAt !== '2026-11-16T21:04:14.740Z') throw Error('Unexpected diagnostic result binding');
    const match = report.crash?.report;
    if (match?.rawBase64 !== undefined) {
      const raw = Buffer.from(match.rawBase64, 'base64');
      const expected = '/Users/jake/Applications/GraphGoblin QA \u00fc-54a825d1.app/Contents/MacOS/GraphGoblin';
      if (report.crash.status !== 'exact-pid-time-bundle-match' || match.selected?.pid !== 45243 ||
        match.selected?.procPath?.normalize('NFC') !== expected || match.rawWithheld !== false ||
        match.bytes !== raw.length || raw.length > 2 * 1024 ** 2 ||
        sha(raw) !== match.sha256 || raw.toString('base64') !== match.rawBase64)
        throw Error('Pinned crash body failed local verification');
      save('GraphGoblin-45243.ips', raw);
      delete match.rawBase64;
      match.rawFile = 'GraphGoblin-45243.ips';
    }
    save('summary.json', JSON.stringify(report, null, 2) + '\n');
  } catch (failure) { readbackFailure = failure.message; }
}
const receipt = { at: new Date().toISOString(), code, signal, error, readbackFailure,
  stdoutBytes: stdout.length, stdoutSha256: sha(stdout), stderrBytes: stderr.length, stderrSha256: sha(stderr) };
save('receipt.json', JSON.stringify(receipt, null, 2) + '\n');
process.stdout.write(JSON.stringify({ receipt, summary: readbackFailure ? null : report }) + '\n');
if (code !== 0 || readbackFailure) process.exitCode = 1;

