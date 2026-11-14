async (page) => {
  const origin = new URL(page.url()).origin;
  const suffix = crypto.randomUUID().slice(0, 8);
  const posts = [], observations = [], pageErrors = [];
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
  });
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
    const pendingConflict = putResponse(id);
    await nameBox().fill(name);
    const refusal = await tapResponse(pendingConflict, 409, 'LOOP_NAME_CONFLICT');
    await notice().getByRole('button', { name: 'Try again', exact: true }).waitFor(wait);
    equal(refusal.ifMatch, '"' + original.draftToken + '"', 'Initial refusal sent genuine base token');
    equal(await detail(id), original, 'Initial refusal preserved exact target');
    equal(posts.length, 1, 'Exactly one browser PUT before invalid edit');

    stage = 'invalid companion input and explicit retry';
    const invalidDescription = 'V'.repeat(3988) + 'INVALID-4001!';
    equal(invalidDescription.length, 4001, 'Native input has exactly the unsupported size');
    await descriptionBox().click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText(invalidDescription);
    equal(await descriptionBox().inputValue(), invalidDescription, 'Native description retained invalid text');
    await notice().getByRole('button', { name: 'Try again', exact: true }).click();
    await notice().getByRole('button', { name: 'Trying again…', exact: true }).waitFor(wait);
    const invalidLocal = await device(id, name, invalidDescription, false);
    equal(invalidLocal.baseToken, original.draftToken, 'Unsynced invalid draft keeps original token');
    await page.evaluate(() => new Promise((done) => setTimeout(done, 1000)));
    const stuck = await snapshot('invalid retry after full autosave interval');
    const busy = stuck.retry.find((button) => button.text === 'Trying again…');
    check(busy?.ariaDisabled === 'true' && busy?.ariaBusy === 'true', 'Retry does not stay busy after schema refusal');
    equal(posts.length, 1, 'Invalid retry sent no browser PUT');
    equal(await detail(id), original, 'Invalid retry preserved exact server content');
    await page.screenshot({ path: 'baseline-invalid-retry-stuck.png', animations: 'disabled' });

    stage = 'release name while invalid';
    const clear = await api('PUT', draftPath(holderId), 200,
      { definition: { ...holder.draft.definition, name: 'Released retry name ' + suffix } }, holder.draftToken);
    equal(clear.draft.id, holder.draft.id, 'Holder rename kept its own draft');
    equal(posts.length, 1, 'Independent writer used separate API client');
    equal(await detail(id), original, 'Freeing the name did not change target');

    stage = 'repair description only without a second retry';
    const wouldSave = putResponse(id);
    const repaired = 'Edited companion description without another retry';
    await descriptionBox().click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText(repaired);
    equal(await nameBox().inputValue(), name, 'Conflicting name unchanged from refused text');
    const unexpected = await tapResponse(wouldSave, 200);
    equal(posts.length, 2, 'Repair alone triggered exactly one unexpected PUT');
    equal(posts[1].stage, stage, 'Unexpected PUT was sent during repair-only stage');
    const next = { ...original.draft.definition, name, description: repaired };
    equal(unexpected.request.definition, next, 'Unexpected request carried same name and repaired description');
    equal(unexpected.ifMatch, '"' + original.draftToken + '"', 'Unexpected request used allowed original token');
    equal(unexpected.body.draft.id, original.draft.id, 'Target draft identity stable');
    const persisted = await detail(id);
    equal(persisted.draft.definition, next, 'Actual stored definition agrees with unauthorized retry');
    check(persisted.draftToken !== original.draftToken, 'Unexpected save advanced content token');
    const synced = await device(id, name, repaired, true);
    equal(synced.baseToken, persisted.draftToken, 'Actual device copy marked synced to unexpected write');
    const done = await snapshot('after repair-only PUT');
    await page.screenshot({ path: 'baseline-repair-only-saved.png', animations: 'disabled' });
    observations.push({ stage: 'exact-state-readbacks', refusal, original, invalidLocal, stuck, clearedHolder: clear.draft,
      unexpected, persisted, synced, finalUi: done });
    equal(pageErrors, [], 'Unexpected browser page errors');
  } catch (error) {
    failure = { stage, message: String(error), stack: error.stack };
    await snapshot('first fixture failure').catch(() => {});
    await page.screenshot({ path: 'first-failure.png', animations: 'disabled' }).catch(() => {});
  }
  return { suite: 'invalid-companion-209', origin, browser: await page.evaluate(() => navigator.userAgent),
    posts, observations, pageErrors, failure, reproduced: failure === null };
}
