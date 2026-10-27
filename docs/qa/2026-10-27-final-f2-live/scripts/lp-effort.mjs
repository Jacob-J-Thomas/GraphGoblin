// Check 4 (LP-4, LP-5, #205) with the real Codex CLI (SDK-bundled 0.160.0, the product default).
//   LP-4: one Codex inference turn and one LLM decision, both gpt-6-luna at effort max.
//   LP-5: one Codex inference turn at effort minimal on gpt-6-luna (a GPT-6 model).
// Evidence: the run record (session row, harness.session, decision provenance), the CLI command
// line Windows reports for each codex.exe the gateway starts (model and effort tokens only), the
// Codex session history's own turn_context (model and effort fields only), and the inspector.
//   node lp-effort.mjs [--fake]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as L from './lib.mjs';

const fakeMode = process.argv.includes('--fake');
const rec = new L.Recorder(`lp-effort${fakeMode ? '-dryrun' : ''}`);
const dir = L.makeStore('effort');
const fake = fakeMode ? L.fakeCli(dir) : null;
const env = fake ? { ...fake.env } : {};
const gateways = [];
let browser;
const sessionsRoot = path.join(os.homedir(), '.codex', 'sessions');

function findRollout(threadId) {
  if (!threadId || !fs.existsSync(sessionsRoot)) return null;
  const now = new Date();
  for (const d of [0, 1]) {
    const t = new Date(now.getTime() - d * 86_400_000);
    const day = path.join(sessionsRoot, String(t.getFullYear()), String(t.getMonth() + 1).padStart(2, '0'), String(t.getDate()).padStart(2, '0'));
    if (!fs.existsSync(day)) continue;
    for (const f of fs.readdirSync(day)) if (f.includes(threadId)) return path.join(day, f);
  }
  return null;
}

/** Only the model and effort fields of the CLI's own turn_context records. */
function turnContexts(file) {
  if (!file) return null;
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        const j = JSON.parse(l);
        return j.type === 'turn_context' ? { model: j.payload?.model ?? null, effort: j.payload?.effort ?? j.payload?.reasoning_effort ?? null } : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** Poll the codex.exe command lines under the gateway; keep only model/effort/resume tokens. */
function startArgvWatch(g) {
  const seen = new Map();
  let stop = false;
  const loop = (async () => {
    while (!stop) {
      try {
        const all = L.processes();
        const tree = new Set(L.descendants(g.pid, all).map((d) => d.pid));
        for (const p of all) {
          if (!/^codex(\.exe)?$/i.test(p.Name ?? '') || seen.has(p.ProcessId)) continue;
          if (!tree.has(p.ProcessId)) continue;
          const cmd = p.CommandLine ?? '';
          seen.set(p.ProcessId, {
            pid: p.ProcessId,
            model: /--model\s+("?)([^\s"]+)\1/.exec(cmd)?.[2] ?? null,
            effort: /model_reasoning_effort=\\?"?([a-z]+)/.exec(cmd)?.[1] ?? null,
            outputSchema: /--output-schema/.test(cmd),
            resume: /\bresume\b/.test(cmd),
          });
        }
      } catch {
        /* a process listing can race exits */
      }
      await L.sleep(150);
    }
  })();
  return {
    seen,
    async stop() {
      stop = true;
      await loop;
      return [...seen.values()];
    },
  };
}

