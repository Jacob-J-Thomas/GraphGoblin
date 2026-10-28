// Task 1 of WP-423: how the pinned Codex CLI 0.160.0 lets one invocation switch off the user
// configuration's MCP servers, plugins, features, marketplaces and notify through `--config`.
// No model request reaches a provider: the probes are `codex mcp list --json`, `codex plugin list
// --json`, `codex plugin marketplace list`, `codex features list`, and `codex exec` against a local
// server that holds every request open (process-tree dry runs). It prints server and plugin names,
// enabled flags, feature states and process names/PIDs only: never commands, environments, paths
// of the owner's installs, or credentials. Temporary CODEX_HOME folders hold only a config.toml.
//   node cli-investigation.mjs <codex.exe>   (writes ../cli-investigation.log.txt)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { OUT, redact } from './lib.mjs';

const codex = process.argv[2];
const log = path.join(OUT, 'cli-investigation.log.txt');
fs.writeFileSync(log, '');
const write = (title, value) => {
  const text = `## ${title}\n${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`;
  fs.appendFileSync(log, redact(text));
  process.stdout.write(redact(text));
};
const configArgs = (overrides) => overrides.flatMap((o) => ['--config', o]);
const run = (args, options = {}) =>
  spawnSync(codex, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 64 << 20, ...options });
const firstError = (r) =>
  (r.stderr || r.stdout)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('WARNING'))
    .slice(0, 4)
    .join(' | ');

const mcp = (overrides, options) => {
  const r = run(['mcp', 'list', '--json', ...configArgs(overrides)], options);
  if (r.status !== 0) return { exit: r.status, error: firstError(r) };
  return JSON.parse(r.stdout).map((s) => `${s.name}:${s.enabled ? 'on' : 'off'}`);
};
const plugins = (overrides) => {
  const r = run(['plugin', 'list', '--json', ...configArgs(overrides)]);
  if (r.status !== 0) return { exit: r.status, error: firstError(r) };
  const installed = JSON.parse(r.stdout).installed ?? [];
  const byMarketplace = {};
  for (const p of installed)
    byMarketplace[p.marketplaceName] = (byMarketplace[p.marketplaceName] ?? 0) + (p.enabled ? 1 : 0);
  return { installed: installed.length, enabledByMarketplace: byMarketplace };
};
const marketplaces = (overrides) => {
  const r = run(['plugin', 'marketplace', 'list', ...configArgs(overrides)]);
  const lines = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines[0]?.startsWith('MARKETPLACE')
    ? { marketplaces: lines.slice(1).map((l) => l.split(/\s+/)[0]) }
    : { output: lines.join(' | ') };
};
const features = (overrides, names, options) => {
  const r = run(['features', 'list', ...configArgs(overrides)], options);
  const rows = Object.fromEntries(
    r.stdout
      .split('\n')
      .map((l) => l.trim().split(/\s{2,}/))
      .filter((c) => c.length >= 3)
      .map((c) => [c[0], c[c.length - 1]]),
  );
  return names ? Object.fromEntries(names.map((n) => [n, rows[n]])) : rows;
};

// 1. The switches the CLI documents.
write('codex --version', run(['--version']).stdout.trim());
const execHelp = run(['exec', '--help']).stdout;
write(
  'codex exec --help: configuration switches',
  execHelp
    .split('\n')
    .filter((l) => /^\s+(-c, --config|--enable|--disable|-p, --profile|--ignore-user-config|--strict-config)/.test(l))
    .map((l) => l.trim())
    .join('\n'),
);
write('codex exec --help: --ignore-user-config text', /--ignore-user-config\s+([^\n]+)/.exec(execHelp)?.[1]);

// 2. MCP servers.
for (const overrides of [
  [],
  ['mcp_servers={}'],
  ['mcp_servers=[]'],
  ['mcp_servers.node_repl.enabled=false'],
  ['mcp_servers.unknown_gg423.enabled=false'],
  ['mcp_servers.node_repl.enabled=false', 'mcp_servers.node_repl.enabled=true'],
  ['mcp_servers.node_repl.enabled=true', 'mcp_servers.node_repl.enabled=false'],
  ['mcp_servers.node_repl.enabled=false', 'mcp_servers.node_repl={enabled=true}'],
  ['features.apps=false'],
  ['features.plugins=false'],
  ['plugins."graphgoblin@graphgoblin-local".enabled=false'],
  ['plugins.graphgoblin@graphgoblin-local.enabled=false'],
  ['features.plugins=false', 'plugins.graphgoblin@graphgoblin-local.enabled=true'],
  ['features.plugins=false', 'features.apps=false', 'features.memories=false', 'features.hooks=false'],
  ['features.plugins=false', 'features.apps=false', 'features.memories=false', 'features.hooks=false', 'mcp_servers.node_repl.enabled=false'],
])
  write(`mcp list --json ${overrides.map((o) => `-c ${o}`).join(' ') || '(no override)'}`, mcp(overrides));

// 3. Plugins and marketplaces.
for (const overrides of [[], ['plugins={}'], ['features.plugins=false']])
  write(`plugin list --json ${overrides.map((o) => `-c ${o}`).join(' ') || '(no override)'}`, plugins(overrides));
for (const overrides of [[], ['marketplaces={}'], ['features.plugins=false']])
  write(`plugin marketplace list ${overrides.map((o) => `-c ${o}`).join(' ') || '(no override)'}`, marketplaces(overrides));

