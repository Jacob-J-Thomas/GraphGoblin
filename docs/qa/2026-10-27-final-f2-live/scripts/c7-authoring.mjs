// Check 7 (integrated scenario "Authoring to execution"): in Edge, build a small loop
//   trigger -> inference -> decision (gate, 2 passes) -again-> wait (input) -> inference
//                                     \-finish / limit-reached-> exit
// with explicit model and effort on the inference node's Settings tab; save; reload and verify
// connections and inputs; publish; run it with Codex selected (v1), then with Claude selected (v2);
// start a run of v2 that parks at the wait, edit and publish v3 while it waits, start a v3 run,
// then let the v2 run continue: it must keep its pinned v2 definition, the v3 run must use v3.
//   node c7-authoring.mjs [--fake]
import * as L from './lib.mjs';

const fakeMode = process.argv.includes('--fake');
const rec = new L.Recorder(`c7-authoring${fakeMode ? '-dryrun' : ''}`);
const dir = L.makeStore('c7');
const fake = fakeMode ? L.fakeCli(dir) : null;
const env = fake ? { ...fake.env } : {};
const WORDS = { v1: 'ALPHA', v2: 'BRAVO', v3: 'CHARLIE' };
const tpl = (w) => `Reply with exactly the word ${w} and nothing else.`;
let g;
let browser;
let page;

async function openNode(id) {
  // Adding nodes can pan the canvas; fit the view so every card is inside the viewport.
  const fit = page.locator('.react-flow__controls-fitview');
  if (await fit.count()) {
    await fit.click();
    await L.sleep(400);
  }
  await page.getByTestId(`node-${id}`).locator(':scope > div:has([data-kind])').click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  return dialog;
}
async function closeNode() {
  await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
}
async function connect(dialog, output, to) {
  await dialog.getByLabel('Output', { exact: true }).selectOption(output);
  await dialog.getByLabel('To', { exact: true }).selectOption(to);
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
  await L.sleep(300);
}
async function radio(dialog, name) {
  const r = dialog.getByRole('radio', { name, exact: true });
  await r.focus();
  await page.keyboard.press('Space');
  await L.sleep(300);
  return r.isChecked();
}
async function saved() {
  await page.getByTestId('save-state').filter({ hasText: 'All changes saved' }).waitFor({ timeout: 20_000 });
}
async function draft(loopId) {
  return (await g.call(`/loops/${loopId}`)).json;
}
async function publish(n) {
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByText(`Published version ${n}.`).waitFor({ timeout: 20_000 });
}
async function startRunInUi(loopId) {
  await page.goto(`${g.origin}/app/runs/new?loop=${loopId}`);
  await page.getByRole('button', { name: 'Start run' }).click();
  await page.waitForURL(/\/app\/runs\/[0-9A-Z]{26}$/);
  return page.url().split('/').at(-1);
}
async function answerWaitInUi(runId) {
  await page.goto(`${g.origin}/app/runs/${runId}`);
  await page.getByText('Input requested').waitFor({ timeout: 60_000 });
  await page.getByLabel('Input (JSON)').fill('{"go": true}');
  await page.getByRole('button', { name: 'Submit input' }).click();
}
const edgesOf = (def) => def.edges.map((e) => `${e.from.node}:${e.from.port ?? 'out'}->${e.to.node}`).sort();
const EXPECTED_EDGES = ['decision:again->wait', 'decision:finish->done', 'decision:limit-reached->done', 'inference:out->decision', 'start:out->inference', 'wait:out->inference'].sort();

async function runFacts(runId) {
  const snap = (await g.call(`/runs/${runId}`)).json;
  const evs = await L.events(g.call, runId);
  return {
    status: snap.status,
    failure: snap.failure,
    pinned: { version: snap.pinned?.version, label: snap.pinned?.label, versionId: snap.versionId },
    turns: evs.filter((e) => e.type === 'harness.turn').map((e) => ({ harness: e.harness, prompt: e.prompt })),
    sessions: evs.filter((e) => e.type === 'harness.session').map((e) => ({ harness: e.harness, mode: e.mode, model: e.model, effort: e.effort })),
    replies: L.nodeReplies(evs, 'inference'),
    calls: L.providerCalls(evs),
  };
}

