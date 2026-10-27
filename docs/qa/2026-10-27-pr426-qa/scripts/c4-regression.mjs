// Check 4 (no regression, no provider): the same controlled fake CLI scenarios against the build of
// main at b33a6d9f (the baseline) and the PR head. The fake streams a typed failure and then exits
// 1 with only a banner on stderr, as Codex CLI 0.160.0 does.
//   Codex: HTTP 429 and HTTP 500 in `error` + `turn.failed`, then exit 1 (and, as a control, the
//          F2 LP-5 refusal, which main records as D2 and the PR head records as a pinned refusal).
//   Claude: an assistant record with error rate_limit / server_error, then exit 1.
import * as L from './lib.mjs';

const rec = new L.Recorder('c4-regression');
const gateways = [];
const stores = [];
const results = { main: {}, pr: {} };

const scenarios = [
  { id: 'codex-429', harness: 'codex', mode: 'quota429', node: () => L.inferenceNode('work', { harness: 'codex', model: 'gpt-6-luna', effort: 'low' }) },
  { id: 'codex-500', harness: 'codex', mode: 'server500', node: () => L.inferenceNode('work', { harness: 'codex', model: 'gpt-6-luna', effort: 'low' }) },
  { id: 'codex-400-refused', harness: 'codex', mode: 'refused', node: () => L.inferenceNode('work', { harness: 'codex', model: 'gpt-6-luna', effort: 'low' }) },
  { id: 'claude-rate-limit', harness: 'claude', mode: 'ratelimit', node: () => L.inferenceNode('work', { harness: 'claude', model: 'claude-haiku-5-5', effort: 'low' }) },
  { id: 'claude-server-error', harness: 'claude', mode: 'server', node: () => L.inferenceNode('work', { harness: 'claude', model: 'claude-haiku-5-5', effort: 'low' }) },
];

