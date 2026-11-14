// #209 phase 2: a real second-client race against the BUILT api + web (native gateway, SQLite file store, real Edge).
// For each surface: client A receives a 409 suggestion; a second client claims that suggestion before A's deliberate retry;
// A's retry must be refused again WITHOUT creating anything, keep A's input, show the updated suggestion and wait for a new
// explicit action. All 409 bodies and server ids are recorded. Nothing here is mocked.
import { mkdirSync, writeFileSync } from 'node:fs';
import { QA, startNative, api, approvalLoop, equivalent, launchEdge, contextFor, stamp } from './lib.mjs';

const OUT = `${QA}/native/race`;
mkdirSync(OUT, { recursive: true });
const gateway = await startNative({ port: 4793, dataDir: `${QA}/native/data-race`, label: 'race' });
process.on('exit', () => gateway.stop());
const URL_ = gateway.url;
const results = { startedAt: stamp(), gateway: { url: URL_, pid: gateway.pid }, paths: {}, checks: [], failedChecks: [] };

function check(path, label, ok, detail) {
  const entry = { path, label, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) };
  results.checks.push(entry);
  if (!ok) results.failedChecks.push(`${path}: ${label}`);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${path}: ${label}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Record every mutating request client A sends, with its eventual answer. */
function watch(page, sink) {
  page.on('request', (req) => {
    if (!MUTATING.has(req.method())) return;
    const u = new URL(req.url());
    sink.push({ t: stamp(), method: req.method(), path: u.pathname + u.search, body: (req.postData() ?? '').slice(0, 300), status: undefined });
    req.__entry = sink[sink.length - 1];
  });
  page.on('response', async (res) => {
    const req = res.request();
    if (!req.__entry) return;
    req.__entry.status = res.status();
    try {
      const body = await res.json();
      req.__entry.answer = res.status() === 409 ? body : { id: body?.loop?.id, name: body?.loop?.name };
    } catch {
      /* no body */
    }
  });
}
const idsOf = async () => (await api(URL_, 'GET', '/loops')).json.items.map((l) => `${l.id}:${l.name}`).sort();
const summary = (d) => ({
  loop: { id: d.loop.id, name: d.loop.name, currentVersionId: d.loop.currentVersionId, draftVersionId: d.loop.draftVersionId },
  draftName: d.draft?.definition?.name,
  draftNodes: d.draft?.definition?.nodes?.length,
  currentName: d.current?.definition?.name,
  draftToken: d.draftToken,
});
const detailOf = async (id) => (await api(URL_, 'GET', `/loops/${id}`)).json;
const waitFor = (page, method, pathname) =>
  page.waitForResponse((r) => r.request().method() === method && new URL(r.url()).pathname === pathname, { timeout: 15_000 });