try {
  g = await L.startGateway({ dir, port: 6646, label: 'c7', env, rec });
  browser = await L.launchEdge();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  // ---- Author v1 ----
  await page.goto(`${g.origin}/app/loops`);
  await page.getByLabel('New loop name').fill('F2 authoring');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL(/\/app\/loops\/[0-9A-Z]{26}\/edit$/);
  const loopId = page.url().split('/').at(-2);
  let dialog = await openNode('start');
  await dialog.getByRole('button', { name: 'Remove edge e1' }).click();
  await closeNode();
  for (const kind of ['Inference', 'Decision', 'Wait']) {
    await page.getByRole('button', { name: `Add ${kind} node` }).click();
    await page.getByTestId(`node-${kind.toLowerCase()}`).waitFor();
  }
  dialog = await openNode('start');
  await connect(dialog, 'out', 'inference');
  await closeNode();

  dialog = await openNode('inference');
  rec.check('C7-1 the inference node opens on its Settings tab with Codex selected', (await dialog.getByRole('tab', { name: /^Settings/ }).getAttribute('aria-selected')) === 'true' && (await dialog.getByRole('radio', { name: 'codex', exact: true }).isChecked()), null);
  await dialog.getByLabel('Model', { exact: true }).selectOption('gpt-6-luna');
  await dialog.getByLabel('Effort', { exact: true }).selectOption('low');
  await dialog.locator('[data-field="prompt.template"] [role="textbox"]').fill(tpl(WORDS.v1));
  await connect(dialog, 'out', 'decision');
  await L.shot(page, `${rec.name}-v1-inference-settings`);
  await closeNode();

  dialog = await openNode('decision');
  await dialog.locator('[data-field="jsonata"] [role="textbox"]').fill('"again"');
  await dialog.locator('[data-field="routes.0.id"] input').fill('again');
  await dialog.locator('[data-field="routes.0.label"] input').fill('Again');
  await dialog.locator('[data-field="routes.1.id"] input').fill('finish');
  await dialog.locator('[data-field="routes.1.label"] input').fill('Finish');
  await dialog.locator('[data-field="routes.0.repeat"]').getByRole('switch').click();
  await L.sleep(500);
  const maxPasses = dialog.locator('[data-field="maxPasses"] input[type="number"], [data-field="maxPasses"] input:not([type="radio"]):not([type="checkbox"])').first();
  if (await maxPasses.count()) await maxPasses.fill('2');
  else rec.log('maxPasses control not found; decision dialog controls', await dialog.locator('[data-field]').evaluateAll((els) => els.map((e) => e.getAttribute('data-field'))));
  await connect(dialog, 'again', 'wait');
  await connect(dialog, 'finish', 'done');
  await connect(dialog, 'limit-reached', 'done');
  await L.shot(page, `${rec.name}-v1-decision`);
  await closeNode();

  dialog = await openNode('wait');
  await dialog.locator('[data-field="prompt"] [role="textbox"]').fill('Continue the authoring check?');
  await connect(dialog, 'out', 'inference');
  await closeNode();
  await saved();
  const before = (await draft(loopId)).draft.definition;
  rec.log('v1 draft as saved', { nodes: before.nodes.map((n) => ({ id: n.id, kind: n.kind, config: n.config })), edges: edgesOf(before) });
  await page.locator('.react-flow__controls-fitview').click().catch(() => undefined);
  await L.shot(page, `${rec.name}-v1-canvas`);

  // ---- Reload: connections and inputs survive ----
  await page.reload();
  await page.getByTestId('node-inference').waitFor();
  const reloaded = (await draft(loopId)).draft.definition;
  const canvasEdges = await page.locator('.react-flow__edge').count();
  rec.check('C7-2 after save and reload the draft keeps all six connections', JSON.stringify(edgesOf(reloaded)) === JSON.stringify(EXPECTED_EDGES) && canvasEdges === 6, { edges: edgesOf(reloaded), canvasEdges });
  dialog = await openNode('inference');
  const ui = {
    model: await dialog.getByLabel('Model', { exact: true }).inputValue(),
    effort: await dialog.getByLabel('Effort', { exact: true }).inputValue(),
    template: (await dialog.locator('[data-field="prompt.template"] [role="textbox"]').innerText()).trim(),
  };
  await closeNode();
  dialog = await openNode('decision');
  const dui = {
    jsonata: (await dialog.locator('[data-field="jsonata"] [role="textbox"]').innerText()).trim(),
    route0: await dialog.locator('[data-field="routes.0.id"] input').inputValue(),
    route1: await dialog.locator('[data-field="routes.1.id"] input').inputValue(),
    repeat: await dialog.locator('[data-field="routes.0.repeat"]').getByRole('switch').getAttribute('aria-checked'),
  };
  await closeNode();
  const infCfg = reloaded.nodes.find((n) => n.id === 'inference').config;
  const decCfg = reloaded.nodes.find((n) => n.id === 'decision').config;
  rec.check('C7-2 after reload the inference inputs are intact (model, effort, template) in the editor and the draft', ui.model === 'gpt-6-luna' && ui.effort === 'low' && ui.template === tpl(WORDS.v1) && infCfg.model === 'gpt-6-luna' && infCfg.effort === 'low' && infCfg.prompt.template === tpl(WORDS.v1), { ui, infCfg });
  rec.check('C7-2 after reload the decision inputs are intact (expression, routes, repeat, passes)', dui.jsonata === '"again"' && dui.route0 === 'again' && dui.route1 === 'finish' && dui.repeat === 'true' && decCfg.maxPasses === 2 && decCfg.routes[0].repeat === true, { dui, decCfg });
  await publish(1);
  await L.shot(page, `${rec.name}-v1-published`);

  // ---- R1: run v1 with Codex ----
  const r1 = await startRunInUi(loopId);
  await answerWaitInUi(r1);
  await L.waitRun(g.call, r1, ['succeeded', 'failed', 'cancelled'], 300_000);
  await page.goto(`${g.origin}/app/runs/${r1}`);
  await page.locator('[data-status="succeeded"], [data-status="failed"]').first().waitFor({ timeout: 30_000 }).catch(() => undefined);
  await L.shot(page, `${rec.name}-r1-codex-inspector`);
  const f1 = await runFacts(r1);
  for (const t of f1.calls) rec.turn({ check: 'C7', provider: 'codex', model: 'gpt-6-luna', effort: 'low', run: r1, ...t, fake: fakeMode });
  rec.log('R1 (v1, Codex)', f1);
  rec.check('C7-3 R1 (v1, Codex) succeeds with two Codex turns at gpt-6-luna/low using the v1 prompt', f1.status === 'succeeded' && f1.pinned.version === 1 && f1.turns.length === 2 && f1.turns.every((t) => t.harness === 'codex' && t.prompt === tpl(WORDS.v1)) && f1.sessions.every((s) => s.model === 'gpt-6-luna' && s.effort === 'low'), f1);
  if (!fake) rec.check('C7-3 R1 replies ALPHA', f1.replies.every((r) => r.includes(WORDS.v1)), f1.replies);

  // ---- v2: switch to Claude ----
  await page.goto(`${g.origin}/app/loops/${loopId}/edit`);
  await page.getByTestId('node-inference').waitFor();
  dialog = await openNode('inference');
  rec.check('C7-4 choosing claude selects the Claude harness', await radio(dialog, 'claude'), null);
  await dialog.getByLabel('Model', { exact: true }).selectOption('claude-haiku-5-5');
  await dialog.getByLabel('Effort', { exact: true }).selectOption('low');
  const policy = dialog.getByLabel('Sandbox and approval policy', { exact: true });
  await policy.selectOption({ index: 0 });
  await dialog.locator('[data-field="prompt.template"] [role="textbox"]').fill(tpl(WORDS.v2));
  await L.shot(page, `${rec.name}-v2-inference-settings`);
  await closeNode();
  await saved();
  await publish(2);
  const v2def = (await g.call(`/loops/${loopId}`)).json.current?.definition ?? (await draft(loopId)).draft.definition;
  rec.log('v2 inference config as published', v2def.nodes.find((n) => n.id === 'inference').config);
  rec.check('C7-4 v2 keeps the six connections after the harness switch', JSON.stringify(edgesOf(v2def)) === JSON.stringify(EXPECTED_EDGES), edgesOf(v2def));

  // ---- R2: run v2 with Claude ----
  const r2 = await startRunInUi(loopId);
  await answerWaitInUi(r2);
  await L.waitRun(g.call, r2, ['succeeded', 'failed', 'cancelled'], 300_000);
  const f2 = await runFacts(r2);
  for (const t of f2.calls) rec.turn({ check: 'C7', provider: 'claude', model: 'claude-haiku-5-5', effort: 'low', run: r2, ...t, fake: fakeMode });
  rec.log('R2 (v2, Claude)', f2);
  await page.goto(`${g.origin}/app/runs/${r2}`);
  await page.locator('[data-status="succeeded"], [data-status="failed"]').first().waitFor({ timeout: 30_000 }).catch(() => undefined);
  await L.shot(page, `${rec.name}-r2-claude-inspector`);
  rec.check('C7-5 R2 (v2, Claude) succeeds with two Claude turns at claude-haiku-5-5/low using the v2 prompt', f2.status === 'succeeded' && f2.pinned.version === 2 && f2.turns.length === 2 && f2.turns.every((t) => t.harness === 'claude' && t.prompt === tpl(WORDS.v2)) && f2.sessions.every((s) => s.model === 'claude-haiku-5-5' && s.effort === 'low'), f2);
  if (!fake) rec.check('C7-5 R2 replies BRAVO', f2.replies.every((r) => r.includes(WORDS.v2)), f2.replies);

  // ---- R3 of v2 waits; publish v3 meanwhile; R4 of v3 ----
  const r3 = await startRunInUi(loopId);
  const r3wait = await L.waitRun(g.call, r3, ['waiting', 'failed', 'succeeded'], 300_000);
  rec.check('C7-6 R3 (v2) parks at the wait after its first turn', r3wait.status === 'waiting' && r3wait.pinned?.version === 2, { status: r3wait.status, pinned: r3wait.pinned?.version });
  await page.goto(`${g.origin}/app/loops/${loopId}/edit`);
  await page.getByTestId('node-inference').waitFor();
  dialog = await openNode('inference');
  await dialog.locator('[data-field="prompt.template"] [role="textbox"]').fill(tpl(WORDS.v3));
  await closeNode();
  await saved();
  await publish(3);
  await L.shot(page, `${rec.name}-v3-published-while-r3-waits`);
  const r4 = await startRunInUi(loopId);
  const r4wait = await L.waitRun(g.call, r4, ['waiting', 'failed', 'succeeded'], 300_000);
  await page.goto(`${g.origin}/app/runs/${r4}`);
  await page.getByRole('button', { name: 'Cancel run' }).click();
  await L.waitRun(g.call, r4, ['cancelled', 'failed', 'succeeded'], 60_000);
  const f4 = await runFacts(r4);
  for (const t of f4.calls) rec.turn({ check: 'C7', provider: 'claude', model: 'claude-haiku-5-5', effort: 'low', run: r4, ...t, fake: fakeMode });
  rec.log('R4 (v3)', f4);
  rec.check('C7-7 R4 is pinned to v3 and its turn uses the v3 prompt', r4wait.status === 'waiting' && f4.pinned.version === 3 && f4.turns.length === 1 && f4.turns[0].prompt === tpl(WORDS.v3), { status: r4wait.status, f4 });
  await answerWaitInUi(r3);
  await L.waitRun(g.call, r3, ['succeeded', 'failed', 'cancelled'], 300_000);
  const f3 = await runFacts(r3);
  for (const t of f3.calls) rec.turn({ check: 'C7', provider: 'claude', model: 'claude-haiku-5-5', effort: 'low', run: r3, ...t, fake: fakeMode });
  rec.log('R3 (v2, continued after v3 was published)', f3);
  await page.goto(`${g.origin}/app/runs/${r3}`);
  await page.locator('[data-status="succeeded"], [data-status="failed"]').first().waitFor({ timeout: 30_000 }).catch(() => undefined);
  const ctx = (await page.locator('body').innerText()).match(/F2 authoring v\d[^\n]*/)?.[0] ?? null;
  await L.shot(page, `${rec.name}-r3-pinned-inspector`);
  rec.check('C7-8 R3 keeps its pinned v2 definition after v3 was published: both turns use the v2 prompt', f3.status === 'succeeded' && f3.pinned.version === 2 && f3.turns.length === 2 && f3.turns.every((t) => t.prompt === tpl(WORDS.v2)), f3);
  rec.check('C7-8 the R3 inspector names the pinned version v2', Boolean(ctx) && ctx.includes('v2'), ctx);
  if (!fake) rec.check('C7-8 R3 replies BRAVO on both visits', f3.replies.length === 2 && f3.replies.every((r) => r.includes(WORDS.v2)), f3.replies);
  const versions = (await g.call(`/loops/${loopId}/versions`)).json;
  rec.log('loop versions', versions?.items?.map((v) => ({ version: v.version, status: v.status })) ?? versions);
  await browser.close();
  browser = undefined;
  const code = await g.stop();
  rec.check('C7-9 gateway drains to exit 0', code === 0, code);
  g.copyLog(`${rec.name}-gateway.log.txt`);
} catch (error) {
  rec.check('c7 completed without exception', false, String(error?.stack ?? error));
  if (page) await L.shot(page, `${rec.name}-exception`).catch(() => undefined);
} finally {
  await browser?.close().catch(() => undefined);
  if (g && g.exitCode() === null) await g.stop();
  rec.finish();
  L.cleanupStore(dir, rec);
}
