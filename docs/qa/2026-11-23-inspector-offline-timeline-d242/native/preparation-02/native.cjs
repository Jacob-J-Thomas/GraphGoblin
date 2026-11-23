'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const E = 'G:/ggq/delivery-evidence/2026-11-17-five-intents';
const ORIGIN = 'https://inspector.invalid';
const FIRST_KEY = 'd242-inert-a', SECOND_KEY = 'd242-inert-b';
const KEY_NAME = 'graphgoblin-api-key';
const SHA = data => crypto.createHash('sha256').update(data).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const pin = file => { const data = fs.readFileSync(file); return { bytes: data.length, sha256: SHA(data) }; };
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function verify(ref) { assert.deepEqual(pin(ref.source), { bytes: ref.bytes, sha256: ref.sha256 }, 'Pinned bytes changed: ' + ref.source); }
function inside(file, parent) { const rel = path.relative(parent, file); return rel && !rel.startsWith('..') && !path.isAbsolute(rel); }
function save(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' }); }
function walk(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix + entry.name;
    assert(!entry.isSymbolicLink(), 'Distribution symlink');
    return entry.isDirectory() ? walk(path.join(dir, entry.name), relative + '/') : [relative];
  }).sort();
}
const CASES = [
  ['repro', 'script', 'guard'], ['repro', 'deletion', 'guard'],
  ['repro', 'script', 'failure'], ['repro', 'deletion', 'failure'],
  ['supplement', 'script', 'success'], ['supplement', 'deletion', 'success'],
  ['supplement', 'script', 'isolation-failure'], ['supplement', 'deletion', 'isolation-failure'],
  ['supplement', 'deletion', 'dismiss-failure'], ['supplement', 'deletion', 'dismiss-success'],
];

