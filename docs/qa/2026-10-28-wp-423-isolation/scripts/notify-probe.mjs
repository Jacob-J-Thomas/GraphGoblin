// Does `codex exec` run the configured `notify` program at the end of a turn, and does
// `--config notify=[]` stop it? No provider call: a temporary CODEX_HOME holds only a config.toml
// whose `notify` runs a probe that records it ran, and a local server answers the CLI's model
// request with one completed assistant message.
//   node notify-probe.mjs <codex.exe> <port>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { redact } from './lib.mjs';

const [codex, portText] = process.argv.slice(2);
const port = Number(portText);
if (port < 6310 || port > 6319) throw new Error('port outside 6310-6319');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-423-notifyhome-'));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-423-notifywork-'));
const probe = path.join(home, 'notified.mjs');
fs.writeFileSync(
  probe,
  "import fs from 'node:fs'; import path from 'node:path';\n" +
    "fs.writeFileSync(path.join(path.dirname(process.argv[1]), `notified-${process.pid}.txt`), String(process.argv.length));\n",
);
const toml = (s) => `'${s}'`;
fs.writeFileSync(path.join(home, 'config.toml'), `notify = [${toml(process.execPath)}, ${toml(probe)}]\n`);

const sse = (type, body) => `event: ${type}\ndata: ${JSON.stringify({ type, ...body })}\n\n`;
const server = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    if (req.method === 'POST' && req.url.endsWith('/responses')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(sse('response.created', { response: { id: 'resp_gg423' } }));
      res.write(
        sse('response.output_item.done', {
          item: {
            type: 'message',
            role: 'assistant',
            id: 'msg_gg423',
            content: [{ type: 'output_text', text: 'OK' }],
          },
        }),
      );
      res.end(
        sse('response.completed', {
          response: {
            id: 'resp_gg423',
            usage: {
              input_tokens: 1,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens: 1,
              output_tokens_details: { reasoning_tokens: 0 },
              total_tokens: 2,
            },
          },
        }),
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });
});
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

function turn(extra) {
  const args = [
    'exec',
    '--experimental-json',
    ...extra.flatMap((o) => ['--config', o]),
    '--config', 'model_provider="gg423ok"',
    '--config', 'model_providers.gg423ok.name="gg423 local (no provider)"',
    '--config', `model_providers.gg423ok.base_url="http://127.0.0.1:${port}/v1"`,
    '--config', 'model_providers.gg423ok.wire_api="responses"',
    '--config', 'model_providers.gg423ok.request_max_retries=0',
    '--config', 'model_providers.gg423ok.stream_max_retries=0',
    '--model', 'gpt-6-luna',
    '--sandbox', 'read-only',
    '--cd', work,
    '--skip-git-repo-check',
    '--ephemeral',
  ];
  return new Promise((resolve) => {
    const child = spawn(codex, args, {
      env: { ...process.env, CODEX_HOME: home },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stdin.end('Reply OK.');
    child.on('close', (code) =>
      resolve({
        code,
        events: out
          .split('\n')
          .filter(Boolean)
          .map((l) => {
            try {
              return JSON.parse(l).type;
            } catch {
              return 'non-json';
            }
          }),
      }),
    );
  });
}

const notified = () => fs.readdirSync(home).filter((f) => f.startsWith('notified-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {};
results.userNotify = await turn([]);
await wait(3000);
results.userNotify.notifiedFiles = notified().length;
for (const f of notified()) fs.rmSync(path.join(home, f));
results.notifyCleared = await turn(['notify=[]']);
await wait(3000);
results.notifyCleared.notifiedFiles = notified().length;
server.close();
fs.rmSync(home, { recursive: true, force: true });
fs.rmSync(work, { recursive: true, force: true });
console.log(redact(JSON.stringify(results, null, 1)));
