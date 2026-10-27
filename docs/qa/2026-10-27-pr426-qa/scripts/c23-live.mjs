// Checks 2 and 3 with the real, installed and logged-in Codex CLI (the product default: the
// SDK-bundled @openai/codex 0.160.0; GG_CODEX_BINARY unset; no configuration change). Budget: at
// most 3 real turns on gpt-6-luna; this driver spends 2 (one refused minimal turn, one low turn).
//   Check 2 (D2): with the gateway running, add "minimal" back to the codex/gpt-6-luna row of
//     model_catalog with a direct SQL UPDATE, publish a Codex inference node on gpt-6-luna at
//     minimal, run it once, then read the run record, events, gateway log and inspector; try
//     POST /runs/{id}/resume (expect 409) and open (never create) the Replay dialog.
//   Restart: the seed refresh undoes the catalog edit; the refused run's record is durable.
//   Check 3: one real turn at low on gpt-6-luna completes and records low.
// Evidence beyond the product's own record: the codex.exe command lines the gateway starts
// (model/effort tokens only) and, for threads this QA created, the CLI's own session history
// (entry kinds, turn_context model/effort and error messages only).
//   node c23-live.mjs [--fake]   (--fake: the controlled fake CLI, a dry run with no provider)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as L from './lib.mjs';

const fakeMode = process.argv.includes('--fake');
const rec = new L.Recorder(`c23-live${fakeMode ? '-dryrun' : ''}`);
const dir = L.makeStore(fakeMode ? 'c23-dryrun' : 'c23-live');
const fake = fakeMode ? L.fakeCli(dir) : null;
const env = fake ? { ...fake.env } : {};
const gateways = [];
let browser;
const PORT = 6690;
const BANNER = /Reading prompt from stdin/;
const sessionsRoot = path.join(os.homedir(), '.codex', 'sessions');

function rolloutFacts(threadId) {
  if (fakeMode || !threadId || !/^[0-9a-f-]{36}$/.test(threadId) || !fs.existsSync(sessionsRoot)) return null;
  let file = null;
  const now = new Date();
  for (const d of [0, 1]) {
    const t = new Date(now.getTime() - d * 86_400_000);
    const day = path.join(sessionsRoot, String(t.getFullYear()), String(t.getMonth() + 1).padStart(2, '0'), String(t.getDate()).padStart(2, '0'));
    if (fs.existsSync(day)) for (const f of fs.readdirSync(day)) if (f.includes(threadId)) file = path.join(day, f);
  }
  const out = { threadId, file: file ? path.basename(file) : null, entries: [] };
  if (!file) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      out.entries.push({ kind: 'unparsed' });
      continue;
    }
    const kind = [j.type, j.payload?.type].filter(Boolean).join('/');
    const entry = { kind };
    if (j.type === 'turn_context') Object.assign(entry, { model: j.payload?.model, effort: j.payload?.effort ?? j.payload?.reasoning_effort ?? null });
    if (/error|abort|fail/i.test(kind)) entry.message = String(j.payload?.message ?? j.payload?.reason ?? j.payload?.error ?? '').slice(0, 600);
    if (kind === 'event_msg/task_complete')
      entry.error = j.payload?.error ? { message: String(j.payload.error.message ?? '').slice(0, 600) } : null;
    out.entries.push(entry);
  }
  return out;
}

