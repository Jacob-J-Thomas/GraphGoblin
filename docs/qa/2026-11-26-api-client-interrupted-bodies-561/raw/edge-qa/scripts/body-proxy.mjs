// #561 QA proxy: forwards 127.0.0.1:4821 to the built API on 4811. A control port (4822) arms a mode
// for the next N GETs of one run's `/runs/{id}` or `/runs/{id}/observation`:
//   mid       real upstream 200 headers (Content-Length of the full body) + the first half of the
//             real body, then the socket is destroyed (body cut short after headers)
//   before    socket destroyed before any response headers
//   malformed complete 200 with a malformed JSON body (correct Content-Length)
//   http503   complete 503 problem document
// Every decision is appended to the evidence log.
import { createServer, request as forward } from 'node:http';
import { appendFileSync } from 'node:fs';

const LOG = 'G:/ggq/delivery-evidence/2026-11-24-followups/inspector-561-562-563-556/claude-window-rq-01/qa/561-proxy.jsonl';
const UP = { hostname: '127.0.0.1', port: 4811 };
let armed = { mode: 'pass', path: '', remaining: 0 };
const log = (entry) => appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n');

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      const { mode, path, count } = JSON.parse(body || '{}');
      armed = { mode: mode ?? 'pass', path: path ?? '', remaining: count ?? 0 };
      log({ control: armed });
      res.end(JSON.stringify(armed));
    } catch (e) {
      res.statusCode = 400;
      res.end(String(e));
    }
  });
}).listen(4822, '127.0.0.1');

createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const hit = req.method === 'GET' && armed.remaining > 0 && path === armed.path && armed.mode !== 'pass';
  if (hit) armed.remaining -= 1;
  const mode = hit ? armed.mode : 'pass';
  if (mode === 'before') {
    log({ path, mode, stage: 'destroy-before-headers' });
    req.socket.destroy();
    return;
  }
  if (mode === 'malformed') {
    const text = '{"id": "truncated-but-complete-and-malformed"';
    log({ path, mode, stage: 'malformed-complete' });
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), 'cache-control': 'no-store' });
    res.end(text);
    return;
  }
  if (mode === 'http503') {
    const text = JSON.stringify({ type: 'about:blank', title: 'Unavailable', status: 503, code: 'QA_UNAVAILABLE', detail: 'QA proxy refusal.' });
    log({ path, mode, stage: 'http-503' });
    res.writeHead(503, { 'content-type': 'application/problem+json', 'content-length': Buffer.byteLength(text) });
    res.end(text);
    return;
  }
  const headers = { ...req.headers, host: `${UP.hostname}:${UP.port}` };
  const upstream = forward({ ...UP, path: req.url, method: req.method, headers }, (reply) => {
    if (mode !== 'mid') {
      res.writeHead(reply.statusCode, reply.headers);
      reply.pipe(res);
      return;
    }
    const chunks = [];
    reply.on('data', (c) => chunks.push(c));
    reply.on('end', () => {
      const full = Buffer.concat(chunks);
      const out = { ...reply.headers, 'content-length': String(full.length) };
      delete out['transfer-encoding'];
      res.writeHead(reply.statusCode, out);
      const half = full.subarray(0, Math.max(1, Math.floor(full.length / 2)));
      res.write(half);
      log({ path, mode, stage: 'headers+half-body', status: reply.statusCode, bytes: full.length, sent: half.length });
      setTimeout(() => {
        log({ path, mode, stage: 'destroy-after-headers' });
        res.socket?.destroy();
      }, 150);
    });
  });
  upstream.on('error', () => res.destroy());
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
}).listen(4821, '127.0.0.1', () => log({ started: true }));