const browser = await launchEdge();
results.browser = { version: browser.version() };
const shotOf = async (page, name, locator) => {
  if (locator) await locator.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/${name}.png` });
  return `${name}.png`;
};

async function newPage(theme = 'dark', width = 1440, height = 900) {
  const context = await contextFor(browser, { theme, width, height, url: URL_ });
  return { context, page: await context.newPage() };
}

// ---------------------------------------------------------------- Create (client B is a second Edge window through the UI)
async function createPath() {
  const P = 'create';
  const rec = (results.paths[P] = { requestsFromA: [] });
  const base = 'Race create base';
  const original = (await api(URL_, 'POST', '/loops', { definition: approvalLoop(base) })).json.loop;
  const originalBefore = summary(await detailOf(original.id));
  const { context: ctxA, page: A } = await newPage();
  const { context: ctxB, page: B } = await newPage();
  watch(A, rec.requestsFromA);
  try {
    await A.goto('/app/loops');
    const field = A.getByRole('textbox', { name: 'New loop name' });
    await field.fill(equivalent(base));
    const first = waitFor(A, 'POST', '/loops');
    await field.press('Enter');
    const res1 = await first;
    const body1 = await res1.json();
    rec.refusal1 = body1;
    check(P, 'first attempt refused 409 LOOP_NAME_CONFLICT with a suggestion', res1.status() === 409 && body1.code === 'LOOP_NAME_CONFLICT' && typeof body1.suggestedName === 'string', body1);
    const S1 = body1.suggestedName;
    await A.getByRole('button', { name: `Use “${S1}”` }).waitFor();

    // Client B (another browser window, through the UI) claims the suggestion.
    await B.goto('/app/loops');
    await B.getByRole('textbox', { name: 'New loop name' }).fill(S1);
    const bDone = waitFor(B, 'POST', '/loops');
    await B.getByRole('button', { name: 'Create', exact: true }).click();
    const bRes = await bDone;
    const bBody = await bRes.json();
    rec.clientB = { status: bRes.status(), loop: { id: bBody.loop?.id, name: bBody.loop?.name } };
    check(P, 'client B created the suggested name (201)', bRes.status() === 201 && bBody.loop.name === S1, rec.clientB);

    const idsBefore = await idsOf();
    const requestsBefore = rec.requestsFromA.length;
    await A.getByRole('button', { name: `Use “${S1}”` }).click();
    await sleep(700);
    check(P, 'taking the suggestion sends no request', rec.requestsFromA.length === requestsBefore);
    check(P, 'field now holds the suggestion and is focused', (await field.inputValue()) === S1 && (await field.evaluate((e) => e === document.activeElement)));

    const second = waitFor(A, 'POST', '/loops');
    await A.keyboard.press('Enter'); // the deliberate retry
    const res2 = await second;
    const body2 = await res2.json();
    rec.refusal2 = body2;
    check(P, 'retry refused again (409) with a different, fresh suggestion', res2.status() === 409 && body2.code === 'LOOP_NAME_CONFLICT' && body2.suggestedName !== S1, body2);
    const S2 = body2.suggestedName;
    const alert = A.getByRole('alert');
    await A.getByRole('button', { name: `Use “${S2}”` }).waitFor();
    const alertText = (await alert.innerText()).replace(/\s+/g, ' ');
    check(P, 'guidance names the refused spelling and shows the updated suggestion', alertText.includes(S1) && (await A.getByRole('button', { name: `Use “${S2}”` }).isVisible()), alertText);
    check(P, 'the user’s text is kept in the field', (await field.inputValue()) === S1);
    check(P, 'nothing was created by A: same loop set as after B', JSON.stringify(await idsOf()) === JSON.stringify(idsBefore));
    check(P, 'original loop unchanged', JSON.stringify(summary(await detailOf(original.id))) === JSON.stringify(originalBefore));
    const sentBeforeIdle = rec.requestsFromA.length;
    await sleep(2500);
    check(P, 'no automatic retry during 2.5 s idle', rec.requestsFromA.length === sentBeforeIdle);
    check(P, 'still on the Loops page (no navigation)', /\/app\/loops$/.test(A.url()));
    rec.image = await shotOf(A, 'create-after-race', alert);

    // A new explicit action: take the new suggestion, then submit.
    await A.getByRole('button', { name: `Use “${S2}”` }).click();
    await sleep(500);
    check(P, 'taking the new suggestion sends no request', rec.requestsFromA.length === sentBeforeIdle);
    const third = waitFor(A, 'POST', '/loops');
    await A.keyboard.press('Enter');
    const res3 = await third;
    const body3 = await res3.json();
    rec.created = { status: res3.status(), id: body3.loop?.id, name: body3.loop?.name };
    check(P, 'explicit retry under the new suggestion creates a distinct loop (201)', res3.status() === 201 && body3.loop.name === S2 && ![original.id, bBody.loop.id].includes(body3.loop.id), rec.created);
    await A.waitForURL(new RegExp(`/loops/${body3.loop.id}/edit$`));
    check(P, 'mutating requests sent by A: exactly three POST /loops (refused, refused, created)', rec.requestsFromA.length === 3 && rec.requestsFromA.every((r) => r.method === 'POST' && r.path === '/loops'), rec.requestsFromA.map((r) => `${r.method} ${r.path} ${r.status}`));
    check(P, 'original still unchanged at the end', JSON.stringify(summary(await detailOf(original.id))) === JSON.stringify(originalBefore));
    rec.serverIds = { original: original.id, clientB: bBody.loop.id, created: body3.loop.id };
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
}

// ---------------------------------------------------------------- Import (client B is a separate HTTP client)
async function importPath() {
  const P = 'import';
  const rec = (results.paths[P] = { requestsFromA: [] });
  const base = 'Race import base';
  const original = (await api(URL_, 'POST', '/loops', { definition: approvalLoop(base) })).json.loop;
  const originalBefore = summary(await detailOf(original.id));
  const exported = (await api(URL_, 'GET', `/loops/${original.id}/export?draft=true`)).json;
  const { context, page: A } = await newPage();
  watch(A, rec.requestsFromA);
  try {
    await A.goto('/app/loops');
    const first = waitFor(A, 'POST', '/loops/import');
    await A.getByLabel('Import an exported loop (JSON)').setInputFiles({ name: 'race.graphgoblin.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
    const res1 = await first;
    const body1 = await res1.json();
    rec.refusal1 = body1;
    check(P, 'upload refused 409 LOOP_NAME_CONFLICT with a suggestion', res1.status() === 409 && body1.code === 'LOOP_NAME_CONFLICT' && typeof body1.suggestedName === 'string', body1);
    const S1 = body1.suggestedName;
    const panel = A.getByRole('region', { name: 'Import under another name' });
    const field = panel.getByRole('textbox', { name: 'Name for the imported loop' });
    await field.waitFor();
    check(P, 'naming form prefilled with the suggestion and focused', (await field.inputValue()) === S1 && (await field.evaluate((e) => e === document.activeElement)));

    // Client B (a plain HTTP client) claims the suggestion.
    const b = await api(URL_, 'POST', '/loops', { definition: approvalLoop(S1) });
    rec.clientB = { status: b.status, loop: { id: b.json?.loop?.id, name: b.json?.loop?.name } };
    check(P, 'client B created the suggested name (201)', b.status === 201, rec.clientB);

    const idsBefore = await idsOf();
    const sentBefore = rec.requestsFromA.length;
    const second = waitFor(A, 'POST', '/loops/import');
    await A.keyboard.press('Enter'); // deliberate retry with the prefilled suggestion
    const res2 = await second;
    const body2 = await res2.json();
    rec.refusal2 = body2;
    rec.retryRequest = { url: res2.url().replace(URL_, ''), bodyEqualsOriginalExport: JSON.stringify(res2.request().postDataJSON()) === JSON.stringify(exported) };
    check(P, 'retry sent the unchanged original document with ?name=<suggestion>', rec.retryRequest.bodyEqualsOriginalExport && new URL(res2.url()).searchParams.get('name') === S1, rec.retryRequest);
    check(P, 'retry refused again (409) with a fresh suggestion', res2.status() === 409 && body2.code === 'LOOP_NAME_CONFLICT' && body2.suggestedName !== S1, body2);
    const S2 = body2.suggestedName;
    await A.getByRole('button', { name: `Use “${S2}”` }).waitFor();
    const panelText = (await panel.innerText()).replace(/\s+/g, ' ');
    check(P, 'form shows the refused name and the updated suggestion; text and focus kept', panelText.includes(S1) && (await field.inputValue()) === S1 && (await field.evaluate((e) => e === document.activeElement)), panelText);
    check(P, 'exactly one more request (the retry); nothing created by A', rec.requestsFromA.length === sentBefore + 1 && JSON.stringify(await idsOf()) === JSON.stringify(idsBefore));
    check(P, 'original unchanged', JSON.stringify(summary(await detailOf(original.id))) === JSON.stringify(originalBefore));
    await sleep(2500);
    check(P, 'no automatic retry during 2.5 s idle', rec.requestsFromA.length === sentBefore + 1);
    rec.image = await shotOf(A, 'import-after-race', panel);

    await A.getByRole('button', { name: `Use “${S2}”` }).click();
    await sleep(500);
    check(P, 'taking the new suggestion sends no request', rec.requestsFromA.length === sentBefore + 1);
    const third = waitFor(A, 'POST', '/loops/import');
    await A.keyboard.press('Enter');
    const res3 = await third;
    const copy = await res3.json();
    rec.created = { status: res3.status(), id: copy.loop?.id, name: copy.loop?.name, nameQuery: new URL(res3.url()).searchParams.get('name') };
    check(P, 'explicit retry imports under the new suggestion (201) as a distinct loop with the same graph', res3.status() === 201 && copy.loop.name === S2 && ![original.id, b.json.loop.id].includes(copy.loop.id) && JSON.stringify(copy.draft.definition.nodes) === JSON.stringify(exported.loop.nodes) && JSON.stringify(copy.draft.definition.edges) === JSON.stringify(exported.loop.edges), rec.created);
    check(P, 'all three imports carried the identical document', rec.requestsFromA.length === 3 && rec.requestsFromA.every((r) => r.body === rec.requestsFromA[0].body));
    check(P, 'original unchanged at the end', JSON.stringify(summary(await detailOf(original.id))) === JSON.stringify(originalBefore));
    rec.serverIds = { original: original.id, clientB: b.json.loop.id, created: copy.loop.id };
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------- Template copy (client B is a second template copy through the API)
async function templatePath() {
  const P = 'template';
  const rec = (results.paths[P] = { requestsFromA: [] });
  const seeded = await api(URL_, 'POST', '/templates/starter/draft', {});
  check(P, 'seeded the first Starter assistant copy', seeded.status === 201);
  const original = seeded.json.loop;
  const originalBefore = summary(await detailOf(original.id));
  const catalogBefore = JSON.stringify((await api(URL_, 'GET', '/templates/starter')).json);
  const { context, page: A } = await newPage();
  watch(A, rec.requestsFromA);
  try {
    await A.goto('/app/loops');
    await A.getByRole('button', { name: 'New from template' }).click();
    const card = A.getByRole('region', { name: 'Starter assistant', exact: true });
    const first = waitFor(A, 'POST', '/templates/starter/draft');
    await card.getByRole('button', { name: 'Use Starter assistant', exact: true }).click();
    const res1 = await first;
    const body1 = await res1.json();
    rec.refusal1 = body1;
    check(P, 'Use refused 409 LOOP_NAME_CONFLICT with a suggestion', res1.status() === 409 && body1.code === 'LOOP_NAME_CONFLICT', body1);
    const S1 = body1.suggestedName;
    const field = card.getByRole('textbox', { name: 'Name for the new draft' });
    await field.waitFor();
    check(P, 'naming form prefilled with the suggestion and focused', (await field.inputValue()) === S1 && (await field.evaluate((e) => e === document.activeElement)));

    // Client B claims the suggestion with its own template copy.
    const b = await api(URL_, 'POST', '/templates/starter/draft', { name: S1 });
    rec.clientB = { status: b.status, loop: { id: b.json?.loop?.id, name: b.json?.loop?.name } };
    check(P, 'client B created a template copy under the suggested name (201)', b.status === 201 && b.json.loop.name === S1, rec.clientB);

    const idsBefore = await idsOf();
    const sentBefore = rec.requestsFromA.length;
    const second = waitFor(A, 'POST', '/templates/starter/draft');
    await card.getByRole('button', { name: 'Create draft', exact: true }).click(); // deliberate retry
    const res2 = await second;
    const body2 = await res2.json();
    rec.refusal2 = body2;
    check(P, 'Create draft refused again (409) with a fresh suggestion; body sent { name: S1 }', res2.status() === 409 && body2.suggestedName !== S1 && JSON.stringify(res2.request().postDataJSON()) === JSON.stringify({ name: S1 }), body2);
    const S2 = body2.suggestedName;
    await card.getByRole('button', { name: `Use “${S2}”` }).waitFor();
    const cardText = (await card.innerText()).replace(/\s+/g, ' ');
    check(P, 'card shows the refused name and the updated suggestion; field text kept', cardText.includes(S1) && (await field.inputValue()) === S1, cardText.slice(-260));
    check(P, 'exactly one more request; nothing created by A; catalog and original unchanged', rec.requestsFromA.length === sentBefore + 1 && JSON.stringify(await idsOf()) === JSON.stringify(idsBefore) && JSON.stringify((await api(URL_, 'GET', '/templates/starter')).json) === catalogBefore && JSON.stringify(summary(await detailOf(original.id))) === JSON.stringify(originalBefore));
    await sleep(2500);
    check(P, 'no automatic retry during 2.5 s idle', rec.requestsFromA.length === sentBefore + 1);
    rec.image = await shotOf(A, 'template-after-race', card);

    await card.getByRole('button', { name: `Use “${S2}”` }).click();
    await sleep(500);
    check(P, 'taking the new suggestion sends no request', rec.requestsFromA.length === sentBefore + 1);
    const third = waitFor(A, 'POST', '/templates/starter/draft');
    await card.getByRole('button', { name: 'Create draft', exact: true }).click();
    const res3 = await third;
    const created = await res3.json();
    rec.created = { status: res3.status(), id: created.loop?.id, name: created.loop?.name };
    check(P, 'explicit Create draft under the new suggestion creates a distinct draft (201)', res3.status() === 201 && created.loop.name === S2 && ![original.id, b.json.loop.id].includes(created.loop.id), rec.created);
    await A.waitForURL(new RegExp(`/loops/${created.loop.id}/edit$`));
    check(P, 'catalog unchanged at the end', JSON.stringify((await api(URL_, 'GET', '/templates/starter')).json) === catalogBefore);
    rec.serverIds = { original: original.id, clientB: b.json.loop.id, created: created.loop.id };
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------- Editor rename (client B is a separate HTTP client); the loop is PUBLISHED, so published and draft names may differ
async function editorPath() {
  const P = 'editor';
  const rec = (results.paths[P] = { requestsFromA: [] });
  const target = (await api(URL_, 'POST', '/loops', { definition: approvalLoop('Race editor target') })).json.loop;
  const mine = (await api(URL_, 'POST', '/loops', { definition: approvalLoop('Race editor mine') })).json.loop;
  const published = await api(URL_, 'POST', `/loops/${mine.id}/publish`);
  check(P, 'seeded a published loop', published.status === 200, published.status);
  const mineBefore = summary(await detailOf(mine.id));
  const targetBefore = summary(await detailOf(target.id));
  rec.before = { mine: mineBefore, target: targetBefore };
  const { context, page: A } = await newPage();
  watch(A, rec.requestsFromA);
  try {
    await A.bringToFront();
    await A.goto(`/app/loops/${mine.id}/edit`);
    await A.getByRole('heading', { name: mine.name, exact: true }).waitFor();
    await A.getByText('The editor is available. Checking the server and this device before saving changes.', { exact: true }).waitFor({ state: 'hidden' });
    const show = A.getByRole('button', { name: 'Show loop settings' });
    if (await show.isVisible()) await show.click();
    await A.getByRole('button', { name: 'Hide loop settings' }).waitFor();
    const field = A.getByRole('textbox', { name: 'Name', exact: true });
    const first = waitFor(A, 'PUT', `/loops/${mine.id}/draft`);
    await field.fill(' race editor target '.replace('target', 'TARGET'));
    const res1 = await first;
    const body1 = await res1.json();
    rec.refusal1 = body1;
    check(P, 'rename refused 409 LOOP_NAME_CONFLICT with a suggestion', res1.status() === 409 && body1.code === 'LOOP_NAME_CONFLICT', body1);
    const S1 = body1.suggestedName;
    const notice = A.getByRole('status').filter({ hasText: 'Another loop already has this name' });
    await notice.waitFor();
    await notice.getByRole('button', { name: `Use “${S1}”` }).waitFor();

    // Client B claims the suggestion.
    const b = await api(URL_, 'POST', '/loops', { definition: approvalLoop(S1) });
    rec.clientB = { status: b.status, loop: { id: b.json?.loop?.id, name: b.json?.loop?.name } };
    check(P, 'client B created the suggested name (201)', b.status === 201, rec.clientB);

    const idsBefore = await idsOf();
    const sentBefore = rec.requestsFromA.length;
    const second = waitFor(A, 'PUT', `/loops/${mine.id}/draft`);
    await notice.getByRole('button', { name: `Use “${S1}”` }).click(); // explicit rename; the save it triggers is the deliberate retry
    const res2 = await second;
    const body2 = await res2.json();
    rec.refusal2 = body2;
    check(P, 'the explicit rename is refused again (409) with a fresh suggestion', res2.status() === 409 && body2.code === 'LOOP_NAME_CONFLICT' && body2.suggestedName !== S1, body2);
    const S2 = body2.suggestedName;
    await notice.getByRole('button', { name: `Use “${S2}”` }).waitFor();
    const noticeText = (await notice.innerText()).replace(/\s+/g, ' ');
    check(P, 'notice names the refused spelling and offers the updated suggestion', noticeText.includes(S1) && (await notice.getByRole('button', { name: `Use “${S2}”` }).isVisible()), noticeText);
    check(P, 'save state still says Not saved: name in use; name field holds the user’s choice', (await A.getByTestId('save-state').innerText()) === 'Not saved: name in use' && (await field.inputValue()) === S1);
    check(P, 'exactly one more PUT; no loop created or renamed by A', rec.requestsFromA.length === sentBefore + 1 && JSON.stringify(await idsOf()) === JSON.stringify(idsBefore));
    const midMine = summary(await detailOf(mine.id));
    check(P, 'server loop id, name, published version and draft unchanged by the refusals', JSON.stringify(midMine) === JSON.stringify(mineBefore), midMine);
    check(P, 'target loop unchanged', JSON.stringify(summary(await detailOf(target.id))) === JSON.stringify(targetBefore));
    await sleep(2500);
    check(P, 'no automatic retry during 2.5 s idle', rec.requestsFromA.length === sentBefore + 1);
    rec.image = await shotOf(A, 'editor-after-race', notice);

    const third = waitFor(A, 'PUT', `/loops/${mine.id}/draft`);
    await notice.getByRole('button', { name: `Use “${S2}”` }).click();
    const res3 = await third;
    rec.saved = { status: res3.status() };
    check(P, 'explicit Use of the new suggestion saves (200)', res3.status() === 200);
    await A.getByTestId('save-state').filter({ hasText: 'All changes saved' }).waitFor();
    const after = summary(await detailOf(mine.id));
    rec.after = after;
    check(P, 'same loop id; loop and draft now carry the new name', after.loop.id === mine.id && after.loop.name === S2 && after.draftName === S2, after);
    check(P, 'published version keeps its original name (not rewritten; by design)', after.currentName === mineBefore.currentName && after.loop.currentVersionId === mineBefore.loop.currentVersionId, { before: mineBefore.currentName, after: after.currentName });
    check(P, 'target unchanged at the end', JSON.stringify(summary(await detailOf(target.id))) === JSON.stringify(targetBefore));
    rec.serverIds = { mine: mine.id, target: target.id, clientB: b.json.loop.id };
  } finally {
    await context.close();
  }
}

try {
  for (const run of [createPath, importPath, templatePath, editorPath]) {
    try {
      await run();
    } catch (error) {
      results.failedChecks.push(`${run.name} threw: ${String(error?.message ?? error).split('\n')[0]}`);
      results.paths[run.name] = { ...(results.paths[run.name] ?? {}), error: String(error?.stack ?? error).slice(0, 1500) };
      console.log('PATH THREW', run.name, String(error?.message ?? error).split('\n')[0]);
    }
  }
  results.finishedAt = stamp();
  results.finalLoops = await idsOf();
  writeFileSync(`${OUT}/race-results.json`, JSON.stringify(results, null, 2));
  console.log(`checks: ${results.checks.filter((c) => c.ok).length}/${results.checks.length} passed; failed: ${results.failedChecks.join(' | ') || 'none'}`);
} finally {
  await browser.close();
  gateway.stop();
}
