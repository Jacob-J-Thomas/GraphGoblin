import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const localRoot = fileURLToPath(new URL('.', import.meta.url));
const source = readFileSync(join(localRoot, 'drain-probe.mjs'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const remoteNode = '/opt/homebrew/Cellar/node@22/22.22.2_2/bin/node';
const compressed = gzipSync(source).toString('base64');
const loader = "const{gunzipSync}=await import('node:zlib');const{createHash}=await import('node:crypto');"
  + "const b=gunzipSync(Buffer.from('" + compressed + "','base64'),{maxOutputLength:32768});"
  + "if(createHash('sha256').update(b).digest('hex')!=='" + hash(source) + "')throw Error('Fixed probe SHA-256 mismatch');"
  + "await import('data:text/javascript;base64,'+b.toString('base64'));";
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const command = '/usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME=/Users/jake LANG=C LC_ALL=C '
  + remoteNode + ' --input-type=module --eval ' + quote(loader);
const args = ['-F', 'none', '-T', '-i', 'C:/Users/98jak/.ssh/graphgoblin_qa_macmini_20261114',
  '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none', '-o', 'PreferredAuthentications=publickey',
  '-o', 'PasswordAuthentication=no', '-o', 'KbdInteractiveAuthentication=no', '-o', 'NumberOfPasswordPrompts=0',
  '-o', 'HostKeyAlias=jakes-mac-mini.local', '-o', 'UserKnownHostsFile=C:/Users/98jak/.ssh/known_hosts',
  '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', '-o', 'GlobalKnownHostsFile=none',
  '-o', 'ClearAllForwardings=yes', '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no', '-o', 'PermitLocalCommand=no',
  '-o', 'ConnectTimeout=8', '-o', 'ConnectionAttempts=1', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2',
  'jake@10.0.0.85', command];
const preview = {
  commandSha256: hash(command), probeSha256: hash(source), probeBytes: source.length,
  argv: args, timeoutMs: 25000, maxBuffer: 12 * 1024 * 1024, noAutomaticRetry: true,
};
if (process.argv.length === 3 && process.argv[2] === '--preview') {
  console.log(JSON.stringify(preview, null, 2));
  process.exit(0);
}
if (process.argv.length !== 4 || process.argv[2] !== '--run' || process.argv[3] !== preview.commandSha256)
  throw Error('Expected --preview or --run with the inspected command SHA-256.');

const out = join(localRoot, 'receipt');
mkdirSync(out);
const write = (name, bytes) => writeFileSync(join(out, name), bytes, { flag: 'wx', mode: 0o600 });
write('requested.json', JSON.stringify({ at: new Date().toISOString(), ...preview }, null, 2) + '\n');
let stdout = Buffer.alloc(0);
let stderr = Buffer.alloc(0);
let code = 0;
let signal = null;
let error = null;
try {
  stdout = execFileSync('C:/Windows/System32/OpenSSH/ssh.exe', args, {
    timeout: preview.timeoutMs, maxBuffer: preview.maxBuffer, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (failure) {
  stdout = failure.stdout ?? stdout;
  stderr = failure.stderr ?? stderr;
  code = failure.status;
  signal = failure.signal;
  error = failure.code ?? failure.message;
}
write('stdout.raw', stdout);
write('stderr.raw', stderr);
let report;
let readbackFailure;
if (code === 0) {
  try {
    report = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stdout));
    if (report.schema !== 'gg456-owner-acceptance-drain-diagnosis/v1'
      || report.token !== 'b5423e10d95f472a91a67e784d6d954d')
      throw Error('Unexpected probe result binding.');
    const caps = { 'gateway.log': 4 * 1024 * 1024, 'gateway.log.1': 4 * 1024 * 1024,
      'launcher.log': 262144, 'launcher.log.1': 262144 };
    for (const [name, record] of Object.entries(report.logs?.files ?? {})) {
      if (!Object.hasOwn(caps, name)) throw Error('Unexpected raw log basename.');
      if (record.rawBase64 === undefined) continue;
      const raw = Buffer.from(record.rawBase64, 'base64');
      if (raw.length > caps[name] || raw.length !== record.bytes || hash(raw) !== record.sha256
        || raw.toString('base64') !== record.rawBase64)
        throw Error('Raw log size or digest mismatch: ' + name);
      write(name, raw);
      delete record.rawBase64;
    }
    write('summary.json', JSON.stringify(report, null, 2) + '\n');
  } catch (failure) { readbackFailure = failure.message; }
}
const receipt = { at: new Date().toISOString(), code, signal, error, readbackFailure,
  stdoutBytes: stdout.length, stdoutSha256: hash(stdout), stderrBytes: stderr.length, stderrSha256: hash(stderr) };
write('receipt.json', JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
if (report && !readbackFailure) console.log(JSON.stringify(report));
if (code !== 0 || readbackFailure) process.exitCode = 1;
