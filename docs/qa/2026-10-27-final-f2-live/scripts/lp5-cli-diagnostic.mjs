// LP-5 diagnostic (one real Codex invocation, refused by the provider): run the SDK-bundled
// codex.exe 0.160.0 with the argv the SDK builds for the LP-5 node (gpt-6-luna, effort minimal,
// read-only, approval never, web search disabled, no network) and record what the CLI reports:
// each JSON event's type, the message of any error/turn.failed event, the stderr text and the exit
// code. This decides whether the provider's refusal reaches the SDK's event stream.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const rec = new L.Recorder('lp5-cli-diagnostic');
const exe = path.join(L.ROOT, 'node_modules', '.pnpm', '@openai+codex@0.160.0-win32-x64', 'node_modules', '@openai', 'codex', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
const dir = L.makeStore('lp5diag');
const args = [
  'exec',
  '--experimental-json',
  '--model',
  'gpt-6-luna',
  '--sandbox',
  'read-only',
  '--cd',
  dir,
  '--skip-git-repo-check',
  '--config',
  'model_reasoning_effort="minimal"',
  '--config',
  'sandbox_workspace_write.network_access=false',
  '--config',
  'web_search="disabled"',
  '--config',
  'approval_policy="never"',
];
try {
  rec.log('codex.exe argv (SDK shape)', { exe: path.relative(L.ROOT, exe), args: args.map((a) => (a === dir ? '<disposable dir>' : a)) });
  const child = spawn(exe, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end('Reply with exactly the word READY and nothing else.');
  let out = '';
  let err = '';
  child.stdout.on('data', (b) => (out += b));
  child.stderr.on('data', (b) => (err += b));
  const code = await new Promise((r) => child.on('exit', (c) => r(c)));
  const events = out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        const j = JSON.parse(l);
        const e = { type: j.type };
        if (j.type === 'error') e.message = String(j.message ?? '').slice(0, 600);
        if (j.type === 'turn.failed') e.message = String(j.error?.message ?? '').slice(0, 600);
        if (j.type === 'item.completed') e.itemType = j.item?.type;
        if (j.type === 'item.completed' && j.item?.type === 'error') e.message = String(j.item?.message ?? '').slice(0, 600);
        return e;
      } catch {
        return { type: 'unparsed', length: l.length };
      }
    });
  rec.turn({ check: 'LP-5 diagnostic', provider: 'codex', model: 'gpt-6-luna', effort: 'minimal', kind: 'direct-cli', fake: false });
  rec.log('CLI result', { exitCode: code, events, stderr: err.slice(0, 1500) });
  rec.observe('the JSON event stream carries the provider refusal', { turnFailed: events.filter((e) => e.type === 'turn.failed'), errors: events.filter((e) => e.type === 'error') });
} catch (error) {
  rec.check('diagnostic completed', false, String(error?.stack ?? error));
} finally {
  rec.finish();
  fs.rmSync(dir, { recursive: true, force: true });
}
