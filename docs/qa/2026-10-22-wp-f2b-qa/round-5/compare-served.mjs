import { readFile, writeFile } from 'node:fs/promises';
const here = new URL('.', import.meta.url);
const read = async (n) => JSON.parse(await readFile(new URL(n, here), 'utf8'));
const results = await read('served-results.json'),
  timings = await read('served-timings.json'),
  old = await read('round4-request-baseline.json');
const server = new Map(),
  calls = [];
for (const line of (await readFile(new URL('served-api.log.txt', here), 'utf8')).split('\n'))
  try {
    const e = JSON.parse(line),
      key = e.pid + ':' + e.reqId;
    if (e.msg === 'incoming request') {
      const c = { startMs: e.time, method: e.req.method, path: e.req.url.split('?')[0] };
      server.set(key, c);
      calls.push(c);
    }
    if (e.msg === 'request completed')
      Object.assign(server.get(key) ?? {}, {
        responseMs: e.responseTime,
        status: e.res.statusCode,
      });
  } catch {}
const comparisons = old.checks.map((c) => {
  const now = results.find((r) => r.id === c.id),
    caseTime = timings.caseTimes.find((x) => x.id === c.id);
  const edge = timings.requests.filter((x) => x.case === c.id && x.path === '/harness/preflight');
  const actualServer = edge.flatMap((r) => {
    const start = r.timing?.startTime ?? Date.parse(r.utc);
    const found = calls.filter((s) => s.path === r.path && Math.abs(s.startMs - start) < 200);
    return found;
  });
  const oldMs = c.requests
    .filter((x) => x.path === '/harness/preflight' && x.responseMs !== undefined)
    .map((x) => x.responseMs);
  const newMs = actualServer.filter((x) => x.responseMs !== undefined).map((x) => x.responseMs);
  const unfinished = c.requests.filter(
    (x) => x.path === '/harness/preflight' && x.responseMs === undefined,
  ).length;
  return {
    id: c.id,
    round4Verdict: 'FAIL',
    round5Verdict: now?.verdict,
    round4Assertion: c.round4Error,
    round4PreflightServerMs: oldMs,
    round4UncompletedPreflightRequests: unfinished,
    round5PreflightServerMs: newMs,
    round5EdgeRequests: edge.map((r) => ({
      status: r.status,
      failure: r.failure,
      responseEndMs: r.timing?.responseEnd,
    })),
    round5CaseElapsedMs: caseTime?.elapsedMs,
    responseDifference:
      oldMs.length && newMs.length
        ? {
            oldMaxMs: Math.max(...oldMs),
            newMaxMs: Math.max(...newMs),
            maxDeltaMs: Math.max(...newMs) - Math.max(...oldMs),
          }
        : 'No numerical delta: round-4 request had no logged completion, or controlled interception has no matching API request. Current timings are retained without inventing missing historical values.',
  };
});
const preflight = calls
  .filter((c) => c.path === '/harness/preflight' && c.responseMs !== undefined)
  .map((c) => c.responseMs);
const summary = {
  head: '86e96bbc7f99a65cbf26d6feb7fb9fc0b2f61f60',
  invocations: 1,
  retries: 0,
  passed: results.filter((c) => c.id !== 'environment' && c.verdict === 'PASS').length,
  failed: results.filter((c) => c.verdict === 'FAIL').length,
  apiPreflight: {
    count: preflight.length,
    minMs: Math.min(...preflight),
    maxMs: Math.max(...preflight),
  },
  comparisons,
  allCaseDurations: timings.caseTimes,
  note: 'Server response durations compare the same metric. Edge timings additionally include network/render scheduling and controlled route delays. R4 windows are attributed by loop creation/editor GET boundaries, not claimed original per-case instrumentation.',
};
await writeFile(new URL('served-comparison.json', here), JSON.stringify(summary, null, 2) + '\n');
console.log({ passed: summary.passed, failed: summary.failed, preflight: summary.apiPreflight });
console.log(
  comparisons.map((c) => ({
    id: c.id,
    old: c.round4PreflightServerMs,
    unfinished: c.round4UncompletedPreflightRequests,
    now: c.round5PreflightServerMs,
    verdict: c.round5Verdict,
  })),
);