async function main() {
  assert.deepEqual(process.argv.slice(2, 3), ['--binding']);
  assert(process.argv.length === 5 && process.argv[4] === '--execute', 'UNARMED: exact arguments required');
  const bindingPath = path.resolve(process.argv[3]), b = read(bindingPath);
  assert(b.executionAdmitted === true && ['repro', 'all'].includes(b.selection), 'UNARMED binding');
  assert(/^[0-9a-f]{40}$/.test(b.source.head) && /^[0-9a-f]{40}$/.test(b.source.tree));
  verify(b.rootAdmission);
  const admission = read(b.rootAdmission.source);
  assert(admission.executionAdmitted === true && admission.head === b.source.head && admission.selection === b.selection);
  assert(SHA(fs.readFileSync(path.join(__dirname, 'MANIFEST.json'))) === b.preparationManifestSha256);
  for (const member of read(path.join(__dirname, 'MANIFEST.json')).members) {
    assert(inside(path.resolve(__dirname, member.path), __dirname));
    verify({ source: path.join(__dirname, member.path), bytes: member.bytes, sha256: member.sha256 });
  }
  assert(process.version === 'v22.23.4' && samePath(process.execPath, b.runtime.node.source)); verify(b.runtime.node);
  verify(b.runtime.projectPackage); verify(b.runtime.testEntry); verify(b.runtime.playwrightEntry); verify(b.runtime.contractsEntry);
  assert(inside(path.resolve(b.nativeDirectory), E) && !fs.existsSync(b.nativeDirectory));
  fs.mkdirSync(b.nativeDirectory);
  save(path.join(b.nativeDirectory, 'ARGUMENTS.json'), { execPath: process.execPath, argv: process.argv, node: process.version,
    selection: b.selection, source: b.source, interceptedOrigin: ORIGIN, liveServer: false, providerLaunched: false });
  const project = createRequire(b.runtime.projectPackage.source);
  assert(samePath(project.resolve('@playwright/test'), b.runtime.testEntry.source));
  assert(samePath(project.resolve('@graphgoblin/contracts'), b.runtime.contractsEntry.source));
  const playwrightPackage = createRequire(b.runtime.testEntry.source);
  assert(samePath(playwrightPackage.resolve('playwright'), b.runtime.playwrightEntry.source));
  const { chromium } = playwrightPackage('playwright');
  const { RunRecordSchema, RunSnapshotSchema, DeletionSelectionSchema, DeletionConfirmationSchema } = project('@graphgoblin/contracts');
  verify(b.fixture); verify(b.build.manifest); verify(b.build.shippingEquivalence);
  const fixture = read(b.fixture.source), manifest = read(b.build.manifest.source), equivalence = read(b.build.shippingEquivalence.source);
  assert.deepEqual(equivalence.requestedSource, b.source);
  assert.deepEqual(equivalence.buildSource, manifest.source);
  assert(equivalence.appsWebTreeEqual === true);
  const distribution = manifest.webDist;
  assert(Object.keys(distribution).length > 0);
  assert.deepEqual(walk(b.build.dist), Object.keys(distribution).sort());
  const protect = () => {
    const result = {};
    for (const ref of b.protectedInputs) { verify(ref); result[ref.source] = pin(ref.source); }
    for (const [name, ref] of Object.entries(distribution)) {
      assert(inside(path.resolve(b.build.dist, name), path.resolve(b.build.dist)));
      const file = path.join(b.build.dist, name); assert.deepEqual(pin(file), ref); result[file] = pin(file);
    }
    return result;
  };
  const before = protect(); save(path.join(b.nativeDirectory, 'PROTECTED-BEFORE.json'), before);
  const runPath = fixture.runPath, runA = structuredClone(fixture.responses[runPath]), idA = runA.id;
  assert(runPath === '/runs/' + idA && runA.status === 'failed' && runA.finalizedAt && runA.recovery.observedSeq === 6);
  RunSnapshotSchema.parse(runA);
  const idB = idA.slice(0, -1) + (idA.endsWith('Z') ? 'Y' : 'Z');
  const rebind = value => {
    if (typeof value === 'string') return value === idA ? idB : value;
    if (Array.isArray(value)) return value.map(rebind);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rebind(item)]));
    return value;
  };
  const runB = rebind(runA); RunSnapshotSchema.parse(runB);
  const running = structuredClone(runA);
  running.status = 'running'; running.lastEventSeq = 7;
  delete running.failure; delete running.finishedAt; delete running.finalizedAt;
  running.recovery = { observedSeq: 7, resume: { allowed: false, code: 'RUN_ACTIVE', message: 'Controlled running response' },
    replayDefault: { allowed: false, code: 'RUN_ACTIVE', message: 'Controlled running response' }, replay: [] };
  RunSnapshotSchema.parse(running);
  const asRecord = snapshot => { const value = structuredClone(snapshot); delete value.recovery; return RunRecordSchema.parse(value); };
  const selected = CASES.filter(([group]) => b.selection === 'all' || group === 'repro');
  assert(selected.length === (b.selection === 'all' ? 10 : 4));
  let browser, browserClosed = false;
  const report = { source: b.source, build: b.build, node: process.version, selection: b.selection, expectedCases: selected.length,
    evidenceTier: 'Native Edge DOM and browser dispatch; every app/API response intercepted; no backend or duplicate server effects', cases: [] };
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true,
      args: ['--no-first-run', '--disable-background-networking', '--disable-component-update'] });
    report.browser = browser.version();
    for (const [group, action, mode] of selected) {
      const number = report.cases.length + 1;
      const result = await probe(browser, number, group, action, mode);
      report.cases.push(result); save(path.join(b.nativeDirectory, String(number).padStart(2, '0') + '-' + action + '-' + mode + '.json'), result);
      console.log(JSON.stringify({ case: number, action, mode, state: result.state, failedCriteria: result.checks.filter(check => !check.passed).map(check => check.name) }));
    }
  } finally {
    if (browser) { await browser.close(); browserClosed = true; }
    const after = protect(); save(path.join(b.nativeDirectory, 'PROTECTED-AFTER.json'), after); assert.deepEqual(after, before);
    report.browserCloseResolved = browserClosed; report.protectedInputsAndDistributionUnchanged = true;
    report.passed = report.cases.filter(item => item.state === 'passed').length;
    report.failed = report.cases.filter(item => item.state !== 'passed').length;
    save(path.join(b.nativeDirectory, 'RESULTS.json'), report);
  }
  assert(report.cases.length === selected.length && report.failed === 0, 'Native expected-correct criteria failed; preserve first results, no automatic retry');

  async function probe(browser, number, group, action, mode) {
    const result = { number, group, action, mode, checks: [], steps: [], state: 'fixture-error', runA: idA, runB: idB,
      posts: [], previews: [], runReads: [], unknown: [], sourceSameRoute: ORIGIN + '/app' + runPath };
    const check = (name, passed, facts = null) => result.checks.push({ name, passed: Boolean(passed), facts });
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
    const pending = [], held = [];
    let page, pub, holdNew = false, phase = 'before-original-settlement', requestFailures = 0, previewNumber = 0;
    let currentA = structuredClone(runA), cleanupError = null, closePromise = null;
    const stem = String(number).padStart(2, '0') + '-' + action + '-' + mode;
    const deadline = Date.now() + 60000;
    const close = () => closePromise || (closePromise = ctx.close());
    const hardTimer = setTimeout(() => { result.caseDeadlineReached = true; close().catch(error => { cleanupError = String(error); }); }, 60000);
    const until = async (predicate, name, limit = 5000) => {
      const expires = Math.min(deadline, Date.now() + limit);
      while (!(await predicate())) { if (Date.now() >= expires) throw Error('Unreached fixture precondition: ' + name); await delay(20); }
    };
    const json = (route, value) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    const actionPath = action === 'script' ? runPath + '/resume' : '/runs/deletion-eligibility';
    const launcher = () => page.getByRole('button', { name: action === 'script' ? 'Recover script' : 'Review delete-ready history', exact: true });
    const dialog = () => page.getByRole('dialog');
    const heading = id => page.getByRole('heading', { name: 'Run ' + id, exact: true });
    const confirm = () => dialog().getByRole('button', { name: action === 'script' ? 'Resume' : 'Confirm delete-ready selection', exact: true });
    const feedbackPattern = action === 'script' ? /The GraphGoblin API cannot be reached\./i : /The change may or may not have been saved/i;
    const visibleFeedback = async () => {
      const candidates = action === 'deletion' ? page.getByText(feedbackPattern) : page.getByRole('alert');
      const values = await candidates.allTextContents();
      for (let i = 0; i < values.length; i++) if (feedbackPattern.test(values[i]) && await candidates.nth(i).isVisible()) return values[i];
      return null;
    };
    const settle = async (entry, success) => {
      assert(entry && !entry.settled); phase = 'after-original-settlement';
      if (!success) { await entry.route.abort('failed'); entry.settled = true; return; }
      if (action === 'script') { currentA = structuredClone(running); await json(entry.route, asRecord(currentA)); }
      else {
        currentA.deletionApproval = { confirmedAt: runA.createdAt, confirmedBy: { ownerId: 'local', kind: 'user', id: 'local' } };
        await json(entry.route, { token: 'c'.repeat(64), items: [{ runId: idA, reasons: [] }] });
      }
      entry.settled = true;
    };
    const snapshot = async name => {
      const facts = await page.evaluate(() => ({ url: location.href, online: navigator.onLine,
        oldHeaderConnected: window.__d242?.header?.isConnected ?? null, oldHeadingConnected: window.__d242?.heading?.isConnected ?? null,
        removedHeaderRecords: window.__d242?.removedHeaderRecords ?? null, removedHeadingRecords: window.__d242?.removedHeadingRecords ?? null,
        storageEvents: window.__d242?.storageEvents ?? [], dialogs: [...document.querySelectorAll('dialog[open]')].map(el => ({ text: el.innerText,
          buttons: [...el.querySelectorAll('button')].map(button => ({ label: button.textContent, disabled: button.disabled })) })) }));
      result.steps.push({ name, facts });
      await page.screenshot({ path: path.join(b.nativeDirectory, stem + '-' + name + '.png'), fullPage: true });
      return facts;
    };
    const roundTrip = async () => {
      const beforeReads = result.runReads.length;
      await ctx.setOffline(true); await page.waitForFunction(() => !navigator.onLine);
      await page.getByText('Last observed, may be out of date', { exact: true }).waitFor({ state: 'visible' });
      await ctx.setOffline(false); await page.waitForFunction(() => navigator.onLine);
      await page.getByText('Last observed, may be out of date', { exact: true }).waitFor({ state: 'hidden' });
      await until(() => result.runReads.length > beforeReads, 'genuine matching GET after browser recovery');
    };
    const publicNavigate = async id => {
      const next = ORIGIN + '/app/runs/' + id;
      await page.evaluate(url => { history.pushState(null, '', url); dispatchEvent(new PopStateEvent('popstate')); }, next);
      await heading(id).waitFor(); await until(() => result.runReads.some(read => read.id === id), 'public route GET for ' + id);
      assert((await page.url()) === next);
    };
    await ctx.addInitScript(({ keyName, value }) => { if (!localStorage.getItem(keyName)) localStorage.setItem(keyName, value); }, { keyName: KEY_NAME, value: FIRST_KEY });
    await ctx.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url()), p = url.pathname;
      if (url.origin !== ORIGIN) { result.unknown.push('blocked foreign origin'); return route.abort('blockedbyclient'); }
      if (p === '/publisher') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Inert storage publisher</title>' });
      if (p.startsWith('/app/')) {
        const relative = /^\/app\/runs(?:\/[^/]+)?\/?$/.test(p) ? 'index.html' : p.slice(5);
        if (!Object.hasOwn(distribution, relative)) { result.unknown.push('unknown app asset ' + relative); return route.fulfill({ status: 404, body: '' }); }
        const types = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
        return route.fulfill({ contentType: types[path.extname(relative)] || 'application/octet-stream', body: fs.readFileSync(path.join(b.build.dist, relative)) });
      }
      if (req.method() === 'POST') {
        if (p === '/runs/deletion-eligibility/preview') {
          const body = DeletionSelectionSchema.parse(req.postDataJSON()); previewNumber++;
          result.previews.push({ ids: body.runIds, number: previewNumber });
          return json(route, { token: (mode.startsWith('dismiss-') && previewNumber > 1 ? 'b' : 'a').repeat(64), items: body.runIds.map(runId => ({ runId, reasons: [] })) });
        }
        if (p === actionPath) {
          const body = req.postDataJSON();
          if (action === 'script') assert(body.observedSeq === 6 && body.retryUncertainScript === true);
          else { DeletionConfirmationSchema.parse(body); assert.deepEqual(body.runIds, [idA]); assert(body.confirmed === true && body.action === 'mark'); }
          const entry = { route, settled: false }; pending.push(entry);
          result.posts.push({ body, phase, ordinal: pending.length }); return;
        }
        result.unknown.push('unhandled POST ' + p); return route.fulfill({ status: 404, body: '' });
      }
      const id = p === runPath ? idA : p === '/runs/' + idB ? idB : null;
      if (id) {
        const generation = req.headers().authorization === 'Bearer ' + SECOND_KEY ? 'B' : req.headers().authorization === 'Bearer ' + FIRST_KEY ? 'A' : 'other';
        const body = id === idA ? currentA : runB;
        result.runReads.push({ id, generation, phase, bodySha256: SHA(JSON.stringify(body)), held: Boolean(holdNew && id === idA && generation === 'B') });
        if (holdNew && id === idA && generation === 'B') { held.push(route); return; }
        return json(route, body);
      }
      if (p === '/runs') return json(route, { items: [asRecord(currentA), asRecord(runB)], nextCursor: null });
      if (p === '/loops') return json(route, { items: [], nextCursor: null });
      if (p.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': inert stream\n\n' });
      if (p === '/health' || p === '/healthz') return json(route, { status: 'ok' });
      if (Object.hasOwn(fixture.responses, p)) return json(route, fixture.responses[p]);
      const forB = p.replace('/runs/' + idB + '/', runPath + '/');
      if (Object.hasOwn(fixture.responses, forB)) return json(route, rebind(fixture.responses[forB]));
      result.unknown.push(req.method() + ' ' + p); return route.fulfill({ status: 404, body: '' });
    });
    try {
      pub = await ctx.newPage(); await pub.goto(ORIGIN + '/publisher');
      page = await ctx.newPage(); page.setDefaultTimeout(5000); page.setDefaultNavigationTimeout(10000);
      page.on('requestfailed', req => { if (req.method() === 'POST' && req.url() === ORIGIN + actionPath) requestFailures++; });
      await page.goto(ORIGIN + '/app' + runPath); await heading(idA).waitFor(); await launcher().waitFor();
      await page.getByText(/This run has not been confirmed since/).waitFor({ state: 'hidden' });
      await page.evaluate(({ id, keyName, first, second }) => {
        const heading = [...document.querySelectorAll('h1,h2')].find(el => el.textContent === 'Run ' + id);
        const header = heading?.closest('header'); if (!header) throw Error('Actual run header unavailable');
        window.__d242 = { heading, header, removedHeaderRecords: 0, removedHeadingRecords: 0, storageEvents: [] };
        window.addEventListener('storage', event => { if (event.key === keyName) window.__d242.storageEvents.push({ sameStorage: event.storageArea === localStorage, oldA: event.oldValue === first, newB: event.newValue === second }); });
        window.__d242.observer = new MutationObserver(records => { for (const record of records) for (const node of record.removedNodes) {
          if (node === header || node.contains(header)) window.__d242.removedHeaderRecords++;
          if (node === heading || node.contains(heading)) window.__d242.removedHeadingRecords++;
        } });
        window.__d242.observer.observe(document.body, { subtree: true, childList: true });
      }, { id: idA, keyName: KEY_NAME, first: FIRST_KEY, second: SECOND_KEY });
      await launcher().click(); await confirm().click(); await until(() => pending.length === 1, 'one original intercepted command');
      assert(!pending[0].settled && requestFailures === 0);
      if (mode.startsWith('dismiss-')) {
        await dialog().evaluate(el => { if (!(el instanceof HTMLDialogElement)) throw Error('Expected native dialog'); el.close(); });
        await until(async () => !await dialog().isVisible() && await launcher().isEnabled(), 'explicit native dismissal permits read-only preview');
        await launcher().click(); await dialog().waitFor();
        await until(() => result.previews.length === 2, 'second read-only preview only');
        const buttons = await dialog().getByRole('button').evaluateAll(items => items.map(item => ({ label: item.textContent, disabled: item.disabled })));
        const confirmButtons = buttons.filter(item => /Confirm delete-ready selection|Saving/.test(item.label));
        check('read-only replacement confirmation remains guarded', confirmButtons.length === 1 && confirmButtons[0].disabled, buttons);
        check('exactly original confirmation remains outstanding', pending.length === 1 && !pending[0].settled);
        await snapshot('native-dismissed-readonly-preview');
        await dialog().evaluate(el => { window.__d242.secondDialog = el; });
      } else {
        await roundTrip();
        assert(await page.evaluate(() => window.__d242.header.isConnected), 'Original header must survive first browser recovery');
        assert(pending.length === 1 && !pending[0].settled && requestFailures === 0);
        holdNew = true;
        await pub.evaluate(({ name, value }) => localStorage.setItem(name, value), { name: KEY_NAME, value: SECOND_KEY });
        await until(() => held.length > 0, 'actual second-tab new-key GET held');
        await until(() => page.evaluate(() => !window.__d242.header.isConnected && !window.__d242.heading.isConnected), 'actual old header and heading removal');
        await snapshot('matching-new-generation-read-held');
        holdNew = false;
        for (const route of held.splice(0)) await json(route, runA);
        await heading(idA).waitFor(); await page.getByText(/This run has not been confirmed since/).waitFor({ state: 'hidden' });
        assert(await page.url() === result.sourceSameRoute);
        assert(await heading(idA).evaluate(el => el !== window.__d242.heading && el.closest('header') !== window.__d242.header));
        assert(pending.length === 1 && !pending[0].settled && requestFailures === 0);
        const state = await snapshot('same-finalized-body-requalified');
        assert(state.storageEvents.some(event => event.sameStorage && event.oldA && event.newB));
        assert(result.runReads.filter(read => read.id === idA && read.phase === 'before-original-settlement').every(read => read.bodySha256 === SHA(JSON.stringify(runA))));
        if (mode === 'guard') {
          check('replacement launcher is disabled while original command pending', await launcher().isDisabled());
          await launcher().evaluate(el => el.click());
          if (await dialog().isVisible()) {
            const target = confirm(); if (await target.count() && await target.isEnabled()) { await target.click(); await until(() => pending.length === 2, 'visible enabled duplicate confirmation dispatch'); }
          }
          check('replacement dispatches no second confirmation', pending.length === 1, result.posts);
          await snapshot('guard-attempt');
          result.state = result.checks.every(item => item.passed) ? 'passed' : 'failed';
          return result;
        }
        check('replacement control retains pending guard', await launcher().isDisabled());
      }
      const isolation = mode.startsWith('isolation-');
      if (isolation) {
        await publicNavigate(idB);
        check('different run not blocked by original pending action', await launcher().isEnabled());
        if (await launcher().isEnabled()) {
          await launcher().click(); await dialog().waitFor();
          const available = dialog().getByRole('button', { name: action === 'script' ? 'Resume' : 'Confirm delete-ready selection', exact: true });
          check('different-run valid review is confirmable without dispatch', await available.isEnabled());
          await dialog().evaluate(el => el.close());
        }
        await snapshot('different-run-before-old-settlement');
      }
      const succeeds = mode.endsWith('success') || mode === 'success';
      const failuresBefore = requestFailures;
      await settle(pending[0], succeeds);
      if (!succeeds) await until(() => requestFailures > failuresBefore, 'actual original requestfailed event');
      if (isolation) {
        await roundTrip(); await heading(idB).waitFor();
        let leaked = false; const end = Date.now() + 2000;
        while (Date.now() < end) { leaked ||= Boolean(await visibleFeedback()) || await page.getByText('1 run marked delete-ready.', { exact: true }).isVisible(); await delay(20); }
        check('late prior-run outcome does not reach other run after healthy reread', !leaked);
        check('different run remains actionable after prior outcome', await launcher().isEnabled());
        await publicNavigate(idA);
        check('new visit has no prior action feedback', !await visibleFeedback() && !await page.getByText('1 run marked delete-ready.', { exact: true }).isVisible());
        if (!succeeds || action === 'deletion') check('new visit does not inherit prior pending restriction', await launcher().isEnabled());
        await snapshot('new-visit-to-original-run');
      } else if (!succeeds) {
        let feedback = null;
        try { await until(async () => Boolean(feedback = await visibleFeedback()), 'same-run action feedback', 2000); } catch (error) { if (!String(error).includes('same-run action feedback')) throw error; }
        check('late action failure visible within original two-second budget', Boolean(feedback), feedback);
        await snapshot('late-error');
        if (mode === 'failure') {
          check('one original POST before new deliberate choice', pending.length === 1);
          await roundTrip(); await heading(idA).waitFor(); await until(() => launcher().isEnabled(), 'fresh current deliberate choice enabled');
          await launcher().click(); await confirm().click(); await until(() => pending.length === 2, 'new deliberate positive dispatch');
          await settle(pending[1], true); check('fresh deliberate action sends exactly once after first settlement', pending.length === 2);
        }
      } else {
        if (action === 'script') {
          await until(async () => /\brunning\b/i.test(await heading(idA).evaluate(el => el.closest('header').innerText)), 'ordinary script running result visible');
          check('ordinary script success shown on correct run', await heading(idA).isVisible() && !await launcher().isVisible());
        } else {
          let outcome = false;
          try { await page.getByText('1 run marked delete-ready.', { exact: true }).waitFor({ state: 'visible', timeout: 2000 }); outcome = true; } catch (error) { if (error.name !== 'TimeoutError') throw error; }
          check('ordinary deletion success shown on correct run', outcome);
        }
        check('ordinary result did not add a second POST', pending.length === 1);
        await snapshot('ordinary-success');
      }
      if (mode.startsWith('dismiss-')) check('read-only replacement review remains its own dialog', await page.evaluate(() => window.__d242.secondDialog.isConnected && window.__d242.secondDialog.open));
      check('all API/page routes explicitly handled', result.unknown.length === 0, result.unknown);
      result.state = result.checks.every(item => item.passed) ? 'passed' : 'failed';
    } catch (error) { result.error = String(error); result.state = 'fixture-error'; }
    finally {
      clearTimeout(hardTimer);
      if (page && !page.isClosed()) {
        try { await page.screenshot({ path: path.join(b.nativeDirectory, stem + '-final.png'), fullPage: true }); } catch (error) { result.finalScreenshotError = String(error); }
      }
      for (const entry of pending) if (!entry.settled) { try { await entry.route.abort('aborted'); entry.settled = true; } catch (error) { cleanupError ||= String(error); } }
      for (const route of held.splice(0)) { try { await route.abort('aborted'); } catch (error) { cleanupError ||= String(error); } }
      await close();
      result.requestFailures = requestFailures; result.cleanupCloseResolved = true;
      result.onlyInterceptedDispatchNoServerEffects = true;
      if (cleanupError) { result.cleanupError = cleanupError; result.state = 'fixture-error'; }
      if (result.unknown.length) { result.state = 'fixture-error'; }
    }
    return result;
  }
}
main().catch(error => { console.error(error.stack || String(error)); process.exitCode = 1; });