try {
  const g = await L.startGateway({ dir, port: 6643, label: 'effort', env, rec });
  gateways.push(g);
  const catalog = (await g.call('/model-catalog')).json.items?.filter((i) => i.harness === 'codex').map((i) => ({ model: i.model, efforts: i.efforts }));
  rec.log('Codex catalog efforts', catalog);

  // ---- LP-4: inference and LLM decision at max on gpt-6-luna ----
  const lp4 = await L.publishLoop(
    g.call,
    L.loop(
      'F2 LP-4 max effort',
      [
        L.inferenceNode('infer', { harness: 'codex', model: 'gpt-6-luna', effort: 'max', template: 'Reply with exactly the word READY and nothing else.' }),
        {
          id: 'pick',
          kind: 'decision',
          label: 'Pick',
          config: {
            kind: 'llm',
            harness: 'codex',
            model: { mode: 'explicit', value: 'gpt-6-luna' },
            effort: { mode: 'explicit', value: 'max' },
            instructions: 'Always choose the route with id "finish".',
            routes: [
              { id: 'finish', label: 'Finish' },
              { id: 'other', label: 'Other' },
            ],
          },
        },
      ],
      [L.edge('e1', 'start', 'infer'), L.edge('e2', 'infer', 'pick'), L.edge('e3', 'pick', 'done', 'finish'), L.edge('e4', 'pick', 'done', 'other')],
    ),
  );
  let watch = startArgvWatch(g);
  const run4 = await L.startRun(g.call, lp4);
  const done4 = await L.waitRun(g.call, run4, ['succeeded', 'failed', 'cancelled'], 240_000);
  await L.sleep(500);
  const argv4 = await watch.stop();
  const ev4 = await L.events(g.call, run4);
  for (const t of L.providerCalls(ev4)) rec.turn({ check: 'LP-4', provider: 'codex', model: 'gpt-6-luna', effort: 'max', run: run4, ...t, fake: fakeMode });
  const sessions4 = (await g.call(`/runs/${run4}/sessions`)).json.items ?? [];
  const hs4 = ev4.filter((e) => e.type === 'harness.session').map((e) => ({ sessionId: e.sessionId, mode: e.mode, model: e.model, effort: e.effort }));
  const decision4 = ev4.find((e) => e.type === 'decision.made');
  const rollout4 = fake ? null : findRollout(hs4[0]?.sessionId);
  const ctx4 = turnContexts(rollout4);
  rec.log('LP-4 run', {
    status: done4.status,
    failure: done4.failure,
    reply: L.nodeReplies(ev4, 'infer'),
    sessions: sessions4.map((s) => ({ nodeId: s.nodeId, harness: s.harness, model: s.model, effort: s.effort, status: s.status })),
    harnessSession: hs4,
    decision: decision4 ? { portId: decision4.portId, provenance: decision4.provenance, observation: decision4.observation } : null,
    cliArgv: argv4,
    rolloutTurnContexts: ctx4,
  });
  rec.check('LP4-1 the max run succeeds (inference turn and LLM decision complete)', done4.status === 'succeeded', { status: done4.status, failure: done4.failure });
  rec.check('LP4-2 the run records max: session row and harness.session say gpt-6-luna / max', sessions4.some((s) => s.model === 'gpt-6-luna' && s.effort === 'max') && hs4.every((h) => h.model === 'gpt-6-luna' && h.effort === 'max') && hs4.length > 0, { sessions4, hs4 });
  rec.check('LP4-3 the LLM decision records provider codex, gpt-6-luna, max and routes finish', decision4?.provenance?.kind === 'llm' && decision4?.provenance?.model === 'gpt-6-luna' && decision4?.provenance?.effort === 'max' && decision4?.portId === 'finish', decision4?.provenance);
  if (!fake) {
    rec.check('LP4-4 each codex.exe the gateway started received gpt-6-luna and model_reasoning_effort="max"', argv4.length >= 2 && argv4.every((a) => a.model === 'gpt-6-luna' && a.effort === 'max'), argv4);
    rec.check('LP4-5 the Codex CLI recorded the turn with effort max (session history turn_context)', Array.isArray(ctx4) && ctx4.length > 0 && ctx4.every((c) => c.model === 'gpt-6-luna' && c.effort === 'max'), ctx4);
  }

  // ---- LP-5: inference at minimal on gpt-6-luna ----
  const lp5 = await L.publishLoop(
    g.call,
    L.line('F2 LP-5 minimal effort', [L.inferenceNode('infer', { harness: 'codex', model: 'gpt-6-luna', effort: 'minimal', template: 'Reply with exactly the word READY and nothing else.' })]),
  );
  watch = startArgvWatch(g);
  const run5 = await L.startRun(g.call, lp5);
  const done5 = await L.waitRun(g.call, run5, ['succeeded', 'failed', 'cancelled'], 240_000);
  await L.sleep(500);
  const argv5 = await watch.stop();
  const ev5 = await L.events(g.call, run5);
  for (const t of L.providerCalls(ev5)) rec.turn({ check: 'LP-5', provider: 'codex', model: 'gpt-6-luna', effort: 'minimal', run: run5, ...t, fake: fakeMode });
  const sessions5 = (await g.call(`/runs/${run5}/sessions`)).json.items ?? [];
  const hs5 = ev5.filter((e) => e.type === 'harness.session').map((e) => ({ sessionId: e.sessionId, mode: e.mode, model: e.model, effort: e.effort }));
  const rollout5 = fake ? null : findRollout(hs5[0]?.sessionId);
  const ctx5 = turnContexts(rollout5);
  const snap5 = (await g.call(`/runs/${run5}`)).json;
  rec.log('LP-5 run', {
    status: done5.status,
    failure: done5.failure,
    reply: L.nodeReplies(ev5, 'infer'),
    sessions: sessions5.map((s) => ({ nodeId: s.nodeId, model: s.model, effort: s.effort, status: s.status })),
    harnessSession: hs5,
    submissions: ev5.filter((e) => e.type === 'harness.submission').map((e) => ({ submission: e.submission, marker: e.marker })),
    events: ev5.map((e) => e.type),
    recovery: { resume: snap5.recovery?.resume, replayDefault: snap5.recovery?.replayDefault },
    cliArgv: argv5,
    rolloutTurnContexts: ctx5,
  });
  rec.observe('LP5-1 what happens for a real Codex turn at minimal on gpt-6-luna', {
    status: done5.status,
    failure: done5.failure ?? null,
    cliReceived: argv5.map((a) => a.effort),
    cliRecorded: ctx5,
  });
  if (!fake) {
    rec.check('LP5-2 the CLI received exactly the recorded effort (minimal)', argv5.length >= 1 && argv5.every((a) => a.effort === 'minimal'), argv5);
    if (done5.status === 'succeeded')
      rec.check('LP5-3 a succeeded minimal run records minimal in its session row, matching what the CLI recorded', sessions5.some((s) => s.effort === 'minimal') && (ctx5 ?? []).every((c) => c.effort === 'minimal'), { sessions5, ctx5 });
    else
      rec.check('LP5-3 a failed minimal run names the provider refusal truthfully (no success, no silent substitution)', done5.status === 'failed' && Boolean(done5.failure?.code) && !sessions5.some((s) => s.effort && s.effort !== 'minimal'), { failure: done5.failure, sessions5 });
  }

  // Inspector view of both runs (check 8).
  browser = await L.launchEdge();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  for (const [label, run] of [['lp4', run4], ['lp5', run5]]) {
    await page.goto(`${g.origin}/app/runs/${run}`);
    await page.getByRole('list', { name: 'Timeline' }).waitFor({ timeout: 20_000 }).catch(() => undefined);
    await L.sleep(1500);
    const text = (await page.locator('body').innerText()).slice(0, 4000);
    rec.log(`${label} inspector text (first 4000 chars)`, text);
    await L.shot(page, `${rec.name}-${label}-inspector`);
  }
  await browser.close();
  browser = undefined;
  const code = await g.stop();
  rec.check('LP4-6 gateway drains to exit 0', code === 0, code);
  g.copyLog(`${rec.name}-gateway.log.txt`);
} catch (error) {
  rec.check('lp-effort completed without exception', false, String(error?.stack ?? error));
} finally {
  await browser?.close().catch(() => undefined);
  for (const x of gateways) if (x.exitCode() === null) await x.stop();
  rec.finish();
  L.cleanupStore(dir, rec);
}
