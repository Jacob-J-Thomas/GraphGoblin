// Summarise a gateway log (pino JSON lines) as "method url -> status" per request, in order.
// Usage: node requests-from-log.mjs <gateway log> [--all]   (GET requests are skipped unless --all)
import fs from 'node:fs';

const [file, flag] = process.argv.slice(2);
const pending = new Map();
for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  if (!line.startsWith('{')) continue;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }
  if (entry.msg === 'incoming request' && entry.req) pending.set(entry.reqId, { at: entry.time, method: entry.req.method, url: entry.req.url });
  else if (entry.msg === 'request completed' && pending.has(entry.reqId)) {
    const r = pending.get(entry.reqId);
    pending.delete(entry.reqId);
    if (r.method !== 'GET' || flag === '--all')
      console.log(`${new Date(r.at).toISOString()} ${r.method} ${r.url} -> ${entry.res?.statusCode}`);
  } else if (entry.level >= 40) console.log(`${new Date(entry.time).toISOString()} level ${entry.level} ${entry.msg} ${JSON.stringify(entry.err?.message ?? entry.code ?? '')}`);
}
