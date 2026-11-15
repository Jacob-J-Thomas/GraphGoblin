async (page) => {
  // COPIED from name-retry-invalid-209-independent/verify-invalid-retry.playwright.js (sha256
  // e473363f...), a BASELINE driver that asserted the #209 U2 defect. Modified for the corrected
  // #237+#209 integration candidate: fixture, helpers and the real-refusal stage are unchanged;
  // the later stages now assert the corrected U2 behavior (the invalid save ends the attempt
  // without a PUT and offers Try again again; repair alone sends nothing; one fresh Try again sends
  // one PUT), and #237 readiness beside the refusal and the Publish refusal are added.
  const origin = new URL(page.url()).origin;
  const suffix = crypto.randomUUID().slice(0, 8);
  const posts = [], publishes = [], observations = [], pageErrors = [];
  let stage = 'fixture setup';
  let failure = null;
  const check = (test, message) => { if (!test) throw new Error(message); };
  function canonical(x) {
    return JSON.stringify(x, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
  }
  function equal(actual, expected, message) {
    check(canonical(actual) === canonical(expected), message + '\nExpected ' + canonical(expected) +
      '\nActual ' + canonical(actual));
  }
  const wait = { timeout: 9000 };
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('request', (req) => {
    const path = new URL(req.url()).pathname;
    if (req.method() === 'PUT' && /^\/loops\/[^/]+\/draft$/.test(path)) {
      posts.push({ time: Date.now(), stage, path, ifMatch: req.headers()['if-match'] ?? null,
        type: req.method(), definition: req.postDataJSON().definition });
    }
    if (req.method() === 'POST' && /^\/loops\/[^/]+\/publish$/.test(path))
      publishes.push({ time: Date.now(), stage, path });
  });
  const READY = 'Ready to publish';
  const NAME_REFUSAL = 'Another loop already has this name; choose a different name before publishing.';
  async function readiness(label) {
    const ready = await page.getByText(READY, { exact: true }).count();
    const unavailable = page.getByText('Validation unavailable', { exact: true });
    const shown = await unavailable.count();
    const value = { label, ready, unavailable: shown, title: shown ? await unavailable.getAttribute('title') : null };
    observations.push({ stage: 'readiness: ' + label, ...value });
    return value;
  }
  async function api(method, path, status, data, token) {
    const r = await page.request.fetch(origin + path, { method, timeout: 10000,
      ...(data === undefined ? {} : { data }),
      ...(token ? { headers: { 'if-match': '"' + token + '"' } } : {}) });
    const result = await r.json();
    equal(r.status(), status, method + ' ' + path);
    return result;
  }
  const detail = (id) => api('GET', '/loops/' + id, 200);
  const draftPath = (id) => '/loops/' + id + '/draft';
  async function create(name, subject) {
    const definition = {
      schemaVersion: 4, name, description: 'Persisted description for ' + subject,
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Manual start', ui: { x: 0, y: 90 }, config: { type: 'manual' } },
        { id: 'done', kind: 'exit', label: 'Exit', ui: { x: 300, y: 90 },
          config: { returns: JSON.stringify('Stable graph marker ' + subject) } },
      ],
      edges: [{ id: 'connect', from: { node: 'start', port: 'out' }, to: { node: 'done', port: 'in' } }],
    };
    const result = await api('POST', '/loops', 201, { definition });
    return result.loop.id;
  }
  function putResponse(id) {
    return page.waitForResponse((r) => r.request().method() === 'PUT' &&
      new URL(r.url()).pathname === draftPath(id), wait);
  }
  async function tapResponse(pending, status, code) {
    const r = await pending;
    const body = await r.json();
    equal(r.status(), status, 'Browser PUT status');
    if (code) equal(body.code, code, 'Browser problem code');
    return { status, body, ifMatch: r.request().headers()['if-match'] ?? null,
      request: r.request().postDataJSON() };
  }
  async function device(id, name, description, synced) {
    const copy = await page.waitForFunction(async (query) => {
      const item = await new Promise((done) => {
        const opened = indexedDB.open('graphgoblin');
        opened.onupgradeneeded = () => opened.transaction.abort();
        opened.onerror = () => done(null);
        opened.onsuccess = () => {
          const db = opened.result;
          try {
            const call = db.transaction('drafts').objectStore('drafts').get(query.id);
            call.onsuccess = () => { db.close(); done(call.result ?? null); };
            call.onerror = () => { db.close(); done(null); };
          } catch { db.close(); done(null); }
        };
      });
      return item?.definition?.name === query.name && item.definition.description === query.description &&
        item.synced === query.synced && item;
    }, { id, name, description, synced }, { timeout: 9000, polling: 120 });
    const value = await copy.jsonValue();
    await copy.dispose();
    return value;
  }
  const nameBox = () => page.getByLabel('Name', { exact: true });
  const descriptionBox = () => page.getByLabel('Description', { exact: true });
  const notice = () => page.getByRole('status').filter({ hasText: 'Another loop already has this name' });
  const snapshot = async (label) => {
    const state = await page.evaluate(() => ({
      heading: document.querySelector('h1')?.textContent?.trim() ?? null,
      name: document.querySelector('#loop-name')?.value ?? null,
      descriptionLength: document.querySelector('#loop-description')?.value.length ?? null,
      save: document.querySelector('[data-testid="save-state"]')?.textContent?.trim() ?? null,
      retry: [...document.querySelectorAll('button')].filter((b) => /^Try(ing)? again/.test(b.textContent.trim()))
        .map((b) => ({ text: b.textContent.trim(), disabled: b.disabled, ariaDisabled: b.getAttribute('aria-disabled'),
          ariaBusy: b.getAttribute('aria-busy') })),
    }));
    observations.push({ stage: label, ...state });
    return state;
  };

  try {
    check(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) && !/:474[78]$/.test(origin), 'Refused fixture origin');
    stage = 'real name refusal';
    const name = 'Occupied retry ' + suffix;
    const holderId = await create(name, 'holder');
    const id = await create('Target retry ' + suffix, 'target');
    const original = await detail(id);
    const holder = await detail(holderId);
    await page.goto(origin + '/app/loops/' + id + '/edit');
    await page.getByRole('heading', { name: original.loop.name, exact: true }).waitFor(wait);
    const reveal = page.getByRole('button', { name: 'Show loop settings', exact: true });
    await page.getByRole('button', { name: /^(Show|Hide) loop settings$/ }).waitFor(wait);
    if (await reveal.isVisible()) await reveal.click();
    await nameBox().waitFor(wait);
    await page.getByText('The editor is available. Checking the server and this device before saving changes.', { exact: true })
      .waitFor({ state: 'hidden', timeout: 9000 });
    await page.getByText(READY, { exact: true }).waitFor(wait);
    const pendingConflict = putResponse(id);
    await nameBox().fill(name);
    const refusal = await tapResponse(pendingConflict, 409, 'LOOP_NAME_CONFLICT');
    await notice().getByRole('button', { name: 'Try again', exact: true }).waitFor(wait);
    equal(refusal.ifMatch, '"' + original.draftToken + '"', 'Initial refusal sent genuine base token');
    equal(await detail(id), original, 'Initial refusal preserved exact target');
    equal(posts.length, 1, 'Exactly one browser PUT before invalid edit');

    stage = 'readiness and Publish beside the name refusal (#237)';
    await page.getByText('Validation unavailable', { exact: true }).waitFor(wait);
    const refusedReadiness = await readiness('refused name');
    equal(refusedReadiness, { label: 'refused name', ready: 0, unavailable: 1, title: NAME_REFUSAL },
      'No readiness claim beside a known name refusal');
    await snapshot('refused name');
    await page.screenshot({ path: 'u2-refused-readiness.png', animations: 'disabled' });
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await page.getByRole('alert').filter({ has: page.getByText('Publish failed', { exact: true }) })
      .filter({ hasText: NAME_REFUSAL }).waitFor(wait);
    equal(publishes.length, 0, 'Publish sent nothing beside the refusal');
    equal(posts.length, 1, 'Publish sent no draft save beside the refusal');

    stage = 'invalid companion input and explicit retry';
    const invalidDescription = 'V'.repeat(3988) + 'INVALID-4001!';
    equal(invalidDescription.length, 4001, 'Native input has exactly the unsupported size');
    await descriptionBox().click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText(invalidDescription);
    equal(await descriptionBox().inputValue(), invalidDescription, 'Native description retained invalid text');
    await notice().getByRole('button', { name: 'Try again', exact: true }).click();
    const invalidLocal = await device(id, name, invalidDescription, false);
    equal(invalidLocal.baseToken, original.draftToken, 'Unsynced invalid draft keeps original token');
    await page.evaluate(() => new Promise((done) => setTimeout(done, 1000)));
    const ended = await snapshot('invalid retry after full autosave interval');
    equal(ended.retry, [{ text: 'Try again', disabled: false, ariaDisabled: null, ariaBusy: null }],
      'The invalid save ended the attempt and Try again is offered again');
    equal(posts.length, 1, 'Invalid retry sent no browser PUT');
    equal(await detail(id), original, 'Invalid retry preserved exact server content');
    await page.screenshot({ path: 'u2-invalid-retry-offered.png', animations: 'disabled' });

    stage = 'release name while invalid';
    const clear = await api('PUT', draftPath(holderId), 200,
      { definition: { ...holder.draft.definition, name: 'Released retry name ' + suffix } }, holder.draftToken);
    equal(clear.draft.id, holder.draft.id, 'Holder rename kept its own draft');
    equal(posts.length, 1, 'Independent writer used separate API client');
    equal(await detail(id), original, 'Freeing the name did not change target');

    stage = 'repair description only without a second retry';
    const repaired = 'Edited companion description without another retry';
    await descriptionBox().click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText(repaired);
    equal(await nameBox().inputValue(), name, 'Conflicting name unchanged from refused text');
    await page.evaluate(() => new Promise((done) => setTimeout(done, 1500)));
    equal(posts.length, 1, 'Repair alone sent no browser PUT');
    equal(await detail(id), original, 'Repair alone left the exact server content');
    const repairedLocal = await device(id, name, repaired, false);
    equal(repairedLocal.baseToken, original.draftToken, 'Repaired unsynced draft keeps original token');
    const held = await snapshot('after repair only');
    equal(held.save, 'Not saved: name in use', 'Repaired draft still held by the refusal');
    equal(held.retry, [{ text: 'Try again', disabled: false, ariaDisabled: null, ariaBusy: null }],
      'Try again still offered after repair');
    equal((await readiness('repaired, still refused')).title, NAME_REFUSAL, 'Readiness still says why');

    stage = 'one fresh deliberate Try again';
    const fresh = putResponse(id);
    await notice().getByRole('button', { name: 'Try again', exact: true }).click();
    const accepted = await tapResponse(fresh, 200);
    const next = { ...original.draft.definition, name, description: repaired };
    equal(accepted.request.definition, next, 'Fresh retry sent the refused name and repaired description');
    equal(accepted.ifMatch, '"' + original.draftToken + '"', 'Fresh retry used the original token');
    equal(accepted.body.draft.id, original.draft.id, 'Target draft identity stable');
    await notice().waitFor({ state: 'hidden', timeout: 9000 });
    await page.waitForFunction(() => document.querySelector('[data-testid="save-state"]')?.textContent === 'All changes saved',
      null, wait);
    await page.evaluate(() => new Promise((done) => setTimeout(done, 1000)));
    equal(posts.length, 2, 'One fresh deliberate retry sent exactly one PUT');
    const persisted = await detail(id);
    equal(persisted.loop.name, name, 'Server holds the retried name');
    equal(persisted.draft.definition, next, 'Stored definition is the fresh retry request');
    check(persisted.draftToken !== original.draftToken, 'Accepted save advanced content token');
    const synced = await device(id, name, repaired, true);
    equal(synced.baseToken, persisted.draftToken, 'Device copy synced to the accepted save');
    await page.getByText(READY, { exact: true }).waitFor(wait);
    const readyAgain = await readiness('after the accepted retry');
    equal([readyAgain.ready, readyAgain.unavailable], [1, 0], 'Readiness returns once saved and checked');
    const done = await snapshot('after fresh retry');
    await page.screenshot({ path: 'u2-fresh-retry-saved.png', animations: 'disabled' });
    observations.push({ stage: 'exact-state-readbacks', refusal, original, invalidLocal, ended, clearedHolder: clear.draft,
      repairedLocal, held, accepted, persisted, synced, finalUi: done });
    equal(publishes.length, 0, 'No publish request in this scenario');
    equal(pageErrors, [], 'Unexpected browser page errors');
  } catch (error) {
    failure = { stage, message: String(error), stack: error.stack };
    await snapshot('first fixture failure').catch(() => {});
    await page.screenshot({ path: 'first-failure-u2.png', animations: 'disabled' }).catch(() => {});
  }
  return { suite: 'u2-invalid-repair-fresh-retry-and-237-readiness', origin,
    browser: await page.evaluate(() => navigator.userAgent),
    posts, publishes, observations, pageErrors, failure, passed: failure === null };
}
