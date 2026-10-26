// #255: exact values and execution context in the run inspector, runs list, REST and MCP.
// Representative runs on the built API: script/inference array appends, classifier Choice/Noul/
// Score and expression routes with extreme probabilities (loopback classifier endpoint), REST/
// MCP/UI/parent cancellations, an inference cancelled mid-turn, a run deadline, a provider quota
// failure (fake Codex fixture), then renamed definitions; unknown history via a refused
// definition read (browser network fault) and a removed cancellation request (store fault).
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  makeTemp, removeTemp, compileFakeCodex, startApi, restClient, logger, mcpClient, edge, startReceiver, delay, until, edge_, HERE,
} from './lib.mjs';
import { manual } from './defs.mjs';

const PORT = 6450;
const log = logger('p255.log.txt');
const data = await makeTemp('255');
const results = { checks: [], runs: {} };
const check = (name, ok, detail) => {
  results.checks.push({ name, ok, detail });
  log(ok ? 'PASS' : 'FAIL', name, detail ?? '');
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let api;
let browser;
let cls;
const text = async (locator) => (await locator.innerText()).replace(/\s+/g, ' ').trim();

try {
  const codex = await compileFakeCodex(data);
  // A loopback classifier endpoint with extreme, exact probabilities.
  cls = await startReceiver(6454, (req) => {
    const body = JSON.parse(req.body);
    const q = body.questions.answer;
    if (q.type === 'choice') {
      const [a, b] = Object.keys(q.criteria);
      return { json: { model: body.model, answers: { answer: { type: 'choice', choice: a, probabilities: { [a]: 0.99996, [b]: 0.00004 } } } } };
    }
    if (q.type === 'noul') return { json: { model: body.model, answers: { answer: { type: 'noul', noul: 0.123456789 } } } };
    return {
      json: {
        model: body.model,
        answers: { answer: { type: 'score', score: 1.5, confidence: 0.75, legend: Object.fromEntries(q.criteria.map((c, i) => [String(i), c])), probabilities: { 0: 0.00004, 1: 0.49996, 2: 0.5 } } },
      },
    };
  });
  const scripts = join(data, 'scripts');
  await mkdir(scripts, { recursive: true });
  const appender = join(scripts, 'append.mjs');
  await writeFile(
    appender,
    "process.stdout.write('[{\"op\":\"add\",\"path\":\"/vars/list\",\"value\":[]},{\"op\":\"add\",\"path\":\"/vars/list/-\",\"value\":null},{\"op\":\"add\",\"path\":\"/vars/list/-\",\"value\":[1,[2,3]]},{\"op\":\"add\",\"path\":\"/vars/list/-\",\"value\":{\"k\":\"v\"}},{\"op\":\"add\",\"path\":\"/vars/list/-\",\"value\":\"text\"},{\"op\":\"add\",\"path\":\"/vars/n\",\"value\":0.12345678901234568}]');\n",
  );

  // ---------------- phase 1: success fixture ----------------
  api = await startApi({ port: PORT, dataDir: data, codex, scenario: 'success', log });
  let rest = restClient(api.url);
  const mcp1 = await mcpClient(api.url);
  await rest('PUT', '/classifier-models/acc-cls', { displayName: 'Acceptance classifier', provider: 'http', providerModel: 'acc-model', endpoint: cls.url, primitives: ['choice', 'noul', 'score'] });
  await rest('PATCH', '/classifier-models/acc-cls', { enabled: true });

  const appendLoop = await rest.createLoop({
    schemaVersion: 4,
    name: 'Original append loop',
    nodes: [
      manual('Original start'),
      { id: 'work', kind: 'script', label: 'Original script', config: { command: process.execPath, args: [appender], stdin: 'none', stdout: 'patch' } },
      { id: 'talk', kind: 'inference', label: 'Original inference', config: { prompt: { template: 'fake turn; no provider' } } },
      { id: 'finish', kind: 'exit', label: 'Original finish', config: {} },
    ],
    edges: [edge_('start', 'out', 'work'), edge_('work', 'out', 'talk'), edge_('talk', 'out', 'finish')],
  });
  const runA = await rest.start(appendLoop.loop.id, {});
  await rest.waitStatus(runA.id, ['succeeded', 'failed'], { timeout: 60_000 });

  const decisionLoop = await rest.createLoop({
    schemaVersion: 4,
    name: 'Original decision loop',
    nodes: [
      manual('Original start'),
      { id: 'classify', kind: 'decision', label: 'Original choice', config: { kind: 'classifier', model: 'acc-cls', question: 'Accept?', recordAlternatives: true, answer: { type: 'choice', options: [{ id: 'accept', label: 'Original accept', criteria: 'Accept it' }, { id: 'reject', label: 'Original reject', criteria: 'Reject it' }] } } },
      { id: 'truth', kind: 'decision', label: 'Original noul', config: { kind: 'classifier', model: 'acc-cls', question: 'True?', answer: { type: 'noul', true: { id: 'yes', label: 'Original yes', criteria: 'It holds' }, false: { id: 'no', label: 'Original no', criteria: 'It does not' } } } },
      { id: 'grade', kind: 'decision', label: 'Original score', config: { kind: 'classifier', model: 'acc-cls', question: 'Grade?', answer: { type: 'score', anchors: ['None', 'Some', 'All'], bands: [{ id: 'low', label: 'Original low', min: 0, max: 1 }, { id: 'high', label: 'Original high', min: 1, max: 2 }] } } },
      { id: 'route', kind: 'decision', label: 'Original route', config: { kind: 'expression', jsonata: '"ship"', routes: [{ id: 'ship', label: 'Original ship' }, { id: 'hold', label: 'Original hold' }] } },
      { id: 'finish', kind: 'exit', label: 'Original finish', config: {} },
    ],
    edges: [
      edge_('start', 'out', 'classify'),
      edge_('classify', 'accept', 'truth'),
      edge_('classify', 'reject', 'finish'),
      edge_('truth', 'yes', 'finish'),
      edge_('truth', 'no', 'grade'),
      edge_('grade', 'low', 'finish'),
      edge_('grade', 'high', 'route'),
      edge_('route', 'ship', 'finish'),
      edge_('route', 'hold', 'finish'),
    ],
  });
  const runD = await rest.start(decisionLoop.loop.id, {});
  const doneD = await rest.waitStatus(runD.id, ['succeeded', 'failed'], { timeout: 60_000 });
  log('decision run', doneD.status, doneD.failure ?? '');

  const waitDef = (name) => ({
    schemaVersion: 4,
    name,
    nodes: [manual('Original start'), { id: 'ask', kind: 'wait', label: 'Original wait', config: { mode: 'input', prompt: 'Waiting' } }, { id: 'finish', kind: 'exit', label: 'Original finish', config: {} }],
    edges: [edge_('start', 'out', 'ask'), edge_('ask', 'out', 'finish')],
  });
  const waitLoop = await rest.createLoop(waitDef('Original wait loop'));
  const cancelRest = await rest.start(waitLoop.loop.id, {});
  const cancelMcp = await rest.start(waitLoop.loop.id, {});
  const cancelUi = await rest.start(waitLoop.loop.id, {});
  for (const r of [cancelRest, cancelMcp, cancelUi]) await rest.waitStatus(r.id, ['waiting']);
  await rest('POST', `/runs/${cancelRest.id}/cancel`, {});
  await mcp1.call('cancel_run', { runId: cancelMcp.id });
  browser = await edge();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  {
    const p = await ctx.newPage();
    await p.goto(`${api.url}/app/runs/${cancelUi.id}`);
    await p.getByRole('button', { name: 'Cancel run' }).click();
    await rest.waitStatus(cancelUi.id, ['cancelled']);
    await p.close();
  }
  // Parent cancellation reaching an awaited child.
  const childLoop = await rest.createLoop(waitDef('Original child loop'));
  const parentLoop = await rest.createLoop({
    schemaVersion: 4,
    name: 'Original parent loop',
    nodes: [manual('Original start'), { id: 'sub', kind: 'subloop', label: 'Original subloop', config: { loopRef: { loopId: childLoop.loop.id, version: 'latest' } } }, { id: 'finish', kind: 'exit', label: 'Original finish', config: {} }],
    edges: [edge_('start', 'out', 'sub'), edge_('sub', 'out', 'finish')],
  });
  const parent = await rest.start(parentLoop.loop.id, {});
  const child = await until(async () => {
    const list = await rest('GET', `/runs?parent=${parent.id}`);
    return list.items?.find((r) => r.status === 'waiting');
  }, { what: 'child waiting' });
  await rest('POST', `/runs/${parent.id}/cancel`, {});
  await rest.waitStatus(child.id, ['cancelled']);
  // A run deadline (2 s) while waiting.
  const deadlineLoop = await rest.createLoop({ ...waitDef('Original deadline loop'), settings: { runDeadlineSeconds: 2 } });
  const deadlineRun = await rest.start(deadlineLoop.loop.id, {});
  const deadlineDone = await rest.waitStatus(deadlineRun.id, ['failed', 'cancelled'], { timeout: 60_000 });
  await mcp1.close();
  await api.kill();

  // ---------------- phase 2: provider quota failure ----------------
  api = await startApi({ port: PORT, dataDir: data, codex, scenario: 'quota', log });
  rest = restClient(api.url);
  const workLoop = await rest.createLoop({
    schemaVersion: 4,
    name: 'Original provider loop',
    nodes: [manual('Original start'), { id: 'talk', kind: 'inference', label: 'Original inference', config: { prompt: { template: 'fake turn; no provider' } } }, { id: 'finish', kind: 'exit', label: 'Original finish', config: {} }],
    edges: [edge_('start', 'out', 'talk'), edge_('talk', 'out', 'finish')],
  });
  const quotaRun = await rest.start(workLoop.loop.id, {});
  const quotaDone = await rest.waitStatus(quotaRun.id, ['failed', 'succeeded'], { timeout: 60_000 });
  await api.kill();

  // ---------------- phase 3: an inference turn cancelled mid-turn ----------------
  api = await startApi({ port: PORT, dataDir: data, codex, scenario: 'stall', log });
  rest = restClient(api.url);
  const stallRun = await rest.start(workLoop.loop.id, {});
  await until(async () => (await rest.allEvents(stallRun.id)).some((e) => e.type === 'harness.session' || e.type === 'harness.submission'), { timeout: 30_000, what: 'turn started' });
  await delay(1000);
  await rest('POST', `/runs/${stallRun.id}/cancel`, {});
  const stallDone = await rest.waitStatus(stallRun.id, ['cancelled', 'failed'], { timeout: 60_000 });
  await api.kill();

  // ---------------- phase 4: rename everything, then inspect ----------------
  api = await startApi({ port: PORT, dataDir: data, codex, scenario: 'success', log });
  rest = restClient(api.url);
  const mcp = await mcpClient(api.url);
  for (const created of [appendLoop, decisionLoop, waitLoop, childLoop, parentLoop, deadlineLoop, workLoop]) {
    const loop = await rest('GET', `/loops/${created.loop.id}`);
    const def = structuredClone((loop.draft ?? loop.current).definition);
    def.name = def.name.replace('Original', 'Renamed');
    for (const node of def.nodes) {
      node.label = node.label.replace('Original', 'Renamed');
      if (node.kind === 'decision') {
        const c = node.config;
        for (const r of c.routes ?? []) r.label = r.label.replace('Original', 'Renamed');
        for (const o of c.answer?.options ?? []) o.label = o.label.replace('Original', 'Renamed');
        for (const b of c.answer?.bands ?? []) b.label = b.label.replace('Original', 'Renamed');
        if (c.answer?.true) {
          c.answer.true.label = c.answer.true.label.replace('Original', 'Renamed');
          c.answer.false.label = c.answer.false.label.replace('Original', 'Renamed');
        }
      }
    }
    await rest('PUT', `/loops/${created.loop.id}/draft`, { definition: def }, { headers: { 'if-match': String(loop.draftToken) } });
    await rest('POST', `/loops/${created.loop.id}/publish`);
  }
  const page = await ctx.newPage();
  const selectEvent = async (runId, seq) => {
    await page.goto(`${api.url}/app/runs/${runId}`);
    await page.locator('ol[aria-label="Timeline"] button[data-seq]').first().waitFor({ timeout: 30_000 });
    await page.getByLabel('Event sequence').fill(String(seq));
    await page.getByRole('button', { name: 'Go to event' }).click();
    await page.locator(`ol[aria-label="Timeline"] button[data-seq="${seq}"][aria-current="true"]`).waitFor({ timeout: 30_000 });
  };

  // A. appended values from a script patch and a provider message.
  const evA = await rest.allEvents(runA.id);
  const scriptDone = evA.find((e) => e.type === 'node.finished' && e.nodeId === 'work');
  const talkDone = evA.find((e) => e.type === 'node.finished' && e.nodeId === 'talk');
  await selectEvent(runA.id, scriptDone.seq);
  await page.getByRole('list', { name: 'Patch diff' }).waitFor({ timeout: 30_000 });
  const diffItems = await page.getByRole('list', { name: 'Patch diff' }).getByRole('listitem').allInnerTexts();
  const norm = diffItems.map((t) => t.replace(/\s+/g, ' ').trim());
  log('script patch diff rows', norm);
  const appends = norm.filter((t) => t.includes('/vars/list/-'));
  check('append values: each "/vars/list/-" add shows "Added value" with its inserted value (null, [1,[2,3]], {"k":"v"}, "text"), not the final array or "(absent)"', appends.length === 4 && appends.every((t) => t.includes('Added value')) && /Added value null/.test(appends[0]) && /\[\s*1,\s*\[\s*2,\s*3\s*\]\s*\]/.test(appends[1].replace(/\s/g, '').replace(/,/g, ', ')) && appends[2].includes('"k"') && appends[3].includes('"text"') && !appends.some((t) => t.includes('Added value (absent)')), {
    appends,
  });
  // Exact event download versus the API's raw JSON.
  await page.getByRole('button', { name: `Exact recorded event #${scriptDone.seq}` }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Exact recorded event as JSON' }).click()]);
  const downloaded = await readFile(await download.path(), 'utf8');
  const rawApi = await (await fetch(`${api.url}/runs/${runA.id}/events?after=${scriptDone.seq - 1}&limit=1`)).text();
  check('exact raw value: the downloaded recorded event equals the API event, including the number token 0.12345678901234568', same(JSON.parse(downloaded), JSON.parse(rawApi).items[0]) && downloaded.includes('0.12345678901234568') && rawApi.includes('0.12345678901234568'), { bytes: downloaded.length });
  await selectEvent(runA.id, talkDone.seq);
  await page.getByRole('list', { name: 'Patch diff' }).waitFor({ timeout: 30_000 });
  const talkRows = (await page.getByRole('list', { name: 'Patch diff' }).getByRole('listitem').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
  check('provider message append: "/messages/-" shows the appended message as the Added value', talkRows.some((t) => t.includes('/messages/-') && t.includes('Added value') && t.includes('Controlled fake result')), { talkRows: talkRows.map((t) => t.slice(0, 200)) });
  const ctxText = await text(page.getByRole('region', { name: 'Execution context' }));
  const [runRecordDl] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('button', { name: 'Exact run record' }).click();
      await page.getByRole('button', { name: 'Download Exact run record as JSON' }).click();
    })(),
  ]);
  const runRecord = JSON.parse(await readFile(await runRecordDl.path(), 'utf8'));
  const apiRun = await rest('GET', `/runs/${runA.id}`);
  const [defDl] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('button', { name: 'Pinned definition JSON' }).click();
      await page.getByRole('button', { name: 'Download Pinned definition JSON as JSON' }).click();
    })(),
  ]);
  const pinnedDef = JSON.parse(await readFile(await defDl.path(), 'utf8'));
  const apiVersion = await rest('GET', `/loops/${runA.loopId}/versions/${runA.versionId}`);
  check('execution context: pinned label/version shown; exact run record and pinned definition downloads equal the API (definition still "Original")', ctxText.includes(runA.versionId) && same(runRecord, apiRun) && same(pinnedDef, apiVersion.definition) && pinnedDef.name === 'Original append loop', {
    context: ctxText.slice(0, 200),
  });
  const tlA = (await page.$$eval('ol[aria-label="Timeline"] button[data-seq]', (b) => b.map((x) => x.innerText.replace(/\s+/g, ' ')))).join(' | ');
  check('pinned labels after rename: Timeline rows name "Original" nodes with IDs, never "Renamed"', tlA.includes('Original script (work)') && !tlA.includes('Renamed'), { sample: tlA.slice(0, 300) });

  // D. routes and probabilities.
  const evD = await rest.allEvents(runD.id);
  const madeChoice = evD.find((e) => e.type === 'decision.made' && e.nodeId === 'classify');
  const madeNoul = evD.find((e) => e.type === 'decision.made' && e.nodeId === 'truth');
  const madeScore = evD.find((e) => e.type === 'decision.made' && e.nodeId === 'grade');
  const madeRoute = evD.find((e) => e.type === 'decision.made' && e.nodeId === 'route');
  await selectEvent(runD.id, madeChoice.seq);
  await page.getByText('Alternative probabilities').waitFor({ timeout: 30_000 });
  const choiceList = (await page.getByRole('list', { name: 'Alternative probabilities' }).getByRole('listitem').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
  check('Choice: "Alternative probabilities" lists pinned labels with IDs and readable bounds (>99.99%, <0.01%); exact numbers stay in the event', choiceList.some((t) => t.includes('Original accept (accept)') && t.includes('>99.99%')) && choiceList.some((t) => t.includes('Original reject (reject)') && t.includes('<0.01%')) && madeChoice.observation.answer.probabilities.accept === 0.99996, {
    choiceList, recorded: madeChoice.observation.answer.probabilities,
  });
  await selectEvent(runD.id, madeNoul.seq);
  await delay(800);
  const noulPanel = await text(page.locator('body'));
  check('Noul: true probability shown as 12.35%; recorded exact 0.123456789', noulPanel.includes('12.35%') && madeNoul.observation.answer.trueProbability === 0.123456789, { route: madeNoul.portId });
  await selectEvent(runD.id, madeScore.seq);
  await page.getByText('Rubric index probabilities').waitFor({ timeout: 30_000 });
  const scoreList = (await page.getByRole('list', { name: 'Rubric index probabilities' }).getByRole('listitem').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
  check('Score: "Rubric index probabilities" keyed by rubric index (0: <0.01%, 1: 50%, 2: 50%)', scoreList.length === 3 && scoreList[0].includes('<0.01%') && scoreList[2].includes('50%'), { scoreList });
  await selectEvent(runD.id, madeRoute.seq);
  const routeRow = await text(page.locator(`ol[aria-label="Timeline"] button[data-seq="${madeRoute.seq}"]`));
  const routeBody = await text(page.locator('body'));
  check('expression route: readable pinned route label beside its ID ("Original ship (ship)")', (routeRow + routeBody).includes('Original ship (ship)') && !routeBody.includes('Renamed ship'), { routeRow });
  const mcpEvents = await mcp.call('read_run_events', { runId: runD.id, after: madeChoice.seq - 1, limit: 1 });
  check('MCP read_run_events returns the same exact decision evidence as REST', same(mcpEvents.items[0], madeChoice), {});

  // Cancellations.
  for (const [label, run, kind] of [['REST', cancelRest, undefined], ['MCP', cancelMcp, 'mcp-client'], ['UI', cancelUi, undefined], ['parent', child, 'run']]) {
    const ev = await rest.allEvents(run.id);
    const req = ev.findLast((e) => e.type === 'run.cancel_requested');
    const fin = ev.findLast((e) => e.type === 'run.cancelled');
    await page.goto(`${api.url}/app/runs/${run.id}`);
    const region = page.getByRole('region', { name: 'Execution context' });
    await region.getByText(/Cancelled/).waitFor({ timeout: 30_000 });
    const t = await text(region);
    const expected = `Cancelled by ${req.actor.kind} ${req.actor.id} (request #${req.seq}; cancellation #${fin.seq}).`;
    check(`cancellation via ${label}: inspector names the recorded actor and event numbers; no failure alert`, t.includes(expected) && (kind === undefined || req.actor.kind === kind) && !(await page.getByText(/^Failed:/).count()), { expected, actor: req.actor });
  }
  results.runs.parentCancelled = { child: child.id, parent: parent.id };
  // Inference cancelled mid-turn.
  {
    const ev = await rest.allEvents(stallRun.id);
    const req = ev.findLast((e) => e.type === 'run.cancel_requested');
    await page.goto(`${api.url}/app/runs/${stallRun.id}`);
    const region = page.getByRole('region', { name: 'Execution context' });
    await region.getByText(/Cancelled/).waitFor({ timeout: 30_000 });
    const t = await text(region);
    check('inference cancelled mid-turn: status cancelled, actor named, recorded position labelled, no provider failure shown', stallDone.status === 'cancelled' && t.includes(`Cancelled by ${req.actor.kind}`) && t.includes('Recorded node position') && !(await page.getByText(/^Failed:/).count()), { status: stallDone.status, context: t.slice(0, 260) });
  }
  // Deadline.
  await page.goto(`${api.url}/app/runs/${deadlineRun.id}`);
  await page.getByText('Failed: RUN_DEADLINE_EXCEEDED').waitFor({ timeout: 30_000 });
  const deadlineCtx = await text(page.getByRole('region', { name: 'Execution context' }));
  check('run deadline: RUN_DEADLINE_EXCEEDED shown as the engine failure, with no invented cancellation actor', deadlineDone.status === 'failed' && deadlineDone.failure.code === 'RUN_DEADLINE_EXCEEDED' && !deadlineCtx.includes('Cancelled'), { failure: deadlineDone.failure });
  // Provider failure.
  await page.goto(`${api.url}/app/runs/${quotaRun.id}`);
  await page.getByText(`Failed: ${quotaDone.failure?.code}`).waitFor({ timeout: 30_000 });
  const alert = await text(page.getByRole('alert').filter({ hasText: 'Failed:' }).first());
  await page.goto(`${api.url}/app/runs`);
  await page.getByRole('link', { name: quotaRun.id }).waitFor({ timeout: 30_000 });
  const listRow = await text(page.getByRole('row').filter({ has: page.getByRole('link', { name: quotaRun.id }) }));
  check('provider quota failure: inspector alert and runs list show the recorded code and diagnostic message; list names the pinned loop name', quotaDone.status === 'failed' && alert.includes(quotaDone.failure.message) && listRow.includes(`${quotaDone.failure.code}: ${quotaDone.failure.message}`) && listRow.includes('Original provider loop'), {
    failure: { code: quotaDone.failure.code, message: quotaDone.failure.message, resumable: quotaDone.failure.resumable }, alert, listRow,
  });

  // Unknown history: a refused pinned-definition read in the browser (network fault).
  const page2 = await ctx.newPage();
  await page2.route((url) => url.pathname === `/loops/${runA.loopId}/versions/${runA.versionId}`, (route) =>
    route.fulfill({ status: 404, contentType: 'application/problem+json', body: JSON.stringify({ type: 'about:blank', title: 'Not found', status: 404, code: 'VERSION_NOT_FOUND', detail: 'injected by the acceptance probe' }) }),
  );
  await page2.goto(`${api.url}/app/runs/${runA.id}`);
  await page2.getByText(/Pinned definition unavailable/).waitFor({ timeout: 30_000 });
  const rows2 = (await page2.$$eval('ol[aria-label="Timeline"] button[data-seq]', (b) => b.map((x) => x.innerText.replace(/\s+/g, ' ')))).join(' | ');
  check('definition unavailable: says so explicitly; Timeline keeps stable IDs and never falls back to the current ("Renamed") labels', !rows2.includes('Renamed') && !rows2.includes('Original script') && rows2.includes('work'), { sample: rows2.slice(0, 240) });
  await page2.close();
  // Unknown history: remove the recorded cancellation request from the disposable store.
  await mcp.close();
  await api.kill();
  const db = new DatabaseSync(join(data, 'graphgoblin.db'));
  const removed = db.prepare("delete from run_events where run_id = ? and type = 'run.cancel_requested'").run(cancelRest.id);
  db.close();
  api = await startApi({ port: PORT, dataDir: data, codex, scenario: 'success', log });
  await page.goto(`${api.url}/app/runs/${cancelRest.id}`);
  const region = page.getByRole('region', { name: 'Execution context' });
  await region.getByText(/Cancelled/).waitFor({ timeout: 30_000 });
  const unknownActor = await text(region);
  check('cancellation request missing from history (store fault): "Cancelled; actor not recorded." rather than an invented actor', removed.changes === 1 && unknownActor.includes('Cancelled; actor not recorded.'), { context: unknownActor.slice(0, 200) });
  await page.screenshot({ path: join(HERE, 'p255-unknown-actor.png') });
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  results.error = String(error?.stack ?? error);
} finally {
  await writeFile(join(HERE, 'p255.json'), JSON.stringify(results, null, 2));
  await browser?.close();
  await api?.kill();
  await cls?.close();
  await removeTemp(data);
  await log.flush();
}
