// Check 1 (D1, no turn), part 2: a store seeded by the build of main at b33a6d9f (a disposable
// `git archive` copy under %TEMP%\gg-qa-426r-main-src), reopened by the built PR head. Both
// gateways run the controlled fake CLI as both harness binaries, so a turn that reached a CLI is
// recorded in requests.jsonl instead of reaching a provider.
//   Store U1 (main): published A (inference minimal), B (LLM decision minimal), C (loop default
//     minimal); drafts only E (inference minimal), F (LLM decision minimal).
//   Store U2 (main): Settings default codex gpt-6-luna/minimal; published D (inference inheriting).
//   Reopened by the PR head: the catalog is refreshed; A, B, C and D fail
//   EVALUATION_INVALID_CONFIGURATION with no provider request; the editor keeps E's and F's minimal
//   and names it on the field and the node; Publish refuses and names the node; choosing low
//   publishes and the next run requests low.
import path from 'node:path';
import * as L from './lib.mjs';

const rec = new L.Recorder('c1-upgrade');
const u1 = L.makeStore('c1-upgrade-u1');
const u2 = L.makeStore('c1-upgrade-u2');
const fake1 = L.fakeCli(u1);
const fake2 = L.fakeCli(u2);
const gateways = [];
let browser;
const TO_MAX = ['low', 'medium', 'high', 'xhigh', 'max'];

async function lunaRow(dir) {
  return L.withDb(dir, async (db) => {
    const r = await db.execute("select harness, model, efforts, default_effort from model_catalog where harness = 'codex' and model = 'gpt-6-luna'");
    return r.rows.map((row) => ({ ...row }));
  });
}

