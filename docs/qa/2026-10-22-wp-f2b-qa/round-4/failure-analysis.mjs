import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const p = fileURLToPath(new URL('.', import.meta.url));
const results = JSON.parse(await readFile(join(p, 'served-results.json'), 'utf8'));
const life = JSON.parse(await readFile(join(p, 'served-lifecycle.json'), 'utf8'));
if (!life.directory.startsWith('gg-qa-f2b-')) throw Error('Unexpected store prefix');
const lines = (await readFile(join(tmpdir(), life.directory, 'api.log'), 'utf8'))
  .split('\n')
  .filter(Boolean);
const requests = new Map(),
  calls = [];
for (const line of lines)
  try {
    const e = JSON.parse(line);
    if (e.msg === 'incoming request')
      requests.set(e.reqId, {
        method: e.req?.method,
        url: e.req?.url?.split('?')[0].replace(/\/[0-9A-HJKMNP-TV-Z]{26}/g, '/<id>'),
      });
    if (e.msg === 'request completed')
      calls.push({
        ...requests.get(e.reqId),
        responseTime: e.responseTime,
        status: e.res?.statusCode,
      });
  } catch {}
const groups = {};
for (const c of calls) {
  const k = c.method + ' ' + c.url;
  (groups[k] ??= []).push(c.responseTime);
}
const timing = Object.entries(groups)
  .map(([endpoint, ms]) => {
    ms.sort((a, b) => a - b);
    return {
      endpoint,
      count: ms.length,
      maxMs: ms.at(-1),
      p95Ms: ms[Math.floor((ms.length - 1) * 0.95)],
      over5000ms: ms.filter((t) => t > 5000).length,
    };
  })
  .sort((a, b) => b.maxMs - a.maxMs);
const failures = results
  .filter((c) => c.verdict === 'FAIL')
  .map((c) => {
    const t = c.actual.pageText ?? '',
      at = t.indexOf('\nHarness\n');
    return {
      id: c.id,
      firstError: c.actual.error?.split('\n')[0],
      assertion: c.actual.error
        ?.split('\n')
        .filter((s) => /^(Locator:|Expected:|Received:|Timeout:|Error: element)/.test(s))
        .slice(0, 5),
      harnessExcerpt: at < 0 ? '' : t.slice(at, at + 700),
      waitingNoticeAtCapture: t.includes('The harness change will apply'),
      checkingStatusAtCapture: t.includes('\nChecking'),
    };
  });
await writeFile(
  join(p, 'failure-analysis.json'),
  JSON.stringify(
    {
      head: '492b283b49747e91470d94dca7028caa4eeb6c3d',
      method: 'Read-only analysis of the one captured run and its owned API log; no test rerun.',
      passed: results.filter((c) => c.id !== 'environment' && c.verdict === 'PASS').length,
      failed: failures.length,
      failures,
      apiTiming: timing,
      interpretation:
        'Slow API responses and lengthy component transforms are host/load evidence. They do not waive any failed case or prove all failures are environmental.',
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify(timing.slice(0, 6)));
