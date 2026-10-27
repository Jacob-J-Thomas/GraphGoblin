// Check 4 (#205 D1), editor level in Edge, acceptance group A s5 re-run and extended. The built web
// app served by the built API with the real adapters and group A's recording CLI.
//  - Codex inference: max is offered (GPT-6 Sol inherited), saved, survives reload, and is sent and
//    recorded as max. Default (medium) sends medium; after owner Settings high, Default (high)
//    sends high (regression).
//  - Switching the node to GPT-5.5: max is no longer offered; a kept max shows as unsupported; the
//    editor cannot store or publish that change (the server refuses the draft save with
//    EFFORT_UNSUPPORTED) and nothing is sent;
//    choosing xhigh publishes and sends xhigh.
//  - LLM decision: GPT-6 Luna offers max and sends max; GPT-5.5 offers no max.
//  - Claude inference: low..max without minimal; max sends --effort max (regression).
import path from 'node:path';
import * as L from './lib.mjs';

const rec = new L.Recorder('s6-effort-browser');
const dir = L.makeStore('s6');
let g;
let browser;
try {
  const cli = L.sessionCli(dir);
  g = await L.startGateway({
    dir,
    port: 6533,
    label: 's6',
    env: { ...cli.env, GG_DEFAULTS: JSON.stringify({ byHarness: { codex: { model: 'gpt-6-sol', effort: 'medium' } } }) },
    rec,
  });
  const call = g.call;
  browser = await L.launchEdge();
  const context = await browser.newContext({ baseURL: g.origin, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const draftResponses = [];
  page.on('response', async (response) => {
    const req = response.request();
    if (req.method() === 'PUT' && /\/loops\/[^/]+\/draft$/.test(new URL(response.url()).pathname)) {
      let body;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      draftResponses.push({ status: response.status(), body });
    }
  });

  const openEditor = async (loopId, name) => {
    await page.goto(`/app/loops/${loopId}/edit`);
    await page.getByRole('heading', { name, exact: true }).waitFor();
    await page.getByText('The editor is available. Checking the server and this device before saving changes.', { exact: true }).waitFor({ state: 'hidden' });
  };
  const openNode = async (nodeId) => {
    await page.getByTestId(`node-${nodeId}`).locator(':scope > div:has([data-kind])').click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    return dialog;
  };
  const closeNode = async () => {
    await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
  };
  const saved = () => page.getByTestId('save-state').filter({ hasText: 'All changes saved' }).waitFor();
  const draftNode = async (loopId, nodeId) => (await call(`/loops/${loopId}`)).json.draft?.definition.nodes.find((n) => n.id === nodeId);
  const pollDraft = async (loopId, nodeId, predicate) => {
    for (let i = 0; i < 100; i += 1) {
      const node = await draftNode(loopId, nodeId);
      if (node && predicate(node)) return node;
      await L.sleep(100);
    }
    return draftNode(loopId, nodeId);
  };
  const values = (select) => select.locator('option').evaluateAll((els) => els.map((el) => el.value));
  const described = (locator) =>
    locator.evaluate((el) =>
      (el.getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent?.trim())
        .join(' | '),
    );
  const forRun = (runId, marker) => cli.requests().filter((q) => q.prompt.includes(`${marker} run=${runId} `));
  async function publishAndRun(loopId, marker) {
    const published = await call(`/loops/${loopId}/publish`, { method: 'POST' });
    if (published.status !== 200 && published.json?.code !== 'NO_DRAFT') return { published: published.status, body: published.json };
    const started = await call(`/loops/${loopId}/runs`, { method: 'POST', body: {} });
    const runId = started.json.run.id;
    const end = await L.waitRun(call, runId, ['succeeded', 'failed']);
    const reqs = forRun(runId, marker).map((q) => ({ model: q.model, effort: q.effort, argv: q.argv.find((a) => /reasoning_effort/.test(a)) ?? `--effort ${q.argv[q.argv.indexOf('--effort') + 1]}` }));
    const sessions = (await call(`/runs/${runId}/sessions`)).json.items ?? [];
    return { runId, status: end.status, failure: end.failure, requests: reqs, sessionRow: sessions[0] && { model: sessions[0].model, effort: sessions[0].effort } };
  }
  const inference = (name, marker, config) => ({
    schemaVersion: 4,
    name,
    settings: {},
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', ui: { x: 0, y: 80 }, config: { type: 'manual' } },
      {
        id: 'work',
        kind: 'inference',
        label: 'Work',
        ui: { x: 260, y: 80 },
        config: { harnessOptions: { sandbox: 'read-only', approval: 'never' }, prompt: { template: `${marker} run={{ run.id }} task.` }, ...config },
      },
      { id: 'done', kind: 'exit', label: 'Done', ui: { x: 520, y: 80 }, config: {} },
    ],
    edges: [
      { id: 's-w', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      { id: 'w-d', from: { node: 'work', port: 'out' }, to: { node: 'done' } },
    ],
  });

  // ---------- Codex inference ----------
  {
    const name = 'qa417 codex inference';
    const loopId = (await call('/loops', { method: 'POST', body: { definition: inference(name, 'UICX', { harness: 'codex' }) } })).json.loop.id;
    await openEditor(loopId, name);
    let dialog = await openNode('work');
    const effort = dialog.getByLabel('Effort', { exact: true });
    await effort.locator('option').first().filter({ hasText: 'Default (medium)' }).waitFor({ state: 'attached' });
    const offeredSol = await values(effort);
    const textsSol = await effort.locator('option').allTextContents();
    rec.log('Codex inference (inherited GPT-6 Sol) effort options', { values: offeredSol, texts: textsSol });
    rec.check('B1 a Codex model that lists max offers max as a plain choice', JSON.stringify(offeredSol) === JSON.stringify(['', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) && textsSol.at(-1) === 'max', textsSol);
    await effort.selectOption('max');
    await L.shot(page, 's6-codex-max-selected');
    await closeNode();
    await saved();
    const savedNode = await pollDraft(loopId, 'work', (n) => n.config.effort === 'max');
    await page.reload();
    await openEditor(loopId, name);
    dialog = await openNode('work');
    const reloaded = await dialog.getByLabel('Effort', { exact: true }).inputValue();
    await closeNode();
    const maxRun = await publishAndRun(loopId, 'UICX');
    rec.log('Codex max via the editor', { saved: savedNode.config.effort, reloaded, run: maxRun });
    rec.check('B1 max is saved, survives reload, is sent as model_reasoning_effort="max" and the session row records max', savedNode.config.effort === 'max' && reloaded === 'max' && maxRun.status === 'succeeded' && maxRun.requests.length === 1 && maxRun.requests[0].argv === 'model_reasoning_effort="max"' && maxRun.sessionRow?.effort === 'max', maxRun);

    // Default label versus request.
    dialog = await openNode('work');
    await dialog.getByLabel('Effort', { exact: true }).selectOption('');
    await closeNode();
    await saved();
    await pollDraft(loopId, 'work', (n) => n.config.effort === undefined);
    const defRun = await publishAndRun(loopId, 'UICX');
    rec.check('B2 Default (medium) removes the override and medium is sent', defRun.requests[0]?.argv === 'model_reasoning_effort="medium"' && defRun.sessionRow?.effort === 'medium', defRun);
    await call('/settings', { method: 'PUT', body: { defaults: { byHarness: { codex: { effort: 'high' } } } } });
    dialog = await openNode('work');
    const ownerEffort = dialog.getByLabel('Effort', { exact: true });
    await ownerEffort.locator('option').first().filter({ hasText: 'Default (high)' }).waitFor({ state: 'attached', timeout: 15_000 }).catch(() => undefined);
    const ownerLabel = await ownerEffort.locator('option').first().textContent();
    await closeNode();
    const ownerRun = await publishAndRun(loopId, 'UICX');
    rec.check('B2 after owner Settings high the editor shows Default (high) and high is sent', ownerLabel === 'Default (high)' && ownerRun.requests[0]?.argv === 'model_reasoning_effort="high"', { ownerLabel, ownerRun });
    await call('/settings/defaults', { method: 'DELETE' });

    // GPT-5.5: max not offered; kept max shown unsupported; the draft cannot publish or run.
    dialog = await openNode('work');
    await dialog.getByLabel('Effort', { exact: true }).selectOption('max');
    await dialog.getByLabel('Model', { exact: true }).selectOption('gpt-5.5');
    const eff55 = dialog.getByLabel('Effort', { exact: true });
    const checked = await eff55.locator('option:checked').textContent();
    const desc = await described(eff55);
    const offered55 = (await values(eff55)).filter((v) => v !== 'max' || checked !== 'max (not supported by this model)');
    const allValues55 = await values(eff55);
    const allTexts55 = await eff55.locator('option').allTextContents();
    await L.shot(page, 's6-gpt55-kept-max');
    rec.log('GPT-5.5 with a kept max', { checked, description: desc, values: allValues55, texts: allTexts55 });
    rec.check('B3 on GPT-5.5 the kept max is shown as "max (not supported by this model)" with a not-supported description', checked === 'max (not supported by this model)' && /not supported/i.test(desc), { checked, desc });
    rec.check('B3 GPT-5.5 offers minimal..xhigh and no selectable max', JSON.stringify(offered55) === JSON.stringify(['', 'minimal', 'low', 'medium', 'high', 'xhigh']), { allValues55, allTexts55 });
    // Attempt 1 of this record assumed the editor stores this draft. It does not: the server
    // refuses the draft save itself (attempts/s6-attempt1-*). Observe that refusal instead.
    const before = cli.requests().length;
    await closeNode();
    await page.getByText('Save failed', { exact: true }).waitFor({ timeout: 20_000 });
    const draftSave = draftResponses.at(-1);
    rec.log('GPT-5.5/max: the editor draft save and its response', draftSave);
    const headerText = await page.locator('body').innerText();
    const saveLines = headerText.split('\n').filter((l) => /Save failed|EVALUATION|EFFORT|not supported|could not be saved/i.test(l)).slice(0, 8);
    await L.shot(page, 's6-gpt55-max-save-refused');
    rec.log('editor lines after the refused save', saveLines);
    rec.check(
      'B3 the editor cannot store a GPT-5.5/max draft: the server refuses the draft save 400 with EFFORT_UNSUPPORTED and the editor shows Save failed',
      draftSave?.status === 400 && JSON.stringify(draftSave.body).includes('EFFORT_UNSUPPORTED') && saveLines.includes('Save failed'),
      { status: draftSave?.status, code: draftSave?.body?.code, errors: draftSave?.body?.errors },
    );
    // The editor's own Publish control while that change is unsaved.
    await page.getByRole('button', { name: 'Publish', exact: true }).click().catch(() => undefined);
    await page.getByText('Publish failed', { exact: true }).waitFor({ timeout: 15_000 }).catch(() => undefined);
    await L.shot(page, 's6-gpt55-max-publish-attempt');
    const pageText = await page.locator('body').innerText();
    const publishMessage = pageText.split('\n').filter((l) => /Publish failed|could not be saved|EVALUATION|EFFORT|not supported/i.test(l)).slice(0, 8);
    rec.log('editor Publish while the GPT-5.5/max change is unsaved', publishMessage);
    const loopAfter = (await call(`/loops/${loopId}`)).json;
    rec.check(
      'B3 Publish refuses too ("Publish failed"); no stored draft or published version names gpt-5.5; no CLI request was made',
      publishMessage.includes('Publish failed') && !JSON.stringify(loopAfter).includes('gpt-5.5') && cli.requests().length === before,
      { publishMessage, requestsMade: cli.requests().length - before },
    );
    dialog = await openNode('work');
    await dialog.getByLabel('Effort', { exact: true }).selectOption('xhigh');
    await closeNode();
    await saved();
    await pollDraft(loopId, 'work', (n) => n.config.effort === 'xhigh');
    const x55 = await publishAndRun(loopId, 'UICX');
    rec.check('B4 GPT-5.5/xhigh publishes and is sent as xhigh', x55.status === 'succeeded' && x55.requests[0]?.model === 'gpt-5.5' && x55.requests[0]?.argv === 'model_reasoning_effort="xhigh"' && x55.sessionRow?.effort === 'xhigh', x55);
  }

  // ---------- LLM decision ----------
  {
    const name = 'qa417 llm decision';
    const def = {
      schemaVersion: 4,
      name,
      settings: {},
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', ui: { x: 0, y: 80 }, config: { type: 'manual' } },
        {
          id: 'pick',
          kind: 'decision',
          label: 'Pick',
          ui: { x: 260, y: 80 },
          config: {
            kind: 'llm',
            harness: 'codex',
            instructions: 'UIDEC run={{ run.id }} choose',
            model: { mode: 'inherit' },
            effort: { mode: 'inherit' },
            routes: [
              { id: 'yes', label: 'Yes' },
              { id: 'no', label: 'No' },
            ],
          },
        },
        { id: 'done', kind: 'exit', label: 'Done', ui: { x: 520, y: 80 }, config: {} },
      ],
      edges: [
        { id: 's-p', from: { node: 'start', port: 'out' }, to: { node: 'pick' } },
        { id: 'p-y', from: { node: 'pick', port: 'yes' }, to: { node: 'done' } },
        { id: 'p-n', from: { node: 'pick', port: 'no' }, to: { node: 'done' } },
      ],
    };
    const loopId = (await call('/loops', { method: 'POST', body: { definition: def } })).json.loop.id;
    await openEditor(loopId, name);
    let dialog = await openNode('pick');
    await dialog.getByLabel('Model', { exact: true }).selectOption('gpt-5.5');
    const dec55 = await values(dialog.getByLabel('Effort', { exact: true }));
    await dialog.getByLabel('Model', { exact: true }).selectOption('gpt-6-luna');
    const decLuna = await values(dialog.getByLabel('Effort', { exact: true }));
    await dialog.getByLabel('Effort', { exact: true }).selectOption('max');
    await L.shot(page, 's6-decision-luna-max');
    await closeNode();
    await saved();
    const node = await pollDraft(loopId, 'pick', (n) => n.config.effort?.value === 'max');
    const published = await call(`/loops/${loopId}/publish`, { method: 'POST' });
    const started = await call(`/loops/${loopId}/runs`, { method: 'POST', body: {} });
    const end = await L.waitRun(call, started.json.run.id, ['succeeded', 'failed']);
    const reqs = forRun(started.json.run.id, 'UIDEC');
    const made = (await L.events(call, started.json.run.id)).find((e) => e.type === 'decision.made');
    rec.log('LLM decision via the editor', { dec55, decLuna, saved: { model: node.config.model, effort: node.config.effort }, published: published.status, status: end.status, argv: reqs.map((q) => q.argv.find((a) => /reasoning_effort/.test(a))), provenance: made?.provenance });
    rec.check('B5 LLM decision on GPT-5.5 offers no max', !dec55.includes('max') && dec55.includes('xhigh'), dec55);
    rec.check('B5 LLM decision on GPT-6 Luna offers max', decLuna.includes('max'), decLuna);
    rec.check(
      'B5 LLM decision max is saved, sent as max and recorded as max (decision provenance)',
      node.config.effort?.value === 'max' && end.status === 'succeeded' && reqs.length === 1 && reqs[0].argv.includes('model_reasoning_effort="max"') && made?.provenance?.effort === 'max' && made?.provenance?.model === 'gpt-6-luna',
      { argv: reqs.map((q) => q.argv.find((a) => /reasoning_effort/.test(a))), provenance: made?.provenance },
    );
    void dialog;
  }

  // ---------- Claude inference (regression) ----------
  {
    const name = 'qa417 claude inference';
    const loopId = (await call('/loops', { method: 'POST', body: { definition: inference(name, 'UICL', { harness: 'claude', model: 'claude-opus-5-5', effort: 'low' }) } })).json.loop.id;
    await openEditor(loopId, name);
    const dialog = await openNode('work');
    const effort = dialog.getByLabel('Effort', { exact: true });
    const vals = await values(effort);
    await effort.selectOption('max');
    await closeNode();
    await saved();
    await pollDraft(loopId, 'work', (n) => n.config.effort === 'max');
    const run = await publishAndRun(loopId, 'UICL');
    rec.check('B6 Claude offers low..max without minimal and max sends --effort max', !vals.includes('minimal') && ['low', 'medium', 'high', 'xhigh', 'max'].every((v) => vals.includes(v)) && run.requests[0]?.argv === '--effort max', { vals, run });
  }
  await browser.close();
  browser = undefined;
  await call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
  rec.check('B7 gateway drains to exit 0', (await g.waitExit(30_000)) === 0, g.exitCode());
  g.copyLog('s6-gateway.log.txt');
} catch (error) {
  rec.check('S6 completed without exception', false, String(error?.stack ?? error));
} finally {
  await browser?.close().catch(() => undefined);
  if (g && g.exitCode() === null) {
    await g.call('/system/shutdown', { method: 'POST', body: { action: 'force' } }).catch(() => undefined);
    await g.waitExit(20_000);
  }
  rec.finish();
  L.cleanupStore(dir, rec);
}
void path;
