// Browser checks on the built web app served by the built API (real adapters, recording fake CLIs),
// driven through headless Microsoft Edge with Playwright: #205 model/effort controls against the
// actual CLI request, #33's session control, and #265's inspector recovery choice.
import { createRequire } from 'node:module';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import {
  CLI,
  RECORD,
  ROOT,
  WORKTREE,
  byMarker,
  call,
  createPublished,
  edge,
  events,
  gate,
  get,
  loop,
  post,
  put,
  requests,
  resetCli,
  saveJson,
  startApi,
  startRun,
  summarize,
  waitRun,
} from './lib.mjs';

const require = createRequire(join(WORKTREE, 'apps/web/package.json'));
const { chromium } = require('@playwright/test');

const checks = [];
function check(id, description, pass, detail) {
  checks.push({ id, description, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id}: ${description}`);
  if (!pass) console.log('  detail: ' + JSON.stringify(detail));
}
const evidence = {};
const PROCESS_DEFAULTS = { byHarness: { codex: { model: 'gpt-6-sol', effort: 'medium' } } };
const api = await startApi({
  name: 's5',
  port: 6445,
  dataDir: join(ROOT, 'data-s5'),
  env: { GG_DEFAULTS: JSON.stringify(PROCESS_DEFAULTS) },
});
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ baseURL: api.base, viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const shot = (name, target = page) => target.screenshot({ path: join(RECORD, name) });

async function openEditor(loopId, name) {
  await page.bringToFront();
  await page.goto(`/app/loops/${loopId}/edit`);
  await page.getByRole('heading', { name, exact: true }).waitFor();
  await page
    .getByText('The editor is available. Checking the server and this device before saving changes.', { exact: true })
    .waitFor({ state: 'hidden' });
}
async function openNode(nodeId) {
  await page.getByTestId(`node-${nodeId}`).locator(':scope > div:has([data-kind])').click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  return dialog;
}
async function closeNode() {
  await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
}
async function saved() {
  await page.getByTestId('save-state').filter({ hasText: 'All changes saved' }).waitFor();
}
async function draftNode(loopId, nodeId) {
  const body = await get(api.base, `/loops/${loopId}`);
  return body.draft.definition.nodes.find((n) => n.id === nodeId);
}
async function pollDraft(loopId, nodeId, predicate) {
  for (let i = 0; i < 100; i += 1) {
    const node = await draftNode(loopId, nodeId);
    if (predicate(node)) return node;
    await delay(100);
  }
  return draftNode(loopId, nodeId);
}
async function described(locator) {
  return locator.evaluate((el) =>
    (el.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .join(' | '),
  );
}
async function publishAndRun(loopId, marker) {
  // A published loop without newer edits has no draft (409 NO_DRAFT): run the current version.
  const published = await call(api.base, 'POST', `/loops/${loopId}/publish`, {});
  if (published.status !== 200 && published.body?.code !== 'NO_DRAFT')
    throw new Error('publish failed: ' + JSON.stringify(published.body));
  const run = await startRun(api.base, loopId);
  const end = await waitRun(api.base, run.id, ['succeeded', 'failed']);
  const reqs = byMarker(await requests(), `${marker} run=${run.id} `).map(summarize);
  return { runId: run.id, status: end.status, failure: end.failure, requests: reqs };
}
function inferenceLoop(name, marker, config = {}) {
  return loop(
    name,
    [
      {
        id: 'work',
        kind: 'inference',
        label: 'Work',
        ui: { x: 260, y: 80 },
        config: {
          harnessOptions: { sandbox: 'read-only', approval: 'never' },
          prompt: { template: `${marker} run={{ run.id }} task.` },
          ...config,
        },
      },
    ],
    [edge('s-w', 'start', 'work'), edge('w-d', 'work', 'done')],
  ).nodes.map((node, index) => ({ ...node, ui: node.ui ?? { x: index * 260, y: 80 } }));
}
function withNodes(name, nodes, edges) {
  return { schemaVersion: 4, name, settings: {}, nodes, edges };
}

try {
  await resetCli();

  // ---------- #205 inference (Codex): placement, one effort control, labels vs requests ----------
  {
    const name = 'acc-a 205 codex';
    const nodes = inferenceLoop(name, 'UI205');
    const loopId = (await post(api.base, '/loops', { definition: withNodes(name, nodes, [edge('s-w', 'start', 'work'), edge('w-d', 'work', 'done')]) }, 201)).loop.id;
    await openEditor(loopId, name);
    let dialog = await openNode('work');
    const settingsTab = dialog.getByRole('tab', { name: /^Settings/ });
    const advanced = dialog.getByRole('button', { name: /^Advanced\b/ });
    const model = dialog.getByLabel('Model', { exact: true });
    const effort = dialog.getByLabel('Effort', { exact: true });
    await effort.locator('option').first().filter({ hasText: 'Default (medium)' }).waitFor({ state: 'attached' });
    const placement = {
      settingsSelected: await settingsTab.getAttribute('aria-selected'),
      advancedExpanded: await advanced.first().getAttribute('aria-expanded'),
      modelVisible: await model.isVisible(),
      effortVisible: await effort.isVisible(),
      effortControls: await dialog.getByLabel(/effort/i).count(),
      modeOrExplicitControls: await dialog.getByLabel(/\b(mode|explicit)\b/i).count(),
      effortTag: await effort.evaluate((el) => el.tagName),
      effortOptions: await effort.locator('option').allTextContents(),
      effortValues: await effort.locator('option').evaluateAll((els) => els.map((el) => el.value)),
      modelOptions: (await model.locator('option').allTextContents()).slice(0, 3),
      modelDescription: await described(model),
      effortDescription: await described(effort),
    };
    evidence['205-codex-placement'] = placement;
    await shot('205-codex-inference-settings.png', dialog);
    check(
      '205-ui-placement',
      'inference Settings tab shows Model and one Effort dropdown with Advanced collapsed; no separate Mode/Explicit selector; Default names the inherited effort',
      placement.settingsSelected === 'true' &&
        placement.advancedExpanded === 'false' &&
        placement.modelVisible &&
        placement.effortVisible &&
        placement.effortControls === 1 &&
        placement.modeOrExplicitControls === 0 &&
        placement.effortTag === 'SELECT' &&
        placement.effortOptions[0] === 'Default (medium)' &&
        /gpt-6-sol/.test(placement.modelDescription + placement.modelOptions.join()),
      placement,
    );

    // Explicit choice: edit, save, reload, provider request.
    await effort.selectOption('xhigh');
    await closeNode();
    await saved();
    const savedNode = await pollDraft(loopId, 'work', (n) => n.config.effort === 'xhigh');
    await page.reload();
    await openEditor(loopId, name);
    dialog = await openNode('work');
    const reloaded = await dialog.getByLabel('Effort', { exact: true }).inputValue();
    await closeNode();
    const explicitRun = await publishAndRun(loopId, 'UI205');
    evidence['205-codex-explicit'] = { savedConfig: savedNode.config, reloaded, run: explicitRun };
    check(
      '205-ui-explicit-roundtrip',
      'choosing xhigh saves effort "xhigh", survives reload, and the Codex CLI receives model_reasoning_effort="xhigh" with the inherited model',
      savedNode.config.effort === 'xhigh' &&
        reloaded === 'xhigh' &&
        explicitRun.requests.length === 1 &&
        explicitRun.requests[0].effort === 'xhigh' &&
        explicitRun.requests[0].model === 'gpt-6-sol',
      evidence['205-codex-explicit'],
    );

    // Back to Default: the saved override disappears and the request uses the labelled default.
    dialog = await openNode('work');
    await dialog.getByLabel('Effort', { exact: true }).selectOption('');
    await closeNode();
    await saved();
    const cleared = await pollDraft(loopId, 'work', (n) => n.config.effort === undefined);
    const defaultRun = await publishAndRun(loopId, 'UI205');
    evidence['205-codex-default'] = { savedConfig: cleared.config, run: defaultRun };
    check(
      '205-ui-default-roundtrip',
      'choosing Default (medium) removes the override and the CLI receives the process default medium',
      cleared.config.effort === undefined && defaultRun.requests[0]?.effort === 'medium',
      evidence['205-codex-default'],
    );

    // Owner Settings change: the Default label and the request move together.
    await put(api.base, '/settings', { defaults: { byHarness: { codex: { effort: 'high' } } } });
    dialog = await openNode('work');
    const ownerEffort = dialog.getByLabel('Effort', { exact: true });
    await ownerEffort.locator('option').first().filter({ hasText: 'Default (high)' }).waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
    const ownerLabel = await ownerEffort.locator('option').first().textContent();
    await closeNode();
    const ownerRun = await publishAndRun(loopId, 'UI205');
    evidence['205-codex-owner'] = { label: ownerLabel, run: ownerRun };
    check(
      '205-ui-owner-default',
      'after owner Settings set effort high, the editor shows Default (high) and the CLI receives high',
      ownerLabel === 'Default (high)' && ownerRun.requests[0]?.effort === 'high',
      evidence['205-codex-owner'],
    );
    // Codex max option: what the editor offers and what the CLI receives.
    dialog = await openNode('work');
    const maxOption = await dialog.getByLabel('Effort', { exact: true }).locator('option[value="max"]').allTextContents();
    await dialog.getByLabel('Effort', { exact: true }).selectOption('max').catch(() => {});
    const maxDescription = await described(dialog.getByLabel('Effort', { exact: true }));
    await shot('205-codex-max-selected.png', dialog);
    await closeNode();
    await saved();
    const maxNode = await pollDraft(loopId, 'work', (n) => n.config.effort === 'max');
    const maxRun = await publishAndRun(loopId, 'UI205');
    const maxSessions = (await get(api.base, `/runs/${maxRun.runId}/sessions`)).items;
    evidence['205-codex-max'] = { optionText: maxOption, description: maxDescription, savedConfig: maxNode.config, run: maxRun, sessionRow: maxSessions[0] };
    check(
      '205-ui-codex-max',
      'Codex "max": what the editor offers and saves is what the CLI receives (observation; documented max->xhigh adapter mapping)',
      maxNode.config.effort === maxRun.requests[0]?.effort,
      { offered: maxOption, saved: maxNode.config.effort, sent: maxRun.requests[0]?.effort, sessionRow: maxSessions[0]?.effort, description: maxDescription },
    );
    await call(api.base, 'DELETE', '/settings/defaults');
  }

  // ---------- #205 Claude inference: supported efforts only ----------
  {
    const name = 'acc-a 205 claude';
    const nodes = inferenceLoop(name, 'UI205C', { harness: 'claude', model: 'claude-opus-5-5' });
    const loopId = (await post(api.base, '/loops', { definition: withNodes(name, nodes, [edge('s-w', 'start', 'work'), edge('w-d', 'work', 'done')]) }, 201)).loop.id;
    await openEditor(loopId, name);
    const dialog = await openNode('work');
    const effort = dialog.getByLabel('Effort', { exact: true });
    await effort.locator('option').nth(1).waitFor({ state: 'attached' });
    const values = await effort.locator('option').evaluateAll((els) => els.map((el) => el.value));
    const texts = await effort.locator('option').allTextContents();
    await effort.selectOption('max');
    await shot('205-claude-inference-settings.png', dialog);
    await closeNode();
    await saved();
    await pollDraft(loopId, 'work', (n) => n.config.effort === 'max');
    const run = await publishAndRun(loopId, 'UI205C');
    evidence['205-claude'] = { values, texts, run };
    check(
      '205-ui-claude-efforts',
      'Claude effort offers low..max without minimal; choosing max sends --effort max',
      !values.includes('minimal') &&
        ['low', 'medium', 'high', 'xhigh', 'max'].every((v) => values.includes(v)) &&
        run.requests[0]?.effort === 'max' &&
        run.requests[0]?.model === 'claude-opus-5-5',
      evidence['205-claude'],
    );
  }

  // ---------- #205 LLM decision: model and one effort dropdown on Settings ----------
  {
    const name = 'acc-a 205 llm';
    const nodes = [
      { id: 'start', kind: 'trigger', label: 'Start', ui: { x: 0, y: 80 }, config: { type: 'manual' } },
      {
        id: 'pick',
        kind: 'decision',
        label: 'Pick',
        ui: { x: 260, y: 80 },
        config: {
          kind: 'llm',
          harness: 'codex',
          instructions: 'UI205D run={{ run.id }} choose',
          model: { mode: 'inherit' },
          effort: { mode: 'inherit' },
          routes: [
            { id: 'yes', label: 'Yes' },
            { id: 'no', label: 'No' },
          ],
        },
      },
      { id: 'done', kind: 'exit', label: 'Done', ui: { x: 520, y: 80 }, config: {} },
    ];
    const edges = [edge('s-p', 'start', 'pick'), edge('p-y', 'pick', 'done', 'yes'), edge('p-n', 'pick', 'done', 'no')];
    const loopId = (await post(api.base, '/loops', { definition: withNodes(name, nodes, edges) }, 201)).loop.id;
    await openEditor(loopId, name);
    const dialog = await openNode('pick');
    const model = dialog.getByLabel('Model', { exact: true });
    const effort = dialog.getByLabel('Effort', { exact: true });
    await effort.locator('option').first().filter({ hasText: 'Default (medium)' }).waitFor({ state: 'attached' });
    const placement = {
      advancedButtons: await dialog.getByRole('button', { name: /^Advanced\b/ }).count(),
      effortControls: await dialog.getByLabel(/effort/i).count(),
      modeOrExplicitControls: await dialog.getByLabel(/\b(mode|explicit)\b/i).count(),
      modelFirst: await model.locator('option').first().textContent(),
      effortFirst: await effort.locator('option').first().textContent(),
    };
    await model.selectOption('gpt-6.1-sol');
    await effort.selectOption('low');
    await shot('205-llm-decision-settings.png', dialog);
    await closeNode();
    await saved();
    const node = await pollDraft(loopId, 'pick', (n) => n.config.effort?.mode === 'explicit');
    const run = await publishAndRun(loopId, 'UI205D');
    evidence['205-llm'] = { placement, savedConfig: { model: node.config.model, effort: node.config.effort }, run };
    check(
      '205-ui-llm-decision',
      'LLM decision shows Model and one Effort dropdown (Default names the inherited value); explicit picks save as explicit selections and reach the structured Codex request',
      placement.effortControls === 1 &&
        placement.modeOrExplicitControls === 0 &&
        placement.effortFirst === 'Default (medium)' &&
        /gpt-6-sol/.test(placement.modelFirst) &&
        node.config.model?.value === 'gpt-6.1-sol' &&
        node.config.effort?.value === 'low' &&
        run.requests[0]?.model === 'gpt-6.1-sol' &&
        run.requests[0]?.effort === 'low',
      evidence['205-llm'],
    );
  }

  // ---------- #33 session control in the editor ----------
  {
    const name = 'acc-a 33 session';
    const nodes = inferenceLoop(name, 'UI33');
    const loopId = (await post(api.base, '/loops', { definition: withNodes(name, nodes, [edge('s-w', 'start', 'work'), edge('w-d', 'work', 'done')]) }, 201)).loop.id;
    await openEditor(loopId, name);
    let dialog = await openNode('work');
    const session = dialog.getByRole('group', { name: 'Session' });
    const policy = session.getByLabel('Policy');
    const options = await policy.locator('option').allTextContents();
    const initial = await policy.inputValue();
    const resetBefore = await session.getByLabel('Reset after visits').count();
    const ownIndex = options.findIndex((o) => /own/i.test(o));
    await policy.selectOption(String(ownIndex));
    const reset = session.getByLabel('Reset after visits');
    await reset.waitFor();
    const resetVisibleWithAdvancedCollapsed =
      (await reset.isVisible()) &&
      (await dialog.getByRole('button', { name: /^Advanced\b/ }).first().getAttribute('aria-expanded')) === 'false';
    const helpText = await session.textContent();
    await reset.fill('0');
    await delay(400);
    const zeroProblem = await dialog.getByText(/greater than|too small|must be|positive/i).count();
    await shot('33-session-policy-invalid-0.png', dialog);
    await reset.fill('3');
    await shot('33-session-policy-own.png', dialog);
    await closeNode();
    await saved();
    const withReset = await pollDraft(loopId, 'work', (n) => n.config.session?.resetAfterVisits === 3);
    dialog = await openNode('work');
    await dialog.getByLabel('Reset after visits').fill('');
    await closeNode();
    await saved();
    const blank = await pollDraft(loopId, 'work', (n) => n.config.session && n.config.session.resetAfterVisits === undefined);
    evidence['33-ui'] = {
      options,
      initial,
      resetBefore,
      resetVisibleWithAdvancedCollapsed,
      helpText,
      zeroProblem,
      savedWithReset: withReset.config.session,
      savedBlank: blank.config.session,
    };
    check(
      '33-ui-session-control',
      'Session policy offers resume-own (default fresh); own reveals an optional Reset after visits outside Advanced; 0 is refused; 3 and blank save exactly',
      initial === '0' &&
        ownIndex >= 0 &&
        resetBefore === 0 &&
        resetVisibleWithAdvancedCollapsed &&
        zeroProblem > 0 &&
        JSON.stringify(withReset.config.session) === JSON.stringify({ policy: 'resume-own', resetAfterVisits: 3 }) &&
        JSON.stringify(blank.config.session) === JSON.stringify({ policy: 'resume-own' }),
      evidence['33-ui'],
    );
  }

  // ---------- #265 inspector: clear cause, explicit choice, durable note ----------
  {
    const def = loop(
      'acc-a 265 inspector',
      [
        {
          id: 'worker',
          kind: 'inference',
          label: 'Worker',
          config: {
            harness: 'codex',
            model: 'gpt-6-luna',
            effort: 'medium',
            session: { policy: 'resume-own' },
            harnessOptions: { sandbox: 'read-only', approval: 'never' },
            prompt: { template: 'UI265 run={{ run.id }} visit={{ counters.nodeVisits.worker }} task.' },
          },
        },
        { id: 'hold', kind: 'wait', label: 'Hold', config: { mode: 'input', prompt: 'Continue', exposeTo: ['api', 'ui'] } },
        gate('again', 2),
      ],
      [
        edge('s-w', 'start', 'worker'),
        edge('w-h', 'worker', 'hold'),
        edge('h-g', 'hold', 'again'),
        edge('g-w', 'again', 'worker', 'repeat'),
        edge('g-limit', 'again', 'done', 'limit-reached'),
        edge('g-finish', 'again', 'done', 'finish'),
      ],
    );
    const loopId = await createPublished(api.base, def);
    const run = await startRun(api.base, loopId);
    const waiting = await waitRun(api.base, run.id, ['waiting']);
    const v1 = byMarker(await requests(), `UI265 run=${run.id} `)[0];
    await rm(join(CLI, 'sessions', v1.sessionId));
    await post(api.base, `/runs/${run.id}/input`, { waitId: waiting.waiting.waitId, input: 'go' });
    await waitRun(api.base, run.id, ['failed']);
    await page.goto(`/app/runs/${run.id}`);
    await page.getByText('Failed: HARNESS_SESSION_MISSING').waitFor();
    const choose = page.getByRole('button', { name: 'Start fresh session for worker' });
    await choose.waitFor();
    const bodyText = await page.locator('body').innerText();
    const resumeButtons = await page.getByRole('button', { name: /^Resume$/ }).count();
    await shot('265-inspector-missing-1440.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await shot('265-inspector-missing-390.png');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.setViewportSize({ width: 1440, height: 900 });
    const before = byMarker(await requests(), `UI265 run=${run.id} `).length;
    await choose.click();
    const afterChoice = await waitRun(api.base, run.id, ['waiting', 'failed', 'succeeded']);
    const reqs = byMarker(await requests(), `UI265 run=${run.id} `).map(summarize);
    if (afterChoice.status === 'waiting')
      await post(api.base, `/runs/${run.id}/input`, { waitId: afterChoice.waiting.waitId, input: 'go' });
    const finished = await waitRun(api.base, run.id, ['succeeded', 'failed']);
    await page.reload();
    const note = page.getByText(/chose a fresh session for worker; prior provider context was not carried over/);
    await note.waitFor();
    const noteText = await note.textContent();
    const buttonsAfter = await page.getByRole('button', { name: 'Start fresh session for worker' }).count();
    await shot('265-inspector-recovered-1440.png');
    const evs = await events(api.base, run.id);
    evidence['265-ui'] = {
      runId: run.id,
      lostHandle: v1.sessionId,
      pageMentionsHandle: bodyText.includes(v1.sessionId),
      pageMentionsOrigin: /resume-own/.test(bodyText),
      explanationShown: /prior provider conversation will not be carried over/.test(bodyText),
      modelEffortShown: /model gpt-6-luna\s+and effort medium/.test(bodyText),
      plainResumeButtons: resumeButtons,
      horizontalOverflowAt390: overflow,
      callsBeforeChoice: before,
      afterChoiceStatus: afterChoice.status,
      requests: reqs,
      finished: finished.status,
      noteText,
      buttonsAfter,
      resumed: evs.filter((e) => e.type === 'run.resumed'),
    };
    check(
      '265-ui-inspector',
      'inspector names the lost handle and origin, explains the choice, offers Start fresh session; clicking it starts one fresh turn; after reload a durable note records who, when, node and the lost handle',
      evidence['265-ui'].pageMentionsHandle &&
        evidence['265-ui'].pageMentionsOrigin &&
        evidence['265-ui'].explanationShown &&
        before === 2 &&
        reqs[2]?.mode === 'fresh' &&
        finished.status === 'succeeded' &&
        noteText.includes(v1.sessionId) &&
        noteText.includes('local') &&
        buttonsAfter === 0 &&
        overflow <= 0,
      evidence['265-ui'],
    );
  }
} finally {
  await browser.close();
  await api.kill();
  await saveJson('s5-browser-results.json', { checks, evidence });
}
const failedChecks = checks.filter((c) => !c.pass);
console.log(`${checks.length - failedChecks.length}/${checks.length} checks passed`);
process.exitCode = failedChecks.length ? 1 : 0;
