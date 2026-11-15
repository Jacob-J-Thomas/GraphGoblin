async (page) => {
  const url = new URL(page.url());
  const origin = url.origin;
  const targetGroup = url.searchParams.get('qa-group') || 'all';
  const mapping = '237-corrected-independent-v1';
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
  async function publishControl(target) {
    const control = target.getByRole('button', { name: /^(?:Publish|Publishing…)$/ });
    if (!(await control.count())) return { present:false };
    return control.evaluate((button)=>({
      present:true, visible:Boolean(button.getClientRects().length), disabled:button.disabled,
      ariaDisabled:button.getAttribute('aria-disabled'), ariaBusy:button.getAttribute('aria-busy'),
      title:button.title, label:button.textContent?.trim(),
    }));
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

  async function publication() {
    active = 'postcommit response, late local edits and old immutable pin';
    const id = await create('Publish ribbon', 'Initial description', 'original executable');
    const before = await detail(id);
    await open(page, id, before.loop.name);
    const heldReply = await barrier(page, { method: 'POST', path: pathFor(id) + '/publish',
      order: 'after', label: 'A1 HTTP response withheld after real commit' });
    await desc(page).fill('First acknowledged description');
    await publish(page).click();
    const { response: first } = await reached(page, heldReply);
    same(first.status, 200, 'Stored publication upstream status');
    const a1 = first.body.version;
    same(a1.definition.description, 'First acknowledged description', 'Exact revision came from flushed A1');
    await storedRelease(id, a1);
    const ackBeforePublish = saves(id).find((s) => s.body?.definition?.description === a1.definition.description);
    check(ackBeforePublish && ackBeforePublish.seq < postings(id)[0].seq, 'Flushed A1 precedes Publish');
    const storedA1WhileHeld = await detail(id);
    same(storedA1WhileHeld.current, a1, 'Current gateway version is exact A1 before reply');
    await desc(page).fill('Later unsaved author content');
    const localWhileHeld = await readUI(page, 'A2 while A1 response still held');
    same(localWhileHeld.description, 'Later unsaved author content', 'A2 is already authored');
    await requestCountAfterQuiet(page, () => saves(id), 1, 'A2 could not overtake held A1 reply');
    const a2DraftPath = pathFor(id) + '/draft';
    const nextSave = page.waitForResponse((reply) =>
      reply.request().method() === 'PUT' && new URL(reply.url()).pathname === a2DraftPath &&
      reply.request().postDataJSON()?.definition.description === 'Later unsaved author content', { timeout: 12500 });
    await release(heldReply);
    const laterNotice = await notice(page, 'laterWork', { version: a1.version });
    same(laterNotice.links, [], 'Release notice has no ambiguous loop-level run action');
    const a2 = await received(nextSave, 200);
    same(a2.request.definition, { ...a1.definition, description: 'Later unsaved author content' },
      'A2 posted as its own full draft');
    same(a2.ifMatch, quoted(storedA1WhileHeld.draftToken), 'A2 descends from acknowledged A1 content');
    same((await detail(id)).current, a1, 'A2 autosave did not alter exact A1');
    same((await detail(id)).draft.definition, a2.data.draft.definition, 'A2 stays in separate draft');
    await page.screenshot({ path: 'later-work-desktop.png', animations: 'disabled' });
    const a2PinSource = structuredClone(a2.data.draft.definition);
    findNode(a2PinSource, 'done').config.returns = '"newer executable"';
    await update(id, a2PinSource, a2.data.draftToken);
    const newerPublication = await freeze(id);
    check(newerPublication.id !== a1.id, 'Move the live pointer before pinning the old release');
    const oldPin = await awaitRun(id, a1.id, 'original executable');
    outcomes.push({ active, before, a1, localWhileHeld, laterNotice, a2, newerPublication, oldPin });

    active = 'request held before admission allows a same-row different definition';
    const m = await create('Same row witness', 'Acknowledged A', 'acknowledged executable');
    const ack = await detail(m);
    await open(page, m, ack.loop.name);
    const heldRequest = await barrier(page, { method: 'POST', path: pathFor(m) + '/publish',
      order: 'before', label: 'POST not dispatched to gateway' });
    const publishResponse = response(page, 'POST', pathFor(m) + '/publish');
    await publish(page).click();
    await reached(page, heldRequest);
    same(await detail(m), ack, 'No server publication before admission');
    const other = structuredClone(ack.draft.definition);
    // Keep name/description and row identity equal; change executable content deep in the graph.
    findNode(other, 'done').config.returns = '"different executable in an otherwise identical summary"';
    const altered = await update(m, other, ack.draftToken);
    same(altered.draft.id, ack.draft.id, 'Same mutable row was reused');
    same(altered.draft.version, ack.draft.version, 'Same draft version number');
    check(altered.draftToken !== ack.draftToken, 'Deep executable difference changed the token');
    await release(heldRequest);
    const returned = await received(publishResponse, 200);
    same(returned.data.version.definition, altered.draft.definition, 'POST publishes storage at admission');
    same(returned.data.version.id, ack.draft.id, 'The same draft row became the different release');
    await storedRelease(m, returned.data.version);
    const mismatch = await notice(page, 'mismatch', { version: returned.data.version.version });
    same(mismatch.links, [], 'Mismatch notice has no release-specific link');
    await page.setViewportSize({ width: 390, height: 900 });
    const narrow = await page.evaluate(() => ({ viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth }));
    check(narrow.documentWidth <= narrow.viewport, 'Mismatch notice page overflows at narrow width');
    await page.screenshot({ path: 'different-release-narrow.png', animations: 'disabled' });
    await page.setViewportSize({ width: 1280, height: 900 });
    const local = await laterUntil(page, async () => {
      const copy = await deviceCopy(page, m);
      return copy && !copy.synced ? copy : null;
    });
    same(local.definition, ack.draft.definition, 'Unpublished intended graph retained for recovery');
    await page.getByRole('button', { name: 'Reload server draft', exact: true }).waitFor(waitOptions);
    await page.getByRole('button', { name: 'Overwrite with this copy', exact: true }).waitFor(waitOptions);
    outcomes.push({ active, ack, altered, returned, mismatch, local, narrow });

    active = 'older publish response after a distinct newer publication and editor re-entry';
    const g = await create('Re-entry release', 'Generation one');
    const gBefore = await detail(g);
    await open(page, g, gBefore.loop.name);
    const late = await barrier(page, { method: 'POST', path: pathFor(g) + '/publish',
      order: 'after', label: 'generation one release acknowledgment withheld' });
    await publish(page).click();
    const held = (await reached(page, late)).response;
    same(held.status, 200, 'Generation one committed before navigation');
    const older = held.body.version;
    await loopListLink(page).click();
    await waitRow(page, g, gBefore.loop.name);
    const stored = await detail(g);
    await update(g, { ...older.definition, description: 'Newer independent release' }, stored.draftToken);
    const newer = await freeze(g);
    await row(page, g).getByRole('link', { name: gBefore.loop.name, exact: true }).click();
    await open(page, g, gBefore.loop.name, false);
    same(await desc(page).inputValue(), 'Newer independent release', 'New generation receives newer publication');
    const pendingBeforeEdit = await publishControl(page);
    const freshDescription = 'Current editor publish while the previous reply is still held';
    await desc(page).fill(freshDescription);
    const deviceWhileOldReplyHeld = await laterUntil(page,async()=>{
      const copy = await deviceCopy(page,g);
      return copy?.definition.description===freshDescription ? copy : null;
    });
    const currentDraft = await detail(g);
    const enabledBeforeRelease = await publishControl(page);
    let currentPublishWhileHeld = null;
    const canTry = enabledBeforeRelease.visible && enabledBeforeRelease.label === 'Publish' &&
      !enabledBeforeRelease.disabled && enabledBeforeRelease.ariaDisabled !== 'true' &&
      currentDraft.draft?.definition.description===freshDescription;
    if (canTry) {
      const [acknowledged] = await Promise.all([
        response(page,'POST',pathFor(g)+'/publish'),
        publish(page).click(),
      ]);
      currentPublishWhileHeld = await received(Promise.resolve(acknowledged),200);
      same(currentPublishWhileHeld.data.version.definition,currentDraft.draft.definition,
        'A new editor publication used its own acknowledged draft while the old response was withheld');
    }
    checkpoints.push({ active, pendingBeforeEdit, enabledBeforeRelease, currentPublishWhileHeld,
      deviceWhileOldReplyHeld,currentDraft });
    const delivery = await release(late);
    if (!currentPublishWhileHeld) await saved(page);
    const expectedCurrent = currentPublishWhileHeld?.data.version ?? newer;
    await page.getByText('published v' + expectedCurrent.version, { exact: true }).waitFor(waitOptions);
    const newUI = await readUI(page, 'new generation after older response release');
    const pendingAfterRelease = await publishControl(page);
    same(newUI.description, freshDescription, 'Older result did not replace newer content');
    check(publicationNoticeAbsent(newUI, older.version),
      'Old attempt feedback attached to the new load');
    same(await exactVersion(g, older.id), older, 'Old immutable release stays exact');
    same((await detail(g)).current, expectedCurrent, 'Older callback never rolled current pointer back');
    if (!currentPublishWhileHeld) {
      const afterQueue = await detail(g);
      same(afterQueue.draft.definition.description,freshDescription,'Queued generation save used its exact own draft');
      const [acknowledged] = await Promise.all([response(page,'POST',pathFor(g)+'/publish'),publish(page).click()]);
      const next = await received(acknowledged,200);
      same(next.data.version.definition,afterQueue.draft.definition,'Current generation publishes after its save is admitted');
      await storedRelease(g,next.data.version);
      currentPublishWhileHeld = {...next,onlyAfterOriginalRelease:true};
    }
    outcomes.push({ active, older, newer, newUI, pendingBeforeEdit, enabledBeforeRelease,
      pendingAfterRelease, currentPublishWhileHeld, delivery, deviceWhileOldReplyHeld, currentDraft });

    active = 'older success and newer current release in the same editor generation';
    const s = await create('Published since', 'Same editor stays open', 'First pin');
    const seed = await detail(s);
    await open(page, s, seed.loop.name);
    const oldest = await barrier(page, { method: 'POST', path: pathFor(s) + '/publish',
      order: 'after', label: 'older success in unchanged editor generation' });
    await publish(page).click();
    const firstCommitted = (await reached(page, oldest)).response.body.version;
    const latestBase = await detail(s);
    await update(s, { ...firstCommitted.definition, description: 'Current version from independent writer' }, latestBase.draftToken);
    const newest = await freeze(s);
    await release(oldest);
    const identityNotice = await notice(page, 'newerAnnouncement', { older: firstCommitted.version, newer: newest.version });
    same(identityNotice.links, [], 'Historical acknowledgment carries no ambiguous Run link');
    await page.getByText('published v' + newest.version, { exact: true }).waitFor(waitOptions);
    same((await detail(s)).current, newest, 'Current pointer follows the newest publication');
    await storedRelease(s, firstCommitted);
    await storedRelease(s, newest);
    outcomes.push({ active, firstCommitted, newest, identityNotice });
  }

  async function transport() {
    active = 'committed response lost and reconciling read unavailable before retry';
    const id = await create('Recovery ribbon', 'Only one committed release');
    const initial = await detail(id);
    await open(page, id, initial.loop.name);
    const lost = await barrier(page, { method: 'POST', path: pathFor(id) + '/publish',
      order: 'after', label: 'drop reply after real commit', drop: true });
    await publish(page).click();
    const confirmed = (await reached(page, lost)).response;
    same(confirmed.status, 200, 'Upstream publish success');
    const immutable = confirmed.body.version;
    same(await exactVersion(id, immutable.id), immutable, 'Version committed before observer loss');
    const blockedReads = [];
    const block = async (route) => {
      if (route.request().method() !== 'GET') { await route.fallback(); return; }
      blockedReads.push(note('faulted readback', { path: pathFor(id) }));
      await route.abort('failed');
    };
    await page.route(origin + pathFor(id), block);
    await release(lost);
    const unknown = await notice(page, 'unknown', { version: immutable.version });
    check(blockedReads.length > 0, 'UI never attempted fresh readback after unknown transport');
    await requestCountAfterQuiet(page, () => postings(id), 1, 'Unknown outcome triggered a blind retry');
    same((await versions(id)).items.filter((item) => item.status === 'published').map((item) => item.id),
      [immutable.id], 'Failed readback created an extra publication');
    const blockedRetryFrom = seq;
    await publish(page).click();
    const stillUnknown = await notice(page, 'unknown', { preSend: true });
    check(blockedReads.some((entry) => entry.seq > blockedRetryFrom), 'Explicit retry did not first issue a fresh GET');
    same(postings(id).length, 1, 'A failing pre-send readback still admitted a POST');
    await page.unroute(origin + pathFor(id), block);
    const retryFrom = seq;
    await publish(page).click();
    const settled = await notice(page, 'alreadyStored', { version: immutable.version });
    const history = (await versions(id)).items;
    same(history.filter((item) => item.status === 'published'), [immutable], 'Matching readback avoids duplicate publish');
    const ordered = chronology.filter((x) => x.seq > retryFrom && x.tag === 'primary' &&
      x.type === 'browser request' && [pathFor(id), pathFor(id) + '/publish'].includes(x.path));
    check(ordered[0]?.method === 'GET', 'Recovery attempt must read before any second POST');
    same(postings(id).length, 1, 'Matching committed version should settle without a second POST');
    outcomes.push({ active, immutable, unknown, stillUnknown, settled, ordered, history });

    active = 'canonical clean load and competing publication with no draft';
    const otherId = await create('Competing release', 'Clean canonical setup');
    const old = await detail(otherId);
    await open(page, otherId, old.loop.name);
    const admission = await barrier(page, { method: 'POST', path: pathFor(otherId) + '/publish',
      order: 'before', label: 'competing publisher wins before this request' });
    const noDraftReply = response(page, 'POST', pathFor(otherId) + '/publish');
    await publish(page).click();
    await reached(page, admission);
    const changed = structuredClone(old.draft.definition);
    findNode(changed, 'done').config.returns = '"competing"';
    await update(otherId, changed, old.draftToken);
    const published = await freeze(otherId);
    await release(admission);
    const refused = await received(noDraftReply, 409, 'NO_DRAFT');
    const mismatch = await notice(page, 'mismatch', { version: published.version, competing: true });
    const local = await laterUntil(page, async () => (await deviceCopy(page, otherId))?.synced === false
      ? deviceCopy(page, otherId) : null);
    same(local.definition, old.draft.definition, 'Competing no-draft preserved the attempted draft');
    same((await detail(otherId)).current, published, 'Competing current version preserved');
    same(await storedRelease(otherId, published), published, 'Competing release has immutable identity');

    const cleanTab = await attachPage('canonical clean load');
    await open(cleanTab, id, initial.loop.name);
    const noOpFrom = seq;
    await publish(cleanTab).click();
    const clean = await notice(cleanTab, 'alreadyStored', { version: immutable.version });
    same((await versions(id)).items.filter((item) => item.status === 'published'), [immutable],
      'Clean-load no-op preserved exact version');
    const cleanRequests = chronology.filter((x) => x.seq > noOpFrom && x.type === 'browser request');
    check(!cleanRequests.some((x) => x.method === 'PUT' && x.path === pathFor(id) + '/draft'),
      'Clean load issued a replacement draft save');
    outcomes.push({ active, refused, published, mismatch, local, clean, cleanRequests });
    for (const variant of ['held-input', 'new-load', 'healthy']) {
      try { await retryReadbackFence(variant); }
      catch (error) {
        failures.push({ category: 'transport-readback', active, error: String(error), stack: error.stack });
        await page.screenshot({ path: 'first-retry-readback-' + variant + '.png', animations: 'disabled' }).catch(() => {});
        // Each variant uses a distinct target loop; release its own handlers before proceeding.
      } finally {
        for (const lease of barriers.filter((item) => item.label.includes('retry readback ' + variant))) await lease.detach();
      }
    }
  }

  async function retryReadbackFence(variant) {
    active = 'unknown retry readback in queue / ' + variant;
    const id = await create('Retry fence ' + variant, 'An earlier immutable release', 'old pin');
    const initialVersion = await freeze(id);
    const base = await detail(id);
    const newDraft = structuredClone(initialVersion.definition);
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
      changed = { id: otherId, before: await readUI(page, 'unrelated editor before GET release'),
        oldGetHeldPublishControl: await publishControl(page) };
    }
    const delivery = await release(get);
    if (variant === 'healthy') {
      const newPublication = await received(second, 200);
      same(newPublication.data.version.definition, newAcknowledged.draft.definition,
        'Healthy retry released the accepted full draft');
      check(newPublication.data.version.id !== initialVersion.id, 'Healthy retry made one distinct release');
      await storedRelease(id, newPublication.data.version);
      await storedRelease(id, initialVersion);
      checkpoints.push({ active, capturedRead, delivery, newPublication, observedPostCount: postings(id).length });
      same(postings(id).length, 2, 'Healthy genuinely unadmitted retry emitted exactly one extra POST');
      outcomes.push({ active, capturedRead, newPublication });
      return;
    }
    await page.evaluate(() => new Promise((done) => setTimeout(done, 1000)));
    const after = await detail(id);
    const currentUI = await readUI(page, 'retry GET released after ' + variant);
    checkpoints.push({ active, capturedRead, delivery, after, currentUI, changed,
      afterReleasedPublishControl: await publishControl(page), observedPostCount: postings(id).length });
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
  }

  async function listRace(warm) {
    active = (warm ? 'warm list / pending save on unmount' : 'cold list / active save before navigation');
    const id = await create('Summary target', 'Description to remove');
    const control = await create('Summary control', 'Unchanged description', 'control pin');
    const targetPin = await freeze(id);
    const controlPin = await freeze(control);
    const ownRun = await awaitRun(id, targetPin.id, 'seed release');
    const controlRun = await awaitRun(control, controlPin.id, 'control pin');
    const priorList = await summaries();
    const original = summary(priorList, id);
    const untouched = summary(priorList, control);
    const target = await attachPage(warm ? 'warm Loops surface' : 'cold Loops surface');
    if (warm) {
      await target.goto(origin + '/app/loops');
      await waitRow(target, id, original.name);
      await row(target, id).getByRole('link', { name: original.name, exact: true }).click();
    }
    await open(target, id, original.name, !warm);
    const put = await barrier(target, { method: 'PUT', path: pathFor(id) + '/draft', order: 'before',
      label: active + ' request not admitted yet' });
    const staleList = await barrier(target, { method: 'GET', path: '/loops', order: 'after',
      label: active + ' precommit list snapshot' });
    const newName = 'Summary reconciled ' + (warm ? 'warm ' : 'cold ') + suffix;
    await desc(target).fill('');
    await nameBox(target).fill(newName);
    if (!warm) await reached(target, put);
    await loopListLink(target).click();
    const held = await reached(target, put);
    const oldRead = await reached(target, staleList);
    same(summary(oldRead.response.body, id), original, 'First list HTTP snapshot predates save');
    same(held.reqInfo.data.definition.name, newName, 'Leaving or active PUT contains new summary');
    same((await detail(id)).loop.name, original.name, 'PUT still unadmitted at observation');
    const committed = response(target, 'PUT', pathFor(id) + '/draft');
    await release(put);
    const accepted = await received(committed, 200);
    const acceptedEvent = note('observed accepted PUT', { path: pathFor(id) + '/draft' });
    // The response listener was registered before scenario start, so causality can be compared
    // with the original HTTP request/response sequence rather than this evidence consumer tick.
    const ackRow = chronology.find((x) => x.type === 'browser response' && x.method === 'PUT'
      && x.path === pathFor(id) + '/draft' && x.status === 200);
    check(ackRow, 'Missing network acknowledgment entry');
    const visible = await waitRow(target, id, newName);
    check((await visible.getByText('Description to remove', { exact: true }).count()) === 0,
      'A legitimate removal left the old description');
    const refreshed = chronology.find((x) => x.type === 'browser request' && x.method === 'GET'
      && x.path === '/loops' && x.seq > ackRow.seq && x.tag === ackRow.tag);
    check(refreshed, 'List never requested a causally later snapshot');
    check(refreshed.wallMs - ackRow.wallMs < 5000, 'Reconciliation depended on the stock five-second poll');
    const staleResult = await release(staleList);
    await requestCountAfterQuiet(target, () => saves(id), 1, 'One actual draft write for the held edits');
    await waitRow(target, id, newName);
    same(await target.getByRole('link', { name: original.name, exact: true }).count(), 0,
      'Old held list snapshot installed after refresh');
    const latest = await summaries();
    const changed = summary(latest, id);
    same(changed.name, newName, 'Public list agrees with visible row');
    check(changed.description === undefined || changed.description === '', 'Stored description was not removed');
    same(changed.latestRun, original.latestRun, 'Target run summary was not reconstructed incorrectly');
    same(changed.runCount, original.runCount, 'Target run count preserved');
    same(summary(latest, control), untouched, 'Other-loop metadata preserved');
    check((await row(target, id).locator('a[href="/app/runs/' + ownRun.id + '"]').count()) === 1, 'Existing run link was lost');
    check((await row(target, control).locator('a[href="/app/runs/' + controlRun.id + '"]').count()) === 1,
      'Unrelated run link was lost');
    const visibleOrder = await target.locator('tr a[href$="/edit"]').evaluateAll((links) =>
      links.map((link) => link.getAttribute('href')));
    const expectedOrder = latest.items.filter((item) => [id, control].includes(item.id)).map((item) => editPath(item.id));
    same(visibleOrder.filter((href) => expectedOrder.includes(href)), expectedOrder, 'Rendered sort follows server');
    outcomes.push({ active, original, untouched, ackRow, refreshed, acceptedEvent, accepted, staleResult, changed, visibleOrder });
  }

  async function list() {
    await listRace(false);
    await listRace(true);
    active = 'same-loop detail read crosses a leaving save';
    const id = await create('Re-entry detail', 'Previously published description');
    const prior = await freeze(id);
    const base = await detail(id);
    await open(page, id, base.loop.name);
    const editingPath = pathFor(id);
    const leaving = await barrier(page, { method: 'PUT', path: editingPath + '/draft',
      order: 'before', label: 'leaving save before gateway admission' });
    await desc(page).fill('Persisted on leaving');
    await loopListLink(page).click();
    await reached(page, leaving);
    await waitRow(page, id, base.loop.name);
    const oldDetail = await barrier(page, { method: 'GET', path: editingPath,
      order: 'after', label: 're-entry detail captured before leaving save commits' });
    await row(page,id).getByRole('link', { name: base.loop.name, exact: true }).click();
    const held = (await reached(page, oldDetail)).response;
    same(held.body.draftToken, base.draftToken, 'Held detail reflects previously acknowledged state');
    check(held.body.draft === undefined, 'Old detail does not know the leaving draft');
    const ack = response(page, 'PUT', editingPath + '/draft');
    await release(leaving);
    const accepted = await received(ack, 200);
    const staleRead = await release(oldDetail);
    await open(page, id, base.loop.name, false);
    await saved(page);
    same(await desc(page).inputValue(), 'Persisted on leaving', 'Stale detail suppressed the saved re-entry content');
    check(!(await page.getByRole('button', { name: 'Reload server draft', exact: true }).isVisible()),
      'Normal re-entry reported a spurious different-writer conflict');
    const persisted = await detail(id);
    same(persisted.current, prior, 'Leaving save altered immutable current');
    same(persisted.draft, accepted.data.draft, 'Re-entry current draft');
    const synced = await laterUntil(page, async () => {
      const copy = await deviceCopy(page, id);
      return copy?.synced && copy.baseToken === accepted.data.draftToken ? copy : null;
    });
    same(synced.definition, persisted.draft.definition, 'Re-entry preserves the acknowledged token and definition');
    outcomes.push({ active, held, accepted, staleRead, persisted, synced });
  }

  async function ancestry() {
    active = 'same-loop re-entry must not lend its token to the leaving generation';
    const id = await create('Token ancestry', 'Original token root');
    const initial = await detail(id);
    await open(page, id, initial.loop.name);
    const p = pathFor(id) + '/draft';
    const lead = await barrier(page, { method: 'PUT', path: p, order: 'before',
      label: 'old generation first save' });
    await desc(page).fill('A1 in flight');
    const started = await reached(page, lead);
    same(started.reqInfo.ifMatch, quoted(initial.draftToken), 'Old generation first PUT carries old token');
    await desc(page).fill('A2 local before leaving');
    const beforeLeave = await laterUntil(page, async () => {
      const copy = await deviceCopy(page, id);
      return copy?.definition.description === 'A2 local before leaving' ? copy : null;
    });
    await loopListLink(page).click();
    const elsewhere = await update(id, { ...initial.draft.definition, description: 'Independent description B' },
      initial.draftToken);
    await waitRow(page, id, initial.loop.name);
    await row(page, id).getByRole('link', { name: initial.loop.name, exact: true }).click();
    await open(page, id, initial.loop.name, false);
    // The new load can require explicit server selection; do not grant an overwrite.
    const reload = page.getByRole('button', { name: 'Reload server draft', exact: true });
    if (await reload.isVisible()) await reload.click();
    await laterUntil(page, async () => await desc(page).inputValue() === 'Independent description B');
    const firstRefused = response(page, 'PUT', p);
    await release(lead);
    const refused = await received(firstRefused, 409, 'DRAFT_CONFLICT');
    same(refused.data.draftToken, elsewhere.draftToken, 'Gateway reports real current base');
    await page.evaluate(() => new Promise((done) => setTimeout(done, 1000)));
    const staleSends = saves(id).filter((x) => x.body?.definition?.description === 'A2 local before leaving');
    check(staleSends.every((x) => x.ifMatch === quoted(initial.draftToken)),
      'Leaving generation borrowed the unrelated accepted token');
    same((await detail(id)).draft.definition, elsewhere.draft.definition, 'Old work changed independently accepted server draft');
    const newUi = await readUI(page, 'fresh editor after old generation save settlement');
    same(newUi.description, elsewhere.draft.definition.description, 'Late save rewrote the new editor UI');
    const preserved = await laterUntil(page, async () => {
      for (const key of [id, id + ':set-aside']) {
        const copy = await deviceCopy(page, key);
        if (copy?.definition.description === 'A2 local before leaving') return copy;
      }
      return null;
    });
    same(preserved.definition, beforeLeave.definition, 'Prior authored copy survived independent new load');
    same(preserved.synced, false, 'Old authored work remains an unsynced device copy');
    outcomes.push({ active, initial, beforeLeave, elsewhere, refused, staleSends, newUi, preserved });

    active = 'held invalid text arrives during an actual queued flush';
    const heldId = await create('Hold during flush', 'Submitted description before held input');
    const base = await detail(heldId);
    await open(page, heldId, base.loop.name);
    const draft = pathFor(heldId) + '/draft';
    const network = await barrier(page, { method: 'PUT', path: draft, order: 'after',
      label: 'accepted draft, flush waits on HTTP acknowledgment' });
    await desc(page).fill('Description accepted independently of invalid text');
    const stored = await reached(page, network);
    same(stored.response.status, 200, 'Real held acknowledgment existed');
    const beforePosts = postings(heldId).length;
    await publish(page).click();
    const variable = page.locator('.cm-content').and(page.getByLabel('Variables value 1', { exact: true }));
    const valid = await variable.textContent();
    await variable.click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.insertText('[');
    const held = '[' + valid;
    same(await variable.textContent(), held, 'Native editor holds invalid JSON');
    const pre = await detail(heldId);
    same(pre.draft.definition.variables, base.draft.definition.variables, 'Invalid input has no normalized draft mutation');
    await release(network);
    const interrupted = await notice(page, 'heldInput');
    await requestCountAfterQuiet(page, () => postings(heldId), beforePosts, 'Held input admitted a publish');
    same(await variable.textContent(), held, 'Held input discarded during refusal');
    same((await detail(heldId)).current, undefined, 'Held input unexpectedly published');
    const beforeFix = await readUI(page, 'held input refusal reached');
    await variable.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText(valid);
    const recovered = response(page, 'POST', pathFor(heldId) + '/publish');
    await publish(page).click();
    const published = await received(recovered, 200);
    same(await exactVersion(heldId, published.data.version.id), published.data.version, 'User corrected input and explicitly published');
    outcomes.push({ active, stored, pre, interrupted, beforeFix, published });
  }

  async function refusals() {
    active = 'name and conditional-save refusals never admit publication or refused summaries';
    const holder = await create('Occupied note', 'Holder should stay stable');
    const id = await create('Refusal subject', 'Original accepted state');
    const occupied = (await detail(holder)).loop.name;
    const before = await detail(id);
    await open(page, id, before.loop.name);
    const denied = response(page, 'PUT', pathFor(id) + '/draft');
    await nameBox(page).fill(occupied.toUpperCase().replaceAll(' ', '\u00a0  '));
    await publish(page).click();
    const nameConflict = await received(denied, 409, 'LOOP_NAME_CONFLICT');
    await notice(page, 'refusal', { code: 'LOOP_NAME_CONFLICT' });
    await requestCountAfterQuiet(page, () => postings(id), 0, 'Name refusal bypassed flush barrier');
    same(await detail(id), before, 'Name refusal changed durable row');
    await loopListLink(page).click();
    await waitRow(page, id, before.loop.name);
    same(summary(await summaries(), id).name, before.loop.name, 'Refused name entered accepted list');
    same(summary(await summaries(), holder).name, occupied, 'Original holder unchanged');

    const staleId = await create('Guard stale publish', 'Original base');
    const stale = await detail(staleId);
    await open(page, staleId, stale.loop.name);
    const current = await update(staleId, { ...stale.draft.definition, description: 'Accepted independent state' }, stale.draftToken);
    const failed = response(page, 'PUT', pathFor(staleId) + '/draft');
    await desc(page).fill('Unaccepted old-editor edit');
    await publish(page).click();
    const conflict = await received(failed, 409, 'DRAFT_CONFLICT');
    await notice(page, 'refusal', { code: 'DRAFT_CONFLICT' });
    await requestCountAfterQuiet(page, () => postings(staleId), 0, 'Draft conflict bypassed flush barrier');
    same((await detail(staleId)).draft.definition, current.draft.definition, 'Stale publish changed accepted draft');
    outcomes.push({ active, nameConflict, conflict, current });

    active = 'a refused flushing save cannot advance release or list';
    const offlineId = await create('Guard failed flush', 'Accepted name and description remain');
    const offlineBefore = await detail(offlineId);
    await open(page, offlineId, offlineBefore.loop.name);
    const reject = await barrier(page, { method: 'PUT', path: pathFor(offlineId) + '/draft',
      order: 'before', label: 'failed draft request before gateway admission', drop: true });
    await desc(page).fill('Device work during network failure');
    await publish(page).click();
    await reached(page, reject);
    await release(reject);
    const errorUI = await notice(page, 'refusal', { code: 'SAVE_TRANSPORT' });
    await requestCountAfterQuiet(page, () => postings(offlineId), 0, 'Failed flush admitted Publish');
    same(await detail(offlineId), offlineBefore, 'Failed flush altered server draft');
    const pending = await laterUntil(page, async () => {
      const stored = await deviceCopy(page, offlineId);
      return stored?.definition.description === 'Device work during network failure' ? stored : null;
    });
    same(pending.synced, false, 'Rejected save was presented as synchronized');
    outcomes.push({ active, errorUI, pending });

    active = 'known #273 reference fails as its own real publication refusal';
    const brokenId = await create('Guard invalid reference', 'Keeps previous release');
    const pub = await freeze(brokenId);
    const clean = await detail(brokenId);
    const bad = structuredClone(pub.definition);
    findNode(bad, 'done').config.returns = 'gates.absent.passes';
    const faulty = await update(brokenId, bad, clean.draftToken);
    await open(page, brokenId, clean.loop.name);
    const refused = response(page, 'POST', pathFor(brokenId) + '/publish');
    await publish(page).click();
    const issue = await received(refused, 422, 'LOOP_INVALID');
    check(issue.data.errors.some((d) => d.code === 'NODE_REFERENCE_MISSING' && d.nodeId === 'done'),
      'Known reference refusal lacked its original diagnostic');
    await notice(page, 'refusal', { code: 'LOOP_INVALID' });
    const after = await detail(brokenId);
    same(after.current, pub, '422 altered the published version');
    same(after.draft, faulty.draft, '422 lost a repairable draft');
    same(after.draftToken, faulty.draftToken, '422 altered the conditional save token');
    outcomes.push({ active, issue, after });
  }

  async function observeSameEditorPending() {
    active = 'public same-mounted generation after restoring a real device draft';
    const id = await create('Pending generation witness','Initial accepted draft');
    const initial = await detail(id);
    await open(page,id,initial.loop.name);
    // Create a real unsynced copy by withholding its one normal draft request. No injected storage.
    const leavePath = pathFor(id)+'/draft';
    const blocked = async (route) => {
      if (route.request().method()==='PUT') {
        note('device seed write not admitted',{path:leavePath});
        await route.abort('failed');
      } else await route.fallback();
    };
    await page.route(origin+leavePath,blocked);
    const deviceDescription = 'Device draft retained before a later server version';
    try {
      await desc(page).fill(deviceDescription);
      await laterUntil(page,async()=>{
        const copy = await deviceCopy(page,id);
        return copy?.definition.description===deviceDescription && !copy.synced ? copy : null;
      });
      await loopListLink(page).click();
      await waitRow(page,id,initial.loop.name);
      await laterUntil(page,async()=>chronology.some((row)=>row.type==='device seed write not admitted') || null);
    } finally {
      await page.unroute(origin+leavePath,blocked).catch(()=>{});
    }
    const onServer = await update(id,{...initial.draft.definition,description:'Newer server graph'},initial.draftToken);
    await row(page,id).getByRole('link',{name:initial.loop.name,exact:true}).click();
    await open(page,id,initial.loop.name,false);
    const restore = page.getByRole('button',{name:'Use this device’s copy instead',exact:true})
      .or(page.getByRole('button',{name:"Use this device's copy instead",exact:true}));
    const reachable = await restore.waitFor({...waitOptions,timeout:5000}).then(()=>true,()=>false);
    if (!reachable) {
      outcomes.push({active,reachability:'set-aside recovery action absent',ui:await readUI(page,'No public recovery action')});
      return;
    }
    same(await desc(page).inputValue(),'Newer server graph','Old device draft is genuinely set aside');
    const first = await barrier(page,{method:'POST',path:pathFor(id)+'/publish',
      order:'after',label:'publication reply held while set-aside recovery reloads the same editor'});
    await publish(page).click();
    const committed = (await reached(page,first)).response;
    same(committed.status,200,'Original request already committed before its reply barrier');
    same(committed.body.version.definition,onServer.draft.definition,'Old load committed the accepted server draft');
    await restore.click();
    await page.waitForFunction((text)=>document.querySelector('#loop-description')?.value===text,
      deviceDescription,waitOptions);
    const pendingAfterRecovery = await publishControl(page);
    const during = await readUI(page,'Restored device generation while old reply stays held');
    // A per-loop publish may intentionally hold the draft queue. A new generation that has not yet
    // sent or acknowledged its save is observational only and cannot prove an independent block.
    const acceptedDuring = await detail(id);
    const canTry = pendingAfterRecovery.present && pendingAfterRecovery.visible &&
      pendingAfterRecovery.label==='Publish' && !pendingAfterRecovery.disabled &&
      pendingAfterRecovery.ariaDisabled!=='true' &&
      acceptedDuring.draft?.definition.description===deviceDescription;
    let currentRelease = null;
    if (canTry) {
      const [reply] = await Promise.all([response(page,'POST',pathFor(id)+'/publish'),publish(page).click()]);
      currentRelease = await received(reply,200);
      same(currentRelease.data.version.definition,acceptedDuring.draft.definition,
        'Fresh explicit publish used only the new generation’s acknowledged draft');
    }
    await release(first);
    await storedRelease(id,committed.body.version);
    if (currentRelease) await storedRelease(id,currentRelease.data.version);
    if (!currentRelease) {
      await saved(page);
      const acceptedAfterRelease = await detail(id);
      same(acceptedAfterRelease.draft.definition.description,deviceDescription,
        'Restored generation eventually saved its exact graph');
      const [reply] = await Promise.all([response(page,'POST',pathFor(id)+'/publish'),publish(page).click()]);
      const publication = await received(reply,200);
      same(publication.data.version.definition,acceptedAfterRelease.draft.definition,
        'Pending-state control verifies the restored publication can complete after queue release');
      await storedRelease(id,publication.data.version);
      currentRelease = {...publication,onlyAfterOriginalRelease:true};
    }
    const after = await readUI(page,'Restored device generation after old reply');
    same(after.description,deviceDescription,'Older reply overwrote restored graph');
    const afterControl = await publishControl(page);
    check(publicationNoticeAbsent(after,committed.body.version.version),'Older reply attached feedback to the restored generation');
    outcomes.push({active,reachability:'public device recovery changed this editor load',
      during,pendingAfterRecovery,acceptedDuring,currentRelease,after,afterControl,
      caveat:canTry ? null : 'Observe disabled/busy and accepted state together. An unacknowledged draft may still wait on the authorized loop queue.'});
  }

  try {
    check(/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(origin) && !/:474[78]$/.test(origin), 'Refused browser origin');
    check(targetGroup === 'all' || targetGroup === 'same-editor-pending' || groups.includes(targetGroup), 'Unknown scenario group');
    check(url.searchParams.get('qa-profile') === mapping,'Bind the frozen notice profile before execution');
    const pid = url.searchParams.get('qa-pid');
    check(/^[1-9][0-9]*$/.test(pid??''),'Pass the known PID of the disposable gateway');
    const health = await page.request.get(origin+'/healthz',{timeout:5000});
    same(health.status(),200,'Gateway health');
    same(health.headers()['x-graphgoblin-pid'],pid,'Refused different or unowned gateway');
    check(Object.values(noticeSelectors).every((entry) => typeof entry === 'function'),
      'Bind the final rendered notice selectors before running this driver.');
    const cases = { publication, transport, list, ancestry, refusals, 'same-editor-pending':observeSameEditorPending };
    const selected = targetGroup === 'all' ? groups : [targetGroup];
    for (const category of selected) {
      const firstBarrier = barriers.length, firstPage = addedPages.length;
      try {
        await cases[category]();
      } catch (error) {
        failures.push({ category, active, error: String(error), stack: error.stack });
        await page.screenshot({ path: 'first-' + category + '.png', animations: 'disabled' }).catch(() => {});
      } finally {
        for (const lease of barriers.slice(firstBarrier)) await lease.detach();
        for (const tab of addedPages.slice(firstPage)) await tab.close().catch(() => {});
      }
    }
  } catch (error) {
    failures.push({ active, error: String(error), stack: error.stack });
  }
  return { origin, mapping, scenario: targetGroup, browser: await page.evaluate(() => navigator.userAgent).catch(() => null),
    outcomes, chronology, checkpoints, pageErrors, failures };
}