try {
  for (const [build, root, port] of [['main', L.MAIN_ROOT, 6696], ['pr', L.PR_ROOT, 6698]]) {
    const dir = L.makeStore(`c4-${build}`);
    stores.push(dir);
    const fake = L.fakeCli(dir);
    const g = await L.startGateway({ root, dir, port, label: `c4-${build}`, env: fake.env, rec });
    gateways.push(g);
    rec.log(`${build}: harness preflight`, (await g.call('/harness/preflight')).json?.items?.map?.((i) => ({ harness: i.harness, state: i.state })) ?? null);
    for (const s of scenarios) {
      fake.mode(s.harness, s.mode);
      const before = fake.requests().length;
      const loopId = await L.publishLoop(g.call, L.single(`QA c4 ${s.id}`, s.node()));
      const runId = await L.startRun(g.call, loopId);
      const done = await L.waitRun(g.call, runId, ['succeeded', 'failed', 'cancelled'], 90_000);
      const evs = await L.events(g.call, runId);
      const snap = (await g.call(`/runs/${runId}`)).json;
      results[build][s.id] = {
        status: done.status,
        code: done.failure?.code,
        adapterCode: done.failure?.details?.adapterCode,
        message: done.failure?.message,
        resumable: done.failure?.resumable,
        submission: done.failure?.inference?.submission,
        resumeAllowed: snap.recovery?.resume?.allowed,
        markers: evs.filter((e) => e.type === 'harness.submission').map((e) => `${e.submission}${e.marker ? ':' + e.marker : ''}`),
        turns: evs.filter((e) => e.type === 'harness.turn').length,
        cliRequests: fake.requests().length - before,
        bannerInRecord: /Reading prompt from stdin|QA_FAKE_STDERR_BANNER/.test(JSON.stringify(snap)),
        privateBodyInRecord: /QA_FAKE_PROVIDER_BODY/.test(JSON.stringify(snap)),
      };
      rec.log(`${build} ${s.id}`, results[build][s.id]);
    }
    const log = g.readLog();
    rec.log(`${build}: gateway log lines naming a failed turn`, log.split('\n').filter((l) => /turn failed/i.test(l)).map((l) => l.slice(0, 600)));
    rec.check(`${build}: gateway drains to exit 0`, (await g.stop()) === 0, g.exitCode());
    g.copyLog(`c4-regression-${build}-gateway.log.txt`);
  }

  const m = results.main;
  const p = results.pr;
  const sameClass = (id) => m[id].code === p[id].code && m[id].resumable === p[id].resumable && m[id].submission === p[id].submission && m[id].resumeAllowed === p[id].resumeAllowed;
  rec.check(
    '4-1 Codex HTTP 429 then exit 1: classified as before (HARNESS_QUOTA_EXHAUSTED, same resumability and provenance as main) with the stream message, never the exit banner',
    p['codex-429'].code === 'HARNESS_QUOTA_EXHAUSTED' && sameClass('codex-429') && /QA fake: Rate limit reached/.test(p['codex-429'].message) && !p['codex-429'].bannerInRecord,
    { main: m['codex-429'], pr: p['codex-429'] },
  );
  rec.check(
    '4-2 Codex HTTP 500 then exit 1: classified as before (HARNESS_TRANSPORT_FAILED, same resumability and provenance as main) with the stream message, never the exit banner',
    p['codex-500'].code === 'HARNESS_TRANSPORT_FAILED' && sameClass('codex-500') && /QA fake: The server had an error/.test(p['codex-500'].message) && !p['codex-500'].bannerInRecord,
    { main: m['codex-500'], pr: p['codex-500'] },
  );
  rec.check(
    '4-3 Claude rate_limit in the stream then exit 1: the stream failure is recorded (HARNESS_QUOTA_EXHAUSTED, as on main), no stderr banner or provider body',
    p['claude-rate-limit'].code === 'HARNESS_QUOTA_EXHAUSTED' && sameClass('claude-rate-limit') && p['claude-rate-limit'].message === m['claude-rate-limit'].message && !p['claude-rate-limit'].bannerInRecord && !p['claude-rate-limit'].privateBodyInRecord,
    { main: m['claude-rate-limit'], pr: p['claude-rate-limit'] },
  );
  rec.check(
    '4-4 Claude server_error in the stream then exit 1: the stream failure is recorded (HARNESS_TRANSPORT_FAILED, as on main), no stderr banner or provider body',
    p['claude-server-error'].code === 'HARNESS_TRANSPORT_FAILED' && sameClass('claude-server-error') && p['claude-server-error'].message === m['claude-server-error'].message && !p['claude-server-error'].bannerInRecord && !p['claude-server-error'].privateBodyInRecord,
    { main: m['claude-server-error'], pr: p['claude-server-error'] },
  );
  rec.check(
    '4-5 control: the fake F2 refusal stream reproduces D2 on main and the fix on the PR head',
    m['codex-400-refused'].code === 'HARNESS_DELIVERY_UNCERTAIN' && m['codex-400-refused'].resumable === true && /Reading prompt from stdin/.test(m['codex-400-refused'].message) &&
      p['codex-400-refused'].code === 'HARNESS_TURN_FAILED' && p['codex-400-refused'].adapterCode === 'HARNESS_ARGUMENTS_REJECTED' && p['codex-400-refused'].resumable === false && p['codex-400-refused'].resumeAllowed === false,
    { main: m['codex-400-refused'], pr: p['codex-400-refused'] },
  );
} catch (error) {
  rec.check('c4-regression completed without exception', false, String(error?.stack ?? error));
  for (const x of gateways) rec.log(`gateway ${x.label} exit code at the exception`, x.exitCode());
} finally {
  for (const x of gateways) if (x.exitCode() === null) await x.stop();
  for (const x of gateways) x.copyLog(`c4-regression-${x.label.replace(/^c4-/, '')}-gateway.log.txt`);
  rec.finish({ results });
  for (const d of stores) L.cleanupStore(d, rec);
}
