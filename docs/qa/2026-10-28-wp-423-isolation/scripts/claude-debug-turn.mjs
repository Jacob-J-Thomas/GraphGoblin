// One Claude CLI turn with the adapter's exact launch flags and restricted environment
// (packages/infrastructure/src/claude/policy.ts, environment.ts; read-only policy), plus the CLI's
// own --debug-file, to read what the CLI itself says it loaded: MCP servers, hooks, plugins,
// skills, memory files. --no-session-persistence keeps it from writing a session. The debug log is
// filtered to lines about those customizations and to process spawns, then redacted; it is not
// kept whole (it is the owner's CLI log).
//   node claude-debug-turn.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as L from './lib.mjs';

const rec = new L.Recorder('claude-debug-turn');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-423-claude-debug-'));
const debugFile = path.join(work, 'debug.txt');
const allowed = ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA'];
const env = {};
for (const name of allowed) {
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === name.toUpperCase());
  if (key) env[name] = process.env[key];
}
Object.assign(env, { DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' });
const args = [
  '--safe-mode', '--setting-sources', '', '--strict-mcp-config',
  '--restricted', '--tools', 'Read,Glob,Grep', '--permission-mode', 'dontAsk', '--permission-prompts', 'none',
  '--model', 'claude-haiku-5-5', '--effort', 'low',
  '--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json', '--print',
  '--no-session-persistence', '--debug-file', debugFile,
];
const watch = L.watchTree(process.pid);
await L.sleep(1500);
const child = spawn(path.join(os.homedir(), '.local', 'bin', 'claude.exe'), args, {
  cwd: work,
  env,
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stdin.end(
  JSON.stringify({ type: 'user', message: { role: 'user', content: 'Reply with exactly the word DONE and nothing else.' } }) + '\n',
);
const code = await new Promise((r) => child.on('close', r));
await L.sleep(800);
watch.stop();
const records = out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
const init = records.find((r) => r.type === 'system' && r.subtype === 'init') ?? {};
const result = records.find((r) => r.type === 'result') ?? {};
rec.turn({ harness: 'claude', model: 'claude-haiku-5-5', effort: 'low', label: 'debug-turn (direct CLI, adapter flags)' });
rec.log('exit and result', { code, subtype: result.subtype, result: result.result, isError: result.is_error });
rec.log('init: what the CLI reports it loaded', {
  model: init.model,
  mcp_servers: init.mcp_servers,
  plugins: (init.plugins ?? []).map((p) => p.name),
  skills: init.skills,
  tools: init.tools,
  slash_commands_count: (init.slash_commands ?? []).length,
  agents: init.agents,
  apiKeySource: init.apiKeySource,
  permissionMode: init.permissionMode,
});
const tree = watch.seen().filter((p) => p.pid !== child.pid);
rec.log('processes under this script during the turn (names, PIDs, parents)', [
  { pid: child.pid, name: 'claude.exe (turn)' },
  ...tree.filter((p) => p.ppid !== process.pid || p.pid === child.pid).map(({ pid, ppid, name }) => ({ pid, ppid, name })),
]);
const debug = fs.existsSync(debugFile) ? fs.readFileSync(debugFile, 'utf8') : '';
const wanted = /mcp|hook|plugin|skill|claude\.md|memory|spawn|ripgrep|\brg\b|where\.exe|reg\.exe|settings|customiz|safe.?mode|marketplace|agent/i;
const lines = debug.split('\n').filter((l) => wanted.test(l)).map((l) => l.slice(0, 240));
rec.log(`debug log: ${debug.split('\n').length} lines, ${lines.length} about customizations or spawns`);
for (const line of lines.slice(0, 120)) rec.log('debug', line);
fs.rmSync(work, { recursive: true, force: true, maxRetries: 10 });
rec.finish();