// 4. Features: the owner's effective state, the CLI's defaults (empty CODEX_HOME), and overrides.
const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-423-emptyhome-'));
const defaults = features([], undefined, { env: { ...process.env, CODEX_HOME: empty } });
const effective = features([]);
write(
  'features list: where the machine configuration differs from the CLI defaults (empty CODEX_HOME)',
  Object.fromEntries(
    Object.keys(effective)
      .filter((k) => effective[k] !== defaults[k])
      .map((k) => [k, { default: defaults[k], machine: effective[k] }]),
  ),
);
const watched = ['plugins', 'apps', 'memories', 'hooks', 'multi_agent', 'goals', 'code_mode_host', 'remote_plugin'];
write('features list (CLI defaults, empty CODEX_HOME)', Object.fromEntries(watched.map((n) => [n, defaults[n]])));
write('features list (machine configuration)', features([], watched));
write(
  'features list -c features.plugins=false -c features.apps=false -c features.memories=false -c features.hooks=false',
  features(['features.plugins=false', 'features.apps=false', 'features.memories=false', 'features.hooks=false'], watched),
);
fs.rmSync(empty, { recursive: true, force: true });

// 5. Project layer: `mcp list` reads a trusted project's .codex/config.toml from its own working
// directory; the top-level --cd does not change that; `exec` reads it from --cd.
const projectHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-423-projhome-'));
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-423-proj-'));
const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-423-elsewhere-'));
fs.mkdirSync(path.join(project, '.codex'));
fs.writeFileSync(
  path.join(projectHome, 'config.toml'),
  `[mcp_servers.home_server]\ncommand = "ping.exe"\nargs = ["-n", "40", "127.0.0.3"]\nstartup_timeout_sec = 30\n\n[projects.'${project}']\ntrust_level = "trusted"\n`,
);
fs.writeFileSync(
  path.join(project, '.codex', 'config.toml'),
  '[mcp_servers.project_server]\ncommand = "ping.exe"\nargs = ["-n", "40", "127.0.0.2"]\nstartup_timeout_sec = 30\n',
);
const projectEnv = { ...process.env, CODEX_HOME: projectHome };
write('project layer: mcp list --json run in the trusted project', mcp([], { cwd: project, env: projectEnv }));
write('project layer: mcp list --json run elsewhere', mcp([], { cwd: elsewhere, env: projectEnv }));
const topLevelCd = run(['-C', project, 'mcp', 'list', '--json'], { cwd: elsewhere, env: projectEnv });
write(
  'project layer: codex -C <project> mcp list --json run elsewhere',
  topLevelCd.status === 0 ? JSON.parse(topLevelCd.stdout).map((s) => s.name) : firstError(topLevelCd),
);

// 6. Process-tree dry runs: `exec` against a local server that holds every request open.
async function tree(overrides, { cwd, cdDir, env, port, settleMs = 9000 }) {
  const held = new Set();
  const server = createServer((socket) => {
    held.add(socket);
    socket.on('error', () => undefined);
    socket.pause();
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const args = [
    'exec',
    '--experimental-json',
    ...configArgs(overrides),
    ...configArgs([
      'model_provider="gg423hold"',
      'model_providers.gg423hold.name="gg423 local hold (no provider)"',
      `model_providers.gg423hold.base_url="http://127.0.0.1:${port}/v1"`,
      'model_providers.gg423hold.wire_api="responses"',
      'model_providers.gg423hold.request_max_retries=0',
      'model_providers.gg423hold.stream_max_retries=0',
    ]),
    '--model', 'gpt-6-luna',
    '--sandbox', 'read-only',
    '--cd', cdDir,
    '--skip-git-repo-check',
    '--ephemeral',
  ];
  const child = spawn(codex, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
  child.stdin.end('Reply OK.');
  await new Promise((r) => setTimeout(r, settleMs));
  const all = JSON.parse(
    spawnSync(
      'powershell.exe',
      ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 64 << 20 },
    ).stdout,
  );
  const out = [`codex.exe ${child.pid}`];
  const walk = (pid, depth) => {
    for (const p of all.filter((x) => x.ParentProcessId === pid && x.ProcessId !== pid)) {
      out.push(`${'  '.repeat(depth)}${p.Name} ${p.ProcessId}`);
      walk(p.ProcessId, depth + 1);
    }
  };
  walk(child.pid, 1);
  if (child.exitCode === null) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  for (const s of held) s.destroy();
  server.close();
  return out.join('\n');
}

const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-423-probe-'));
const isolation = ['features.plugins=false', 'features.apps=false', 'features.memories=false', 'features.hooks=false', 'notify=[]'];
write('dry run, machine configuration, no override', await tree([], { cwd: probe, cdDir: probe, env: process.env, port: 6318 }));
write('dry run, -c features.plugins=false only', await tree(['features.plugins=false'], { cwd: probe, cdDir: probe, env: process.env, port: 6318 }));
write('dry run, -c mcp_servers.node_repl.enabled=false only', await tree(['mcp_servers.node_repl.enabled=false'], { cwd: probe, cdDir: probe, env: process.env, port: 6318 }));
write('dry run, the isolation defaults and mcp_servers.node_repl.enabled=false', await tree(['mcp_servers.node_repl.enabled=false', ...isolation], { cwd: probe, cdDir: probe, env: process.env, port: 6318 }));
write(
  'dry run, temporary CODEX_HOME with a trusted project: exec --cd <project> from another process cwd (two ping.exe: home and project servers)',
  await tree([], { cwd: elsewhere, cdDir: project, env: projectEnv, port: 6318 }),
);
write(
  'dry run, temporary CODEX_HOME: exec --cd <elsewhere> from the project as process cwd (one ping.exe: home server only)',
  await tree([], { cwd: project, cdDir: elsewhere, env: projectEnv, port: 6318 }),
);
for (const dir of [projectHome, project, elsewhere, probe]) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
