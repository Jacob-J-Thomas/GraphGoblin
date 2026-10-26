// What does the Codex CLI the product pins send for each `model_reasoning_effort`? (#205 D1)
//
// Runs `codex exec` with exactly the argument shape the SDK builds for a turn, once per model and
// effort, with no credentials and no provider: an empty, disposable CODEX_HOME, no OPENAI_API_KEY
// or CODEX_API_KEY, every HTTP(S) proxy pointed at the closed local port 9, and the CLI's base URL
// pointed at a capture server on 127.0.0.1. The capture server records the request path, model and
// `reasoning` object of each request and answers 400, so the CLI stops; nothing leaves the machine.
//
// Usage: node codex-effort-probe.mjs <codex.exe> <log file> <capture port> <model:effort> ...
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

const [binary, log, portText, ...cases] = process.argv.slice(2);
const port = Number(portText);
const redact = (text) =>
  String(text)
    .split(homedir())
    .join('%USERPROFILE%')
    .split(homedir().replaceAll('\\', '\\\\'))
    .join('%USERPROFILE%')
    .replace(new RegExp(hostname(), 'gi'), '%COMPUTERNAME%');
writeFileSync(log, '');
const note = (text) => appendFileSync(log, redact(text) + '\n');
const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_HOME', 'NO_PROXY'].includes(key.toUpperCase()),
  ),
);
const env = (home) => ({
  ...baseEnv,
  CODEX_HOME: home,
  HTTP_PROXY: 'http://127.0.0.1:9',
  HTTPS_PROXY: 'http://127.0.0.1:9',
  ALL_PROXY: 'http://127.0.0.1:9',
  NO_PROXY: '127.0.0.1',
});

let captured = [];
const server = createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => (body += chunk));
  request.on('end', () => {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = undefined;
    }
    captured.push({
      method: request.method,
      path: request.url,
      upgrade: request.headers.upgrade ?? null,
      model: parsed?.model ?? null,
      reasoning: parsed?.reasoning ?? null,
    });
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'capture server: request recorded', type: 'invalid_request_error' } }));
  });
});
server.on('upgrade', (request, socket) => {
  captured.push({ method: request.method, path: request.url, upgrade: request.headers.upgrade, model: null, reasoning: null });
  socket.end('HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\n\r\n');
});
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

note(`node ${process.version}`);
const versionHome = mkdtempSync(join(tmpdir(), 'gg-af-codex-home-'));
const version = spawnSync(binary, ['--version'], { env: env(versionHome), windowsHide: true, encoding: 'utf8' });
rmSync(versionHome, { recursive: true, force: true });
note(`$ codex --version\nexit ${version.status}: ${version.stdout.trim()}`);

for (const entry of cases) {
  const [model, effort] = entry.split(':');
  const home = mkdtempSync(join(tmpdir(), 'gg-af-codex-home-'));
  const cwd = mkdtempSync(join(tmpdir(), 'gg-af-codex-cwd-'));
  // The SDK's CodexExec.run order: exec, --experimental-json, the base URL override, --model,
  // --sandbox, the repository-check opt-out, then --config model_reasoning_effort="<level>".
  const args = [
    'exec',
    '--experimental-json',
    '--config',
    `openai_base_url="http://127.0.0.1:${port}/v1"`,
    '--model',
    model,
    '--sandbox',
    'read-only',
    ['--skip', 'git', 'repo', 'check'].join('-'),
    '--config',
    `model_reasoning_effort="${effort}"`,
    '--config',
    'approval_policy="never"',
  ];
  captured = [];
  const started = Date.now();
  const child = spawn(binary, args, { cwd, env: env(home), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  child.stdin.end('Probe only; no provider call');
  const timer = setTimeout(() => child.kill(), 45_000);
  const [code, signal] = await new Promise((resolve) => child.once('exit', (c, s) => resolve([c, s])));
  clearTimeout(timer);
  rmSync(home, { recursive: true, force: true, maxRetries: 5 });
  rmSync(cwd, { recursive: true, force: true, maxRetries: 5 });
  const posts = captured.filter((c) => c.method === 'POST');
  note(
    `\n$ codex ${args.join(' ')}\nexit ${code}${signal ? ` signal ${signal}` : ''} after ${Date.now() - started} ms\n` +
      `captured ${captured.length} request(s); first POST: ${JSON.stringify(posts[0] ?? null)}\n` +
      `distinct reasoning sent: ${JSON.stringify([...new Set(posts.map((p) => JSON.stringify(p.reasoning)))])}\n` +
      output
        .split(/\r?\n/)
        .filter((line) => line && !line.includes('could not create PATH aliases'))
        .slice(0, 6)
        .join('\n'),
  );
}
server.close();