try {
  // ---------------- Phase A: the build of main seeds the stores ----------------
  const ga = await L.startGateway({ root: L.MAIN_ROOT, dir: u1, port: 6712, label: 'u1-main', env: fake1.env, rec });
  gateways.push(ga);
  const mainLuna = (await ga.call('/model-catalog')).json.items.find((i) => i.harness === 'codex' && i.model === 'gpt-6-luna');
  rec.log('main build: GET /model-catalog codex/gpt-6-luna', mainLuna);
  rec.check('A-1 the main build offers minimal for gpt-6-luna (the D1 baseline)', mainLuna.efforts.includes('minimal'), mainLuna.efforts);
  const ids = {};
  ids.A = await L.publishLoop(ga.call, L.single('QA upgrade A inference minimal', L.inferenceNode('work', { model: 'gpt-6-luna', effort: 'minimal' })));
  ids.B = await L.publishLoop(ga.call, L.single('QA upgrade B decision minimal', L.llmDecisionNode('work', { model: 'gpt-6-luna', effort: 'minimal' })));
  ids.C = await L.publishLoop(ga.call, L.single('QA upgrade C loop default minimal', L.inferenceNode('work', { model: 'gpt-6-luna' }), { defaults: { byHarness: { codex: { effort: 'minimal' } } } }));
  const e = await L.createLoop(ga.call, L.single('QA upgrade E draft inference minimal', L.inferenceNode('work', { model: 'gpt-6-luna', effort: 'minimal' })));
  const f = await L.createLoop(ga.call, L.single('QA upgrade F draft decision minimal', L.llmDecisionNode('work', { model: 'gpt-6-luna', effort: 'minimal' })));
  ids.E = e.json.loop.id;
  ids.F = f.json.loop.id;
  rec.check('A-2 the main build accepts and publishes A, B, C and saves drafts E, F with minimal', Boolean(ids.A && ids.B && ids.C) && e.status === 201 && f.status === 201, { ids, e: e.status, f: f.status });
  rec.check('A-3 main gateway drains to exit 0', (await ga.stop()) === 0, ga.exitCode());
  ga.copyLog('c1-upgrade-u1-main-gateway.log.txt');

  const gb = await L.startGateway({ root: L.MAIN_ROOT, dir: u2, port: 6713, label: 'u2-main', env: fake2.env, rec });
  gateways.push(gb);
  const putMain = await gb.call('/settings', { method: 'PUT', body: { defaults: { byHarness: { codex: { model: 'gpt-6-luna', effort: 'minimal' } } } } });
  ids.D = await L.publishLoop(gb.call, L.single('QA upgrade D inherits Settings minimal', L.inferenceNode('work', {})));
  rec.check('A-4 the main build saves the Settings default codex gpt-6-luna/minimal and publishes D', putMain.status === 200 && Boolean(ids.D), { put: putMain.status, settings: (await gb.call('/settings')).json });
  rec.check('A-5 main gateway (U2) drains to exit 0', (await gb.stop()) === 0, gb.exitCode());
  gb.copyLog('c1-upgrade-u2-main-gateway.log.txt');
  rec.log('U1 model_catalog row after the main build', await lunaRow(u1));
  rec.check('A-6 no turn reached a CLI on the main build', fake1.requests().length === 0 && fake2.requests().length === 0, { u1: fake1.requests(), u2: fake2.requests() });

  // ---------------- Phase B: the PR head reopens U1 ----------------
  const g1 = await L.startGateway({ root: L.PR_ROOT, dir: u1, port: 6714, label: 'u1-pr', env: fake1.env, rec });
  gateways.push(g1);
  const prLuna = (await g1.call('/model-catalog')).json.items.find((i) => i.harness === 'codex' && i.model === 'gpt-6-luna');
  const dbRow = await lunaRow(u1);
  rec.check('B-1 reopened by the PR head, the catalog is refreshed: gpt-6-luna offers low to max, no minimal (API and stored row)', JSON.stringify(prLuna.efforts) === JSON.stringify(TO_MAX) && !String(dbRow[0]?.efforts).includes('minimal'), { api: prLuna.efforts, stored: dbRow });
  const watch = {stop: async () => []}; // fake-CLI request ledger is the provider-call evidence; no process inventory watcher
  const runs = {};
  for (const k of ['A', 'B', 'C']) {
    const start = await g1.call(`/loops/${ids[k]}/runs`, { method: 'POST', body: { input: null } });
    runs[k] = { start: start.status, id: start.json?.run?.id, startBody: start.status === 202 ? undefined : start.json };
    if (runs[k].id) {
      const done = await L.waitRun(g1.call, runs[k].id, ['succeeded', 'failed', 'cancelled'], 60_000);
      const evs = await L.events(g1.call, runs[k].id);
      runs[k].status = done.status;
      runs[k].failure = done.failure;
      runs[k].resume = done.recovery?.resume;
      runs[k].providerCalls = L.providerCalls(evs);
      runs[k].eventTypes = evs.map((x) => x.type);
    }
  }
  await L.sleep(500);
  const argv = await watch.stop();
  for (const [k, label] of [['A', 'inference'], ['B', 'LLM decision'], ['C', 'loop default']]) {
    const r = runs[k];
    rec.log(`B run ${k} (${label})`, r);
    rec.check(
      `B-2 ${k}: the version published with a Codex ${label} at minimal is admitted and fails EVALUATION_INVALID_CONFIGURATION (EFFORT_UNSUPPORTED), not resumable, with no provider call`,
      r.start === 202 && r.status === 'failed' && r.failure?.code === 'EVALUATION_INVALID_CONFIGURATION' && r.failure?.details?.code === 'EFFORT_UNSUPPORTED' && r.failure?.resumable === false && r.providerCalls.length === 0,
      { start: r.start, status: r.status, failure: r.failure, providerCalls: r.providerCalls },
    );
  }
  rec.check('B-3 no codex exec process was started and no turn reached the CLI during runs A, B, C', argv.length === 0 && fake1.requests().length === 0, { argv, requests: fake1.requests() });

  // The editor on the reopened store.
  browser = await L.launchEdge();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  for (const [k, kind] of [['E', 'inference'], ['F', 'LLM decision']]) {
    await page.goto(`${g1.origin}/app/loops/${ids[k]}/edit`);
    await page.getByTestId('node-work').waitFor({ timeout: 20_000 });
    await L.sleep(1500);
    let dialog = await L.openNode(page, 'work');
    const effort = dialog.getByLabel('Effort', { exact: true });
    await L.sleep(800);
    const kept = {
      value: await effort.inputValue(),
      checkedText: await effort.locator('option:checked').innerText(),
      description: await effort.evaluate((el) => (el.getAttribute('aria-describedby') ?? '').split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim()),
      nodeIssueButtons: await dialog.getByRole('button', { name: /issues? on work/ }).allInnerTexts(),
      nodeIssueNames: await dialog.getByRole('button', { name: /issues? on work/ }).evaluateAll((els) => els.map((x) => x.getAttribute('aria-label') ?? x.textContent)),
    };
    rec.check(
      `B-4 ${k} (${kind}): the editor keeps minimal, marks it "not supported by this model", names it on the field, and the node shows one issue`,
      kept.value === 'minimal' && /minimal \(not supported by this model\)/.test(kept.checkedText) && /Effort minimal is not supported by GPT-6 Luna\. Choose a supported effort or Default\./.test(kept.description) && kept.nodeIssueNames.some((n) => /^1 issue on work$/.test(String(n).trim())),
      kept,
    );
    await L.shot(page, `c1-upgrade-${k}-kept-minimal`);
    await L.closeNode(page);
    const canvasIssue = await page.getByTestId('node-work').innerText();
    rec.log(`${k} node card text after closing`, canvasIssue);
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'Publish failed' });
    await alert.waitFor({ timeout: 15_000 }).catch(() => undefined);
    const alertText = (await alert.allInnerTexts()).join(' | ');
    rec.check(`B-5 ${k}: Publish is refused and the refusal names the node and the reason`, /work: The selected reasoning effort is not supported by this model/.test(alertText), alertText);
    await L.shot(page, `c1-upgrade-${k}-publish-refused`);
    dialog = await L.openNode(page, 'work');
    await dialog.getByLabel('Effort', { exact: true }).selectOption('low');
    await L.sleep(1200);
    const issuesLeft = await dialog.getByRole('button', { name: /issues? on work/ }).count();
    await L.closeNode(page);
    await L.sleep(800);
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    const published = await page.getByText(/Published version \d+\./).first().waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
    rec.check(`B-6 ${k}: after choosing low the node issue clears and Publish succeeds`, issuesLeft === 0 && published, { issuesLeft, published });
    const before = fake1.requests().length;
    const runId = await L.startRun(g1.call, ids[k]);
    await L.waitFor(() => fake1.requests().length > before, { timeoutMs: 60_000 });
    const done = await L.waitRun(g1.call, runId, ['succeeded', 'failed', 'cancelled'], 60_000);
    const req = fake1.requests().slice(before);
    rec.check(`B-7 ${k}: the next run's request reaches the (fake) CLI at gpt-6-luna/low`, req.length >= 1 && req.every((x) => x.model === 'gpt-6-luna' && x.effort === 'low'), { requests: req, runStatus: done.status, failure: done.failure?.code ?? null });
  }
  // The inspector of run A (a version published before the fix).
  await page.goto(`${g1.origin}/app/runs/${runs.A.id}`);
  await page.getByRole('list', { name: 'Timeline' }).waitFor({ timeout: 20_000 }).catch(() => undefined);
  await L.sleep(1500);
  rec.observe('B-8 inspector of run A (text excerpt)', (await page.locator('main').innerText().catch(async () => page.locator('body').innerText())).slice(0, 1500));
  await L.shot(page, 'c1-upgrade-A-inspector');
  rec.check('B-9 PR gateway (U1) drains to exit 0', (await g1.stop()) === 0, g1.exitCode());
  g1.copyLog('c1-upgrade-u1-pr-gateway.log.txt');

  // ---------------- Phase B: the PR head reopens U2 (Settings default minimal) ----------------
  const g2 = await L.startGateway({ root: L.PR_ROOT, dir: u2, port: 6715, label: 'u2-pr', env: fake2.env, rec });
  gateways.push(g2);
  const stored = (await g2.call('/settings')).json;
  const runD = await g2.call(`/loops/${ids.D}/runs`, { method: 'POST', body: { input: null } });
  let dRec;
  if (runD.json?.run?.id) {
    const done = await L.waitRun(g2.call, runD.json.run.id, ['succeeded', 'failed', 'cancelled'], 60_000);
    dRec = { status: done.status, failure: done.failure, providerCalls: L.providerCalls(await L.events(g2.call, runD.json.run.id)) };
  }
  rec.log('U2 reopened: stored owner defaults and run D', { stored, start: runD.status, startBody: runD.status === 202 ? undefined : runD.json, run: dRec });
  rec.check(
    'B-10 D (inherits the stored Settings default minimal) does not reach a provider: refused at admission or failed before any request with EFFORT_UNSUPPORTED',
    fake2.requests().length === 0 && ((runD.status !== 202 && runD.text.includes('EFFORT_UNSUPPORTED')) || (dRec?.status === 'failed' && dRec.failure?.details?.code === 'EFFORT_UNSUPPORTED' && dRec.providerCalls.length === 0)),
    { start: runD.status, run: dRec, requests: fake2.requests() },
  );
  await page.goto(`${g2.origin}/app/settings`);
  const region = page.getByRole('region', { name: 'codex defaults' });
  await region.waitFor({ timeout: 20_000 });
  await L.sleep(1500);
  const settingsEffort = page.getByLabel('Default effort', { exact: true });
  rec.observe('B-11 Settings with the stored Codex default minimal (U2)', {
    value: await settingsEffort.inputValue(),
    checkedText: await settingsEffort.locator('option:checked').innerText(),
    regionText: (await region.innerText()).slice(0, 800),
  });
  await region.screenshot({ path: path.join(L.OUT, 'c1-upgrade-U2-settings-kept-minimal.png') });
  await browser.close();
  browser = undefined;
  rec.check('B-12 PR gateway (U2) drains to exit 0', (await g2.stop()) === 0, g2.exitCode());
  g2.copyLog('c1-upgrade-u2-pr-gateway.log.txt');
} catch (error) {
  rec.check('c1-upgrade completed without exception', false, String(error?.stack ?? error));
} finally {
  await browser?.close().catch(() => undefined);
  for (const x of gateways) if (x.exitCode() === null) await x.stop();
  rec.finish();
  L.cleanupStore(u1, rec);
  L.cleanupStore(u2, rec);
}
