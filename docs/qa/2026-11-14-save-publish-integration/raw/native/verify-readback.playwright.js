async (page) => {
  const url = new URL(page.url());
  const origin = url.origin;
  const targetGroup = url.searchParams.get('qa-group') || 'all';
  // COPIED from save-publish-237-readback-diagnostic/diagnostic-attempt1.executed.playwright.js
  // (sha256 940a197a...). Modified only: this mapping label, the admitted qa-group, and a
  // screenshot after each variant's assertions. Assertions and barriers are unchanged.
  const mapping = 'integration-237-209-dirty-candidate';
  const statusWith = (target, text) => target.getByRole('status').filter({ hasText: text });
  const publishError = (target, text) => target.getByRole('alert')
    .filter({ has: target.getByText('Publish failed', { exact: true }) }).filter({ hasText: text });
  // Match scoped landmarks and the factual clause. State and identity are asserted separately.
  const noticeSelectors = {
    laterWork: (target, { version }) => statusWith(target, 'Published version ' + version + '.')
      .filter({ hasText: 'changes made after that are not published.' }),
    mismatch: (target, { version, competing }) => statusWith(target,
      competing ? 'Nothing was published' : 'A different draft was published')
      .filter({ hasText: competing ? 'current version, version ' + version + ',' : 'Version ' + version + ' holds' })
      .filter({ hasText: 'holds a different stored draft from the draft saved for this publish.' }),
    alreadyStored: (target, { version }) => statusWith(target, 'Nothing to publish: version ' + version + ' already holds')
      .filter({ hasText: 'draft.' }),
    unknown: (target, { preSend = false } = {}) => statusWith(target, 'Publish not confirmed').filter({
      hasText: preSend ? 'Nothing was sent' : 'Publish again checks the server first.',
    }),
    heldInput: (target) => publishError(target, 'Some fields hold input that is not a valid value yet; complete or discard it first.'),
    refusal: (target, { code }) => {
      if (code === 'LOOP_NAME_CONFLICT')
        return publishError(target, 'Another loop already has this name; choose a different name before publishing.');
      if (code === 'DRAFT_CONFLICT')
        return publishError(target, 'The draft changed on the server; reload it or overwrite it first.');
      if (code === 'SAVE_TRANSPORT')
        return publishError(target, 'The draft could not be saved; fix the issues below first.');
      if (code === 'LOOP_INVALID') return publishError(target, 'LOOP_INVALID').filter({ hasText: 'gates.absent' });
      throw new Error('Unmapped refusal ' + code);
    },
    newerAnnouncement: (target, { older, newer }) => statusWith(target, 'Published version ' + older + '.')
      .filter({ hasText: 'Version ' + newer + ' has been published since.' }),
  };
  const groups = ['publication', 'transport', 'list', 'ancestry', 'refusals'];
  const outcomes = [], chronology = [], checkpoints = [], failures = [], pageErrors = [];
  const addedPages = [], barriers = [];
  const suffix = crypto.randomUUID().slice(0, 8);
  let active = 'fixture setup';
  let seq = 0;
  function note(type, facts = {}) {
    const entry = { seq: ++seq, type, wallMs: Date.now(), ...facts };
    chronology.push(entry);
    return entry;
  }
  function check(condition, message) {
    if (!condition) throw new Error(message);
  }
  const canon = (data) => JSON.stringify(data, (_, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]]))
      : x);
  function same(actual, expected, context) {
    check(canon(actual) === canon(expected),
      context + '\nExpected ' + canon(expected) + '\nActual ' + canon(actual));
  }
  function deferred() {
    let resolve;
    const promise = new Promise((ok) => { resolve = ok; });
    return { promise, resolve };
  }
  const pathFor = (id) => '/loops/' + id;
  const editPath = (id) => '/app' + pathFor(id) + '/edit';
  const quoted = (token) => '"' + token + '"';
  const findNode = (definition, id) => definition.nodes.find((node) => node.id === id);
  const has = (str, part) => str.includes(part);
  const waitOptions = { timeout: 8000 };

  function bind(target, tag) {
    target.on('pageerror', (error) => pageErrors.push({ tag, error: String(error) }));
    target.on('request', (req) => {
      const { pathname } = new URL(req.url());
      if (!/^\/(?:loops(?:\/|$)|runs(?:\/|$))/.test(pathname)) return;
      const match = note('browser request', { tag, path: pathname, method: req.method(),
        ifMatch: req.headers()['if-match'] ?? null, body: req.postData() === null ? null : req.postDataJSON() });
      req.response().then((reply) => {
        if (reply) note('browser response', { requestSeq: match.seq, status: reply.status(), tag, path: pathname, method: req.method() });
        else note('browser request ended without HTTP response', { requestSeq: match.seq, tag, path: pathname });
      }).catch(() => {});
    });
  }
  bind(page, 'primary');

  async function api(method, path, status = 200, body, token) {
    const reply = await page.request.fetch(origin + path, {
      method, timeout: 12000,
      ...(body === undefined ? {} : { data: body }),
      ...(token ? { headers: { 'if-match': quoted(token) } } : {}),
    });
    const data = await reply.json();
    note('independent HTTP', { method, path, status: reply.status(),
      ...(body === undefined ? {} : { body }), ...(token ? { ifMatch: quoted(token) } : {}) });
    same(reply.status(), status, 'Unexpected independent response ' + path + ' ' + canon(data));
    return data;
  }
  const detail = (id) => api('GET', pathFor(id));
  const versions = (id) => api('GET', pathFor(id) + '/versions');
  const exactVersion = (id, versionId) => api('GET', pathFor(id) + '/versions/' + versionId);
  const summaries = () => api('GET', '/loops');
  const summary = (list, id) => list.items.find((item) => item.id === id);
  const update = (id, definition, baseToken) => api('PUT', pathFor(id) + '/draft', 200, { definition }, baseToken);
  const freeze = async (id) => (await api('POST', pathFor(id) + '/publish')).version;
  function definition(name, desc, result = 'seed release') {
    return {
      schemaVersion: 4, name, description: desc,
      variables: { key: { type: 'string', description: 'Retain accepted variable metadata' } },
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', ui: { x: 0, y: 80 }, config: { type: 'manual' } },
        { id: 'done', kind: 'exit', label: 'Done', ui: { x: 300, y: 80 }, config: { returns: JSON.stringify(result) } },
      ],
      edges: [{ id:'connect', from: { node:'start', port:'out' }, to: { node: 'done', port:'in' } }],
    };
  }
  async function create(name, desc, result) {
    const made = await api('POST', '/loops', 201, { definition: definition(name + ' ' + suffix, desc, result) });
    return made.loop.id;
  }
  async function attachPage(tag) {
    const target = await page.context().newPage();
    bind(target, tag);
    addedPages.push(target);
    return target;
  }

  // Both barriers pass the real payload to the built gateway and never synthesize success bodies.
  async function barrier(target, { method, path, order, label, drop = false, pick = () => true }) {
    const intercepted = deferred();
    const release = deferred();
    const finished = deferred();
    const match = (candidate) => candidate.origin === origin && candidate.pathname === path;
    let used = false;
    const handler = async (route) => {
      const req = route.request();
      if (used || req.method() !== method || new URL(req.url()).pathname !== path || !pick(req)) {
        await route.fallback();
        return;
      }
      used = true;
      const reqInfo = { method, path, ifMatch: req.headers()['if-match'] ?? null,
        data: req.postData() === null ? null : req.postDataJSON() };
      try {
        note('barrier intercepted', { label, order, ...reqInfo });
        if (order === 'before') {
          intercepted.resolve({ reqInfo });
          await release.promise;
          note('barrier dispatched', { label });
          if (drop) await route.abort('failed');
          else await route.continue();
        } else {
          const stored = await route.fetch({ timeout: 12000, maxRetries: 0, maxRedirects: 0 });
          const received = await stored.json();
          const response = { status: stored.status(), body: received };
          note('barrier upstream response captured', { label, status: stored.status() });
          intercepted.resolve({ reqInfo, response });
          await release.promise;
          note('barrier observer release', { label, drop });
          if (drop) await route.abort('failed');
          else await route.fulfill({ response: stored });
          await stored.dispose();
        }
        finished.resolve({ ok: true });
      } catch (error) {
        const result = { error: String(error) };
        intercepted.resolve(result);
        finished.resolve(result);
        note('barrier route ended', { label, error: result.error });
      }
    };
    await target.route(match, handler);
    const lease = { label, wait: intercepted.promise, open: () => release.resolve(),
      done: finished.promise, detach: async () => {
        release.resolve();
        await target.unroute(match, handler).catch(() => {});
      } };
    barriers.push(lease);
    return lease;
  }
  async function reached(target, lease) {
    const timer = target.evaluate(() => new Promise((done) => setTimeout(() => done({ timeout: true }), 12500)));
    const result = await Promise.race([lease.wait, timer]);
    check(!(result?.timeout || result?.error), 'Barrier ' + lease.label + ' was not reached: ' + canon(result));
    return result;
  }
  async function release(lease) {
    lease.open();
    return lease.done;
  }
  function response(target, method, path) {
    return target.waitForResponse((reply) => reply.request().method() === method &&
      new URL(reply.url()).pathname === path, { timeout: 12500 });
  }
  async function received(pending, expectedStatus, code) {
    const reply = await pending;
    const req = reply.request();
    const out = { status: reply.status(), request: req.postData() === null ? null : req.postDataJSON(),
      ifMatch: req.headers()['if-match'] ?? null, data: await reply.json() };
    same(out.status, expectedStatus, 'Observed browser HTTP status');
    if (code) same(out.data.code, code, 'Observed browser problem');
    return out;
  }

  const publish = (target) => target.getByRole('button', { name: 'Publish', exact: true });
  const publicationNoticeAbsent = (ui, version) => !ui.notices.some((item) =>
    has(item.text, 'Published version ' + version + '.') || has(item.text, 'A different draft was published'));
  const desc = (target) => target.getByLabel('Description', { exact: true });
  const nameBox = (target) => target.getByLabel('Name', { exact: true });
  const saves = (id) => chronology.filter((x) => x.type === 'browser request' &&
    x.method === 'PUT' && x.path === pathFor(id) + '/draft');
  const postings = (id) => chronology.filter((x) => x.type === 'browser request' &&
    x.method === 'POST' && x.path === pathFor(id) + '/publish');
  function storedRelease(id, version) {
    return exactVersion(id, version.id).then((record) => {
      same(record, version, 'Immutable version matches exact server response');
      same(record.status, 'published', 'Version readback is actually immutable');
      return record;
    });
  }
  const loopListLink = (target) => target.getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Loops', exact: true });
  const row = (target, id) => target.locator('tr').filter({ has: target.locator('a[href="' + editPath(id) + '"]') });

  async function settings(target) {
    const reveal = target.getByRole('button', { name: 'Show loop settings', exact: true });
    await target.getByRole('button', { name: /^(Show|Hide) loop settings$/ }).waitFor(waitOptions);
    if (await reveal.isVisible()) await reveal.click();
    await desc(target).waitFor(waitOptions);
  }
  async function open(target, id, name, useNavigation = true) {
    await target.bringToFront();
    if (useNavigation) await target.goto(origin + editPath(id));
    if (name) await target.getByRole('heading', { name, exact: true }).waitFor(waitOptions);
    await target.getByText('The editor is available. Checking the server and this device before saving changes.', { exact: true })
      .waitFor({ state: 'hidden', timeout: 8000 });
    await settings(target);
  }
  async function saved(target) {
    await target.waitForFunction(() => document.querySelector('[data-testid="save-state"]')?.textContent === 'All changes saved',
      null, waitOptions);
  }
  async function readUI(target, label) {
    const content = await target.evaluate(() => ({
      path: location.pathname,
      title: document.querySelector('h1')?.textContent ?? null,
      save: document.querySelector('[data-testid="save-state"]')?.textContent ?? null,
      description: document.querySelector('#loop-description')?.value ?? null,
      notices: [...document.querySelectorAll('[role="status"],[role="alert"]')]
        .filter((el) => el.getClientRects().length)
        .map((el) => ({ role: el.getAttribute('role'), text: el.textContent?.trim(), links: [...el.querySelectorAll('a')].map((a) => a.getAttribute('href')) })),
    }));
    checkpoints.push({ label, ...content });
    return content;
  }
  async function notice(target, key, args = {}) {
    const profile = noticeSelectors[key];
    check(typeof profile === 'function', 'Bind final visible notice selector for ' + key + ' before native execution');
    const locator = profile(target, args);
    await locator.waitFor(waitOptions);
    const links = await locator.locator('a').evaluateAll((items) =>
      items.map((a) => ({ text: a.textContent, href: a.getAttribute('href') })));
    return { text: await locator.innerText(), links };
  }
  async function waitRow(target, id, expectedName) {
    const item = row(target, id);
    await item.getByRole('link', { name: expectedName, exact: true }).waitFor(waitOptions);
    return item;
  }
  async function requestCountAfterQuiet(target, values, expected, label) {
    // Wait for both debounce and a renderer turn. This bounded observation establishes absence in the exercised interval.
    await target.evaluate(() => new Promise((done) => setTimeout(done, 1000)));
    same(values().length, expected, label);
  }
  async function awaitRun(id, version, result) {
    const { run } = await api('POST', pathFor(id) + '/runs', 202, { versionId: version });
    same(run.versionId, version, 'Pinned admission');
    let snap;
    for (const deadline = Date.now() + 10000; Date.now() < deadline;) {
      snap = await api('GET', '/runs/' + run.id);
      if (snap.finalizedAt || ['failed','cancelled','exhausted'].includes(snap.status)) break;
      await page.evaluate(() => new Promise((done) => setTimeout(done, 125)));
    }
    same(snap?.status, 'succeeded', 'Provider-free pin completed');
    check(snap.finalizedAt, 'Run not finalized');
    same(snap.versionId, version, 'Pinned snapshot');
    same(snap.result, result, 'Pin used exact old executable content');
    return snap;
  }
  async function deviceCopy(target, id) {
    return target.evaluate((key) => new Promise((done) => {
      const request = indexedDB.open('graphgoblin');
      request.onupgradeneeded = () => request.transaction.abort();
      request.onerror = () => done(null);
      request.onsuccess = () => {
        const db = request.result;
        try {
          const read = db.transaction('drafts').objectStore('drafts').get(key);
          read.onsuccess = () => { db.close(); done(read.result ?? null); };
          read.onerror = () => { db.close(); done(null); };
        } catch { db.close(); done(null); }
      };
    }), id);
  }
  async function laterUntil(target, fn) {
    for (const deadline = Date.now() + 8000; Date.now() < deadline;) {
      const value = await fn();
      if (value) return value;
      await target.evaluate(() => new Promise((done) => setTimeout(done, 125)));
    }
    throw new Error('Bounded local readback did not converge');
  }

  async function retryReadbackFence(variant) {
    active = 'unknown retry readback in queue / ' + variant;
    const id = await create('Retry fence ' + variant, 'An earlier immutable release', 'old pin');
    const initialVersion = await freeze(id);
    const base = await detail(id);
    const newDraft = JSON.parse(JSON.stringify(initialVersion.definition));
    newDraft.description = 'Accepted current draft awaiting intentional publication';
    findNode(newDraft, 'done').config.returns = '"new pin"';
    const newAcknowledged = await update(id, newDraft, base.draftToken);
    const before = await detail(id);
    await open(page, id, before.loop.name);
    const path = pathFor(id);
    const post = path + '/publish';
    const dropped = await barrier(page, { method: 'POST', path: post, order: 'before',
      label: 'retry readback ' + variant + ' first POST dropped before gateway admission', drop: true });
    const attemptedReads = [];
    const fail = async (route) => {
      if (route.request().method() !== 'GET') { await route.fallback(); return; }
      attemptedReads.push(note('initial retry readback blocked', { path }));
      await route.abort('failed');
    };
    await page.route(origin + path, fail);
    try {
      await publish(page).click();
      await reached(page, dropped);
      await release(dropped);
      await notice(page, 'unknown');
      check(attemptedReads.length > 0, 'First attempt had no failed independent reconciliation GET');
      same(postings(id).length, 1, 'One failed browser POST was observed');
      same(await detail(id), before, 'First POST never reached durable admission');
      await storedRelease(id, initialVersion);
    } finally {
      await page.unroute(origin + path, fail).catch(() => {});
    }
    const get = await barrier(page, { method: 'GET', path, order: 'after',
      label: 'retry readback ' + variant + ' old-current proof withheld before actual send' });
    const retryFrom = seq;
    const second = variant === 'healthy' ? response(page, 'POST', post) : null;
    await publish(page).click();
    const capturedRead = (await reached(page, get)).response;
    same(capturedRead.status, 200, 'Genuine retry preflight GET');
    same(capturedRead.body.current, initialVersion, 'Readback has the old immutable version');
    same(capturedRead.body.draft, newAcknowledged.draft, 'Readback has the still-unpublished accepted draft');
    same(postings(id).length, 1, 'Retry POST is waiting on the GET result');
    let changed;
    if (variant === 'held-input') {
      const variable = page.locator('.cm-content').and(page.getByLabel('Variables value 1', { exact: true }));
      const original = await variable.textContent();
      await variable.click();
      await page.keyboard.press('Control+Home');
      await page.keyboard.insertText('[');
      changed = '[' + original;
      same(await variable.textContent(), changed, 'Native invalid text appeared while retry GET waited');
    } else if (variant === 'new-load') {
      const otherId = await create('Other load during readback', 'Keep this unrelated UI');
      const other = await detail(otherId);
      await loopListLink(page).click();
      await waitRow(page, otherId, other.loop.name);
      await row(page, otherId).getByRole('link', { name: other.loop.name, exact: true }).click();
      await open(page, otherId, other.loop.name, false);
      changed = { id: otherId, before: await readUI(page, 'unrelated editor before GET release') };
    }
    let unexpected = null;
    if (variant !== 'healthy') {
      // Preserve the actual first incorrect POST, including its precise response and body.
      const wait = response(page, 'POST', post).then(async (r) => ({
        status: r.status(), body: await r.json(), path: new URL(r.url()).pathname,
      })).catch(() => null);
      const quiet = page.evaluate(() => new Promise((done) => setTimeout(() => done(null), 1200)));
      unexpected = Promise.race([wait, quiet]);
    }
    const delivery = await release(get);
    check(delivery.ok, 'Held live retry GET did not reach browser: ' + canon(delivery));
    if (variant === 'healthy') {
      const newPublication = await received(second, 200);
      same(newPublication.data.version.definition, newAcknowledged.draft.definition,
        'Healthy retry released the accepted full draft');
      check(newPublication.data.version.id !== initialVersion.id, 'Healthy retry made one distinct release');
      await storedRelease(id, newPublication.data.version);
      await storedRelease(id, initialVersion);
      checkpoints.push({ active, capturedRead, delivery, newPublication, observedPostCount: postings(id).length });
      same(postings(id).length, 2, 'Healthy genuinely unadmitted retry emitted exactly one extra POST');
      check(chronology.find((entry) => entry.seq > retryFrom && entry.type === 'browser response' &&
        entry.method === 'GET' && entry.path === path && entry.status === 200)?.seq < postings(id)[1].seq,
        'Healthy POST followed the delivered preflight response');
      outcomes.push({ active, capturedRead, newPublication });
      await page.screenshot({ path: 'after-readback-' + variant + '.png', animations: 'disabled' });
      return;
    }
    const unexpectedResponse = await unexpected;
    const after = await detail(id);
    const currentUI = await readUI(page, 'retry GET released after ' + variant);
    const previousImmutable = await storedRelease(id, initialVersion);
    const resultingImmutable = after.current?.id !== initialVersion.id ? await exactVersion(id, after.current.id) : null;
    checkpoints.push({ active, before, capturedRead, delivery, after, currentUI, changed, previousImmutable,
      resultingImmutable, unexpectedResponse, observedPostCount: postings(id).length });
    same(postings(id).length, 1, 'Retry sent a POST despite a newer load or held input');
    same(after, before, 'Abandoned retry changed the old release or accepted draft');
    await storedRelease(id, initialVersion);
    if (variant === 'held-input') {
      const variable = page.locator('.cm-content').and(page.getByLabel('Variables value 1', { exact: true }));
      same(await variable.textContent(), changed, 'Held Variables text survived blocked dispatch');
      await notice(page, 'heldInput');
    } else {
      same(currentUI.path, editPath(changed.id), 'Abandoned retry did not move off the new editor');
      same(currentUI.description, changed.before.description, 'Abandoned retry left new editor work intact');
      check(publicationNoticeAbsent(currentUI, initialVersion.version + 1) &&
        !currentUI.notices.some((entry) => has(entry.text, 'Publish failed') || has(entry.text, 'Publish not confirmed')),
      'Earlier attempt did not write its own notices in the new load');
    }
    outcomes.push({ active, capturedRead, currentUI, after });
    await page.screenshot({ path: 'after-readback-' + variant + '.png', animations: 'disabled' });
  }

  try {
    check(/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(origin) && !/:474[78]$/.test(origin), 'Refused browser origin');
    check(targetGroup === 'readback-integration', 'Only the scoped readback integration check is admitted');
    for (const variant of ['held-input', 'new-load', 'healthy']) {
      const firstBarrier = barriers.length, firstPage = addedPages.length;
      try {
        await retryReadbackFence(variant);
      } catch (error) {
        failures.push({ variant, active, error: String(error), stack: error.stack });
        await page.screenshot({ path: 'first-readback-' + variant + '.png', animations: 'disabled' }).catch(() => {});
      } finally {
        for (const lease of barriers.slice(firstBarrier)) await lease.detach();
        for (const tab of addedPages.slice(firstPage)) await tab.close().catch(() => {});
      }
    }
  } catch (error) {
    failures.push({ active, error: String(error), stack: error.stack });
  }
  return { suite: '237-readback-diagnostic', origin, mapping, scenario: targetGroup, browser: await page.evaluate(() => navigator.userAgent).catch(() => null),
    outcomes, chronology, checkpoints, pageErrors, failures };
}