async function inspector(page, g, runId, name, { openReplay = false } = {}) {
  await page.goto(`${g.origin}/app/runs/${runId}`);
  await page.getByRole('button', { name: 'Replay...', exact: true }).waitFor({ timeout: 30_000 });
  await L.sleep(1500);
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  const view = {
    text: (await page.locator('body').innerText()).slice(0, 5000),
    resumeButtons: await resume.count(),
    resumeDisabled: (await resume.count()) ? await resume.isDisabled() : null,
    resumeReason: (await page.locator(`#resume-reason-${runId}`).innerText().catch(() => null)) ?? null,
    replayEnabled: await page.getByRole('button', { name: 'Replay...', exact: true }).isEnabled(),
  };
  await L.shot(page, name);
  if (openReplay) {
    await page.getByRole('button', { name: 'Replay...', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Replay as a new run' });
    await dialog.waitFor({ timeout: 10_000 });
    await L.sleep(800);
    const select = dialog.getByLabel('Replay from node', { exact: true });
    const initial = await select.inputValue();
    // The dialog preselects the first allowed node; choose the inference node to read its reason.
    await select.selectOption('infer');
    await L.sleep(500);
    view.replayDialog = {
      initiallySelected: initial,
      selected: await select.inputValue(),
      options: await select.locator('option').allInnerTexts(),
      reason: await dialog.locator(`#replay-reason-${runId}`).innerText(),
      createEnabled: await dialog.getByRole('button', { name: 'Create replay run', exact: true }).isEnabled(),
    };
    await L.shot(page, `${name}-replay-dialog`);
    // Cancel: this QA never creates the replay run (it would be another real turn).
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await dialog.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined);
  }
  return view;
}

try {
  let g = await L.startGateway({ dir, port: PORT, label: 'live-1', env, rec });
  gateways.push(g);
  const preflight = (await g.call('/harness/preflight')).json.items?.find((i) => i.harness === 'codex');
  rec.log('codex preflight', { state: preflight?.state, version: preflight?.version, authenticated: preflight?.authenticated, problems: preflight?.problems });
  if (preflight?.state !== 'ready') throw new Error('Codex is not ready; no turn spent');

  // ---------------- Check 2: one real refused turn at minimal ----------------
  const before = (await g.call('/model-catalog')).json.items.find((i) => i.harness === 'codex' && i.model === 'gpt-6-luna');
  const edited = ['minimal', ...before.efforts];
  const update = await L.withDb(dir, (db) =>
    db.execute({ sql: "update model_catalog set efforts = ? where harness = 'codex' and model = 'gpt-6-luna'", args: [JSON.stringify(edited)] }),
  );
  const after = (await g.call('/model-catalog')).json.items.find((i) => i.harness === 'codex' && i.model === 'gpt-6-luna');
  rec.log('catalog edit (direct SQL UPDATE on the running gateway store)', { before: before.efforts, rowsAffected: update.rowsAffected, after: after.efforts });
  rec.check('2-0 the running gateway now lists minimal for gpt-6-luna (the edit took effect)', after.efforts.includes('minimal'), after.efforts);
  const loopId = await L.publishLoop(g.call, L.single('QA 426 D2 refused minimal', L.inferenceNode('infer', { model: 'gpt-6-luna', effort: 'minimal' })));
  if (fake) {
    fake.mode('codex', 'refused');
    // Keep the fake alive briefly, as a real CLI is, so the dry run exercises the process watch.
    fs.writeFileSync(path.join(fake.cli, 'delay-ms.txt'), '1500');
  }
  let watch = L.startArgvWatch(g);
  await watch.ready();
  const runId = await L.startRun(g.call, loopId);
  const done = await L.waitRun(g.call, runId, ['succeeded', 'failed', 'cancelled'], 240_000);
  await L.sleep(800);
  const evs = await L.events(g.call, runId);
  for (const t of L.providerCalls(evs)) rec.turn({ check: '2', provider: 'codex', model: 'gpt-6-luna', effort: 'minimal', run: runId, ...t, fake: fakeMode });
  const snap = (await g.call(`/runs/${runId}`)).json;
  const sessions = (await g.call(`/runs/${runId}/sessions`)).json.items ?? [];
  const failure = snap.failure ?? {};
  const submissions = evs.filter((e) => e.type === 'harness.submission').map((e) => ({ seq: e.seq, submission: e.submission, marker: e.marker ?? null }));
  rec.log('2 run record', {
    status: snap.status,
    failure,
    recovery: { resume: snap.recovery?.resume, replayDefault: snap.recovery?.replayDefault, replay: snap.recovery?.replay?.map((r) => ({ nodeId: r.nodeId, action: r.action })) },
    sessions: sessions.map((s) => ({ nodeId: s.nodeId, harness: s.harness, model: s.model, effort: s.effort, status: s.status })),
    submissions,
    eventTypes: evs.map((e) => e.type),
  });
  rec.check('2-1 the run fails HARNESS_TURN_FAILED with details.adapterCode HARNESS_ARGUMENTS_REJECTED and resumable false', snap.status === 'failed' && failure.code === 'HARNESS_TURN_FAILED' && failure.details?.adapterCode === 'HARNESS_ARGUMENTS_REJECTED' && failure.resumable === false, { status: snap.status, code: failure.code, details: failure.details, resumable: failure.resumable });
  rec.check(
    `2-2 the message begins "harness turn failed: The provider refused the request (HTTP 400, reasoning.effort): Unsupported value: 'minimal'"`,
    String(failure.message ?? '').startsWith("harness turn failed: The provider refused the request (HTTP 400, reasoning.effort): Unsupported value: 'minimal'"),
    failure.message,
  );
  rec.check("2-3 failure.inference.submission is delivery-uncertain and harness.submission recorded 'submitted' with marker codex.turn.started", failure.inference?.submission === 'delivery-uncertain' && submissions.some((s) => s.submission === 'submitted' && s.marker === 'codex.turn.started'), { inference: failure.inference, submissions });
  rec.check('2-4 the run read offers no Resume (recovery.resume.allowed false) and offers Replay at the inference node', snap.recovery?.resume?.allowed === false && (snap.recovery?.replay ?? []).some((r) => r.nodeId === 'infer' && r.action.allowed === true), { resume: snap.recovery?.resume, replay: snap.recovery?.replay?.map((r) => ({ nodeId: r.nodeId, action: r.action })) });
  // Resume refused with 409 and no further turn.
  const recovery = snap.recovery;
  const resumed = await g.call(`/runs/${runId}/resume`, { method: 'POST', body: { observedSeq: recovery.observedSeq } });
  await L.sleep(3000);
  const evsAfterResume = await L.events(g.call, runId);
  const turnsAfter = evsAfterResume.filter((e) => e.type === 'harness.turn').length;
  rec.check('2-5 POST /runs/{id}/resume is refused with 409 and sends nothing (still one harness.turn)', resumed.status === 409 && turnsAfter === 1, { status: resumed.status, body: resumed.json, harnessTurns: turnsAfter });
  const argv = await watch.stop();
  rec.check('2-6 exactly one codex exec process was started for this run, with gpt-6-luna and model_reasoning_effort="minimal" (the provider did receive minimal)', argv.length === 1 && argv[0].model === 'gpt-6-luna' && argv[0].effort === 'minimal' && !argv[0].resume, argv);
  const threadId = failure.inference?.sessionId ?? evs.find((e) => e.type === 'harness.session')?.sessionId;
  const facts2 = rolloutFacts(threadId);
  if (facts2) fs.writeFileSync(path.join(L.OUT, 'c23-live-check2-rollout-facts.log.txt'), L.redact(JSON.stringify(facts2, null, 2)) + '\n');
  rec.log('2 CLI session history facts (kinds, turn_context model/effort, error messages)', facts2);
  // Gateway log and inspector.
  const log1 = g.readLog();
  const failedLines = log1.split('\n').filter((l) => /codex turn failed/.test(l));
  rec.log('2 gateway "codex turn failed" lines', failedLines.map((l) => l.slice(0, 800)));
  browser = await L.launchEdge();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const view2 = await inspector(page, g, runId, `c23-live${fakeMode ? '-dryrun' : ''}-check2-inspector`, { openReplay: true });
  rec.log('2 inspector', view2);
  rec.check(
    '2-7 no "Reading prompt from stdin" in the run record, its events, the gateway log or the inspector',
    !BANNER.test(JSON.stringify(snap)) && !BANNER.test(JSON.stringify(evsAfterResume)) && !BANNER.test(log1) && !BANNER.test(view2.text),
    { record: BANNER.test(JSON.stringify(snap)), events: BANNER.test(JSON.stringify(evsAfterResume)), gatewayLog: BANNER.test(log1), inspector: BANNER.test(view2.text) },
  );
  rec.check("2-8 the gateway's codex turn failed line carries the provider refusal", failedLines.length === 1 && /The provider refused the request \(HTTP 400, reasoning\.effort\): Unsupported value: 'minimal'/.test(failedLines[0]) && /HARNESS_ARGUMENTS_REJECTED/.test(failedLines[0]), failedLines.map((l) => l.slice(0, 600)));
  rec.check(
    '2-9 the inspector shows the failure with the provider refusal, a disabled Resume with its reason, and an enabled Replay whose dialog offers the inference node',
    /HARNESS_TURN_FAILED/.test(view2.text) && /The provider refused the request \(HTTP 400, reasoning\.effort\): Unsupported value: 'minimal'/.test(view2.text) && view2.resumeDisabled === true && /^Resume unavailable:/.test(view2.resumeReason ?? '') && view2.replayEnabled === true && view2.replayDialog?.selected === 'infer' && /Replay is available at this node\./.test(view2.replayDialog?.reason ?? '') && view2.replayDialog?.createEnabled === true,
    { resumeDisabled: view2.resumeDisabled, resumeReason: view2.resumeReason, replayEnabled: view2.replayEnabled, replayDialog: view2.replayDialog },
  );
  const failureExcerpt = view2.text.split('\n').filter((l) => /Failed:|refused|HARNESS_|Resume unavailable/.test(l)).slice(0, 10);
  rec.log('2 inspector failure lines', failureExcerpt);
  const runsAfter = (await g.call(`/runs?loopId=${loopId}`)).json;
  rec.check('2-10 no replay run was created (the dialog was cancelled)', (runsAfter.items ?? []).length === 1, { runs: (runsAfter.items ?? []).map((r) => ({ id: r.id, status: r.status })) });

  // ---------------- Restart: the seed refresh undoes the edit; the record is durable ----------------
  const code1 = await g.stop();
  rec.check('R-1 gateway 1 drains to exit 0', code1 === 0, code1);
  g.copyLog(`c23-live${fakeMode ? '-dryrun' : ''}-gateway-1.log.txt`);
  g = await L.startGateway({ dir, port: PORT, label: 'live-2', env, rec });
  gateways.push(g);
  const reseeded = (await g.call('/model-catalog')).json.items.find((i) => i.harness === 'codex' && i.model === 'gpt-6-luna');
  const durable = (await g.call(`/runs/${runId}`)).json;
  rec.check('R-2 after a restart the seed refresh removed minimal again, and the refused run reads the same', !reseeded.efforts.includes('minimal') && durable.failure?.code === 'HARNESS_TURN_FAILED' && durable.failure?.details?.adapterCode === 'HARNESS_ARGUMENTS_REJECTED' && durable.failure?.resumable === false && durable.recovery?.resume?.allowed === false && durable.failure?.message === failure.message, { efforts: reseeded.efforts, failure: durable.failure, resume: durable.recovery?.resume });

  // ---------------- Check 3: one real turn at low ----------------
  if (fake) fake.mode('codex', 'success');
  const loop3 = await L.publishLoop(g.call, L.single('QA 426 low turn', L.inferenceNode('infer', { model: 'gpt-6-luna', effort: 'low' })));
  watch = L.startArgvWatch(g);
  await watch.ready();
  const run3 = await L.startRun(g.call, loop3);
  const done3 = await L.waitRun(g.call, run3, ['succeeded', 'failed', 'cancelled'], 240_000);
  await L.sleep(800);
  const argv3 = await watch.stop();
  const evs3 = await L.events(g.call, run3);
  for (const t of L.providerCalls(evs3)) rec.turn({ check: '3', provider: 'codex', model: 'gpt-6-luna', effort: 'low', run: run3, ...t, fake: fakeMode });
  const sessions3 = (await g.call(`/runs/${run3}/sessions`)).json.items ?? [];
  const hs3 = evs3.filter((e) => e.type === 'harness.session').map((e) => ({ sessionId: e.sessionId, mode: e.mode, model: e.model, effort: e.effort }));
  const reply = evs3.filter((e) => e.type === 'node.finished' && e.nodeId === 'infer').map((e) => {
    const op = (e.patch ?? []).find((o) => o.path === '/lastOutput');
    return typeof op?.value === 'string' ? op.value.slice(0, 80) : JSON.stringify(op?.value ?? null).slice(0, 80);
  });
  const facts3 = rolloutFacts(hs3[0]?.sessionId);
  if (facts3) fs.writeFileSync(path.join(L.OUT, 'c23-live-check3-rollout-facts.log.txt'), L.redact(JSON.stringify(facts3, null, 2)) + '\n');
  rec.log('3 run', { status: done3.status, failure: done3.failure ?? null, reply, sessions: sessions3.map((s) => ({ nodeId: s.nodeId, harness: s.harness, model: s.model, effort: s.effort, status: s.status })), harnessSession: hs3, cliArgv: argv3, rollout: facts3 });
  rec.check('3-1 the low turn completes (run succeeded)', done3.status === 'succeeded', { status: done3.status, failure: done3.failure ?? null });
  rec.check('3-2 the run records low: the session row and harness.session say gpt-6-luna / low', sessions3.length > 0 && sessions3.every((s) => s.model === 'gpt-6-luna' && s.effort === 'low') && hs3.length > 0 && hs3.every((h) => h.model === 'gpt-6-luna' && h.effort === 'low'), { sessions3, hs3 });
  rec.check('3-3 the CLI received gpt-6-luna and model_reasoning_effort="low" (one codex exec process)', argv3.length === 1 && argv3[0].model === 'gpt-6-luna' && argv3[0].effort === 'low', argv3);
  if (!fakeMode) rec.check('3-4 the CLI recorded the turn at low (its own turn_context)', Array.isArray(facts3?.entries) && facts3.entries.some((e) => e.kind === 'turn_context') && facts3.entries.filter((e) => e.kind === 'turn_context').every((e) => e.model === 'gpt-6-luna' && e.effort === 'low'), facts3?.entries?.filter((e) => e.kind === 'turn_context'));
  const view3 = await inspector(page, g, run3, `c23-live${fakeMode ? '-dryrun' : ''}-check3-inspector`);
  rec.log('3 inspector excerpt', view3.text.split('\n').filter((l) => /succeeded|low|gpt-6-luna|Failed/.test(l)).slice(0, 12));
  await browser.close();
  browser = undefined;
  const code2 = await g.stop();
  rec.check('R-3 gateway 2 drains to exit 0', code2 === 0, code2);
  g.copyLog(`c23-live${fakeMode ? '-dryrun' : ''}-gateway-2.log.txt`);
  const left = L.storeProcesses(dir);
  rec.check('R-4 no process naming the disposable store is left', left.length === 0, left);
} catch (error) {
  rec.check('c23-live completed without exception', false, String(error?.stack ?? error));
} finally {
  await browser?.close().catch(() => undefined);
  for (const x of gateways) if (x.exitCode() === null) await x.stop();
  rec.finish();
  L.cleanupStore(dir, rec);
}
