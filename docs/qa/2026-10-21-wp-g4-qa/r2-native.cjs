// Owns one freshly created disposable native API store and all of its child processes.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const root = process.cwd();
const out = path.join(root, 'docs/qa/2026-10-21-wp-g4-qa');
let store, server;
const evidence = {
  head: '5d2783359dbcb95aa719146416f02dc303cbd1ed',
  node: process.version,
  port: 5641,
  stages: [],
};
function clean(s) {
  return s
    .replaceAll(root, '<worktree>')
    .replaceAll(root.replaceAll('\\', '/'), '<worktree>')
    .replaceAll(os.tmpdir(), '%TEMP%')
    .replaceAll(process.env.USERPROFILE, '%USERPROFILE%')
    .replace(/\bgg_[A-Za-z0-9_-]+/g, '[suppressed-key]');
}
function save() {
  fs.writeFileSync(
    path.join(out, 'r2-native-lifecycle.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  );
}
async function command(exe, args, env, secret = false) {
  const displayed = args;
  let transport;
  if (exe === 'powershell.exe' && args.includes('-File')) {
    const script = args[args.indexOf('-File') + 1];
    transport = 'Reviewed PowerShell text via EncodedCommand; execution policy unchanged';
    args = [
      '-NoProfile',
      '-EncodedCommand',
      Buffer.from(fs.readFileSync(script, 'utf8'), 'utf16le').toString('base64'),
    ];
  }
  const c = spawn(exe, args, {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '',
    stderr = '';
  c.stdout.on('data', (x) => (stdout += x));
  c.stderr.on('data', (x) => (stderr += x));
  const [code, signal] = await once(c, 'exit');
  if (!secret)
    evidence.stages.push({
      transport,
      command: displayed.map((x) => clean(x)).join(' '),
      exit: code,
      signal,
      stdout: clean(stdout),
      stderr: clean(stderr),
    });
  save();
  if (code !== 0) throw Error('QA child failed: ' + clean(stderr));
  return stdout;
}
async function start(env) {
  const c = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  c.stdout.on('data', (x) => (logs += x));
  c.stderr.on('data', (x) => (logs += x));
  const deadline = Date.now() + 60000;
  while (true) {
    if (c.exitCode !== null) throw Error('API exited: ' + clean(logs));
    try {
      const r = await fetch('http://127.0.0.1:5641/healthz', { signal: AbortSignal.timeout(1000) });
      if (r.ok) break;
    } catch {}
    if (Date.now() > deadline) throw Error('Native API readiness timeout');
    await new Promise((r) => setTimeout(r, 100));
  }
  evidence.stages.push({ action: 'start-built-main', pid: c.pid, health: 'ok', log: clean(logs) });
  save();
  return c;
}
async function stop() {
  if (!server) return;
  const c = server;
  server = undefined;
  if (c.exitCode === null) {
    const ended = once(c, 'exit');
    c.kill('SIGKILL');
    await ended;
  }
  let refused = false;
  try {
    await fetch('http://127.0.0.1:5641/healthz', { signal: AbortSignal.timeout(1000) });
  } catch {
    refused = true;
  }
  evidence.stages.push({
    action: 'stop-owned-api',
    pid: c.pid,
    method: 'Fixture-owned process termination; no graceful-signal claim',
    healthRefused: refused,
  });
  save();
  if (!refused) throw Error('API still reachable after owned process stopped');
}
(async () => {
  const portCheck = net.createServer();
  await new Promise((resolve, reject) => {
    portCheck.once('error', reject);
    portCheck.listen(5641, '127.0.0.1', () => portCheck.close(resolve));
  });
  store = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-qa-129-r2-native-'));
  evidence.store = '%TEMP%\\' + path.basename(store);
  save();
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !k.toUpperCase().startsWith('GG_') && k.toUpperCase() !== 'JEV_API_KEY',
    ),
  );
  const env = {
    ...inherited,
    GG_DATA_DIR: store,
    GG_HOST: '127.0.0.1',
    GG_PORT: '5641',
    GG_LOG_LEVEL: 'warn',
    GG_CODEX_BINARY: path.join(store, 'disabled-codex.exe'),
    GG_CLAUDE_BINARY: path.join(store, 'disabled-claude.exe'),
    GG_JEV_API_KEY: '',
  };
  await command(
    process.execPath,
    ['apps/api/dist/main.js', '--create-api-key', 'qa-129-round-2'],
    env,
    true,
  );
  evidence.key = 'Created by built binary; token suppressed and never saved';
  server = await start(env);
  await command('powershell.exe', ['-NoProfile', '-File', path.join(out, 'r2-import.ps1')], env);
  await command(process.execPath, [path.join(out, 'r2-served-checks.cjs'), 'before'], env);
  await stop();
  await command('powershell.exe', ['-NoProfile', '-File', path.join(out, 'r2-amend.ps1')], env);
  server = await start(env);
  await command(process.execPath, [path.join(out, 'r2-served-checks.cjs'), 'after'], env);
  evidence.verdict = 'PASS';
})()
  .catch((e) => {
    evidence.verdict = 'FAIL';
    evidence.error = clean(e.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stop();
    if (store) {
      const absolute = path.resolve(store);
      if (
        path.dirname(absolute) !== path.resolve(os.tmpdir()) ||
        !path.basename(absolute).startsWith('gg-qa-129-r2-native-') ||
        fs.lstatSync(absolute).isSymbolicLink()
      )
        throw Error('Unsafe cleanup target');
      evidence.cleanup = {
        path: '%TEMP%\\' + path.basename(absolute),
        items: fs.readdirSync(absolute),
      };
      fs.rmSync(absolute, { recursive: true, force: true, maxRetries: 5 });
      evidence.cleanup.absent = !fs.existsSync(absolute);
    }
    save();
    console.log(
      JSON.stringify(
        {
          verdict: evidence.verdict,
          store: evidence.store,
          cleanup: evidence.cleanup,
          stages: evidence.stages.map((s) => ({
            action: s.action,
            exit: s.exit,
            stdout: s.stdout,
          })),
        },
        null,
        2,
      ),
    );
  });
