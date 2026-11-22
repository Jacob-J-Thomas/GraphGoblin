// Command recorder for D203 independent QA. Runs one command with a process-local environment
// (Node 22.23.4 first on PATH, canonical backslash TEMP/TMP) and writes a receipt with argv, cwd,
// UTC times, exit code and stdout/stderr byte counts and SHA-256. Usage:
//   node record.mjs <label> <cwd> -- <command> [args...]
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EVIDENCE = dirname(dirname(fileURLToPath(import.meta.url)));
const NODE_DIR = 'C:\\Users\\98jak\\.claude\\codex-runs\\GraphGoblin\\runtime\\node-v22.23.4-win-x64';
const TEMP = 'G:\\ggq\\qa-scratch\\i4-364-deadline-independent-01';
const [label, cwd, sep, command, ...args] = process.argv.slice(2);
if (!label || !cwd || sep !== '--' || !command) {
  console.error('usage: record.mjs <label> <cwd> -- <command> [args...]');
  process.exit(2);
}
const dir = join(EVIDENCE, 'commands');
mkdirSync(dir, { recursive: true });
const base = join(dir, label);
if (existsSync(`${base}.receipt.json`)) {
  console.error(`refusing to overwrite existing receipt ${label}`);
  process.exit(2);
}
const env = {};
for (const [key, value] of Object.entries(process.env)) {
  if (/^(path|temp|tmp)$/i.test(key)) continue;
  env[key] = value;
}
const inheritedPath = Object.entries(process.env).find(([key]) => /^path$/i.test(key))?.[1] ?? '';
env.Path = `${NODE_DIR};${inheritedPath}`;
env.TEMP = TEMP;
env.TMP = TEMP;
env.NO_UPDATE_NOTIFIER = '1';
env.TURBO_TELEMETRY_DISABLED = '1';
env.GIT_OPTIONAL_LOCKS = '0';
const started = new Date();
const startedNs = process.hrtime.bigint();
const out = [];
const err = [];
const child = spawn(command, args, { cwd, env, shell: false, windowsHide: true });
child.stdout.on('data', (chunk) => out.push(chunk));
child.stderr.on('data', (chunk) => err.push(chunk));
let finished = false;
const finish = (exitCode, signal, spawnError) => {
  if (finished) return;
  finished = true;
  const ended = new Date();
  const stdout = Buffer.concat(out);
  const stderr = Buffer.concat(err);
  writeFileSync(`${base}.stdout`, stdout);
  writeFileSync(`${base}.stderr`, stderr);
  const digest = (buffer) => createHash('sha256').update(buffer).digest('hex');
  const receipt = {
    label,
    argv: [command, ...args],
    cwd,
    pid: child.pid ?? null,
    startedUtc: started.toISOString(),
    endedUtc: ended.toISOString(),
    elapsedMs: Number(process.hrtime.bigint() - startedNs) / 1e6,
    exitCode,
    signal: signal ?? null,
    ...(spawnError ? { spawnError: spawnError.code ?? String(spawnError) } : {}),
    stdout: { path: `${base}.stdout`, bytes: stdout.length, sha256: digest(stdout) },
    stderr: { path: `${base}.stderr`, bytes: stderr.length, sha256: digest(stderr) },
    processLocalEnvironment: {
      pathFirst: NODE_DIR,
      TEMP,
      TMP: TEMP,
      NO_UPDATE_NOTIFIER: '1',
      TURBO_TELEMETRY_DISABLED: '1',
      GIT_OPTIONAL_LOCKS: '0',
    },
    recorder: {
      path: fileURLToPath(import.meta.url),
      sha256: digest(readFileSync(fileURLToPath(import.meta.url))),
      node: process.version,
      execPath: process.execPath,
    },
  };
  writeFileSync(`${base}.receipt.json`, JSON.stringify(receipt, null, 2) + '\n');
  process.stdout.write(
    `${label}: exit ${exitCode} (${receipt.elapsedMs.toFixed(0)} ms) stdout ${stdout.length} B stderr ${stderr.length} B\n`,
  );
  process.exitCode = exitCode === 0 ? 0 : 1;
};
child.on('error', (error) => finish(null, null, error));
child.on('close', (code, signal) => finish(code, signal));
