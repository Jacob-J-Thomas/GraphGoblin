import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
const here = new URL('.', import.meta.url),
  old = new URL('../round-4/', here);
const cases = JSON.parse(await readFile(new URL('served-results.json', old), 'utf8'));
const life = JSON.parse(await readFile(new URL('served-lifecycle.json', old), 'utf8'));
if (!life.directory.startsWith('gg-qa-f2b-')) throw Error('Unexpected retained store prefix');
const raw = await readFile(join(tmpdir(), life.directory, 'api.log'), 'utf8');
const requests = new Map(),
  calls = [];
for (const line of raw.split('\n'))
  try {
    const e = JSON.parse(line);
    const key = e.pid + ':' + e.reqId;
    if (e.msg === 'incoming request') {
      const c = { startMs: e.time, method: e.req.method, path: e.req.url.split('?')[0] };
      requests.set(key, c);
      calls.push(c);
    }
    if (e.msg === 'request completed') {
      Object.assign(requests.get(key) ?? {}, {
        responseMs: e.responseTime,
        status: e.res.statusCode,
        completedMs: e.time,
      });
    }
  } catch {}
const baseline = [];
for (const c of cases.filter((c) => c.verdict === 'FAIL')) {
  const id = c.actual.loop?.loop?.id;
  const start = calls.find((x) => x.method === 'GET' && x.path === '/loops/' + id)?.startMs;
  const end =
    calls.find((x) => x.method === 'POST' && x.path === '/loops' && x.startMs > start)?.startMs ??
    Infinity;
  const selected = calls.filter(
    (x) => x.startMs >= start && x.startMs < end && /preflight|validate|publish/.test(x.path),
  );
  baseline.push({
    id: c.id,
    round4Verdict: c.verdict,
    round4Error: c.actual.error?.split('\n').slice(0, 12).join('\n'),
    loop: id,
    windowStartMs: start,
    windowEndMs: Number.isFinite(end) ? end : null,
    method:
      'Requests starting between first editor GET of captured loop and next loop creation; request completion may outlast assertion.',
    requests: selected,
  });
}
await writeFile(
  new URL('round4-request-baseline.json', here),
  JSON.stringify(
    {
      historicalHead: '492b283b49747e91470d94dca7028caa4eeb6c3d',
      source:
        'Retained round-4 owned API log, read only; original observations, newly extracted attribution windows.',
      sourceLogSha256: createHash('sha256').update(raw).digest('hex'),
      checks: baseline,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  baseline.map((c) => ({
    id: c.id,
    preflightMs: c.requests.filter((x) => x.path === '/harness/preflight').map((x) => x.responseMs),
  })),
);
