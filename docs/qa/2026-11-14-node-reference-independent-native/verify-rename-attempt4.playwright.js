async (page) => {
  const origin = new URL(page.url()).origin;
  const chatOnly = new URL(page.url()).searchParams.get('qa-scenario') === 'chat-only';
  const suffix = crypto.randomUUID().slice(0, 8);
  const outcomes = [];
  const writes = [];
  const setupResponses = [];
  const checkpoints = [];
  const pageErrors = [];
  const pages = [];
  const outstandingResponses = [];
  let active = 'fixture setup';

  function check(condition, explanation) {
    if (!condition) throw new Error(explanation);
  }
  const canon = (data) => JSON.stringify(data, (_, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
      : item);
  function equal(actual, expected, explanation) {
    check(canon(actual) === canon(expected), explanation + '\nExpected ' + canon(expected) + '\nActual ' + canon(actual));
  }
  const jsonataField = (scope, path) => scope.locator('[data-field="' + path + '"] .cm-content');
  const nodeInfo = (definition, id) => definition.nodes.find((node) => node.id === id);
  const uiCard = (target, id) => target.locator('.react-flow__node[data-id="' + id + '"]');
  const neat = (data) => JSON.parse(JSON.stringify(data));
  const route = (id) => '/loops/' + id;
  const conditional = (token) => ({ 'if-match': '"' + token + '"' });

  function bind(target, name) {
    target.on('pageerror', (err) => pageErrors.push({ name, error: String(err) }));
    target.on('request', (req) => {
      const { pathname } = new URL(req.url());
      if (/^\/chat\/conversations\/[^/]+\/turns$/.test(pathname)) {
        writes.push({ name, path: pathname, unexpectedChatTurn: true });
      }
      if (!['POST', 'PUT'].includes(req.method()) ||
          !/^\/loops\/[^/]+\/(?:draft|publish)$/.test(pathname)) return;
      const match = {
        name,
        path: pathname,
        method: req.method(),
        body: req.postData() === null ? null : req.postDataJSON(),
        ifMatch: req.headers()['if-match'] ?? null,
        observedAt: new Date().toISOString(),
      };
      writes.push(match);
      const pending = req.response().then(async (response) => {
        if (!response) return;
        match.status = response.status();
        match.response = await response.json();
      }).catch(() => {});
      outstandingResponses.push(pending);
    });
  }
  bind(page, 'primary');

  async function api(method, path, status, body, headers) {
    const reply = await page.request.fetch(origin + path, {
      method, headers, timeout: 12000, ...(body === undefined ? {} : { data: body }),
    });
    const json = await reply.json();
    const record = { method, path, status: reply.status(), ...(body === undefined ? {} : { body }), json };
    if (method !== 'GET' || reply.status() !== status) setupResponses.push(record);
    equal(reply.status(), status, method + ' ' + path + ' ' + canon(json));
    return json;
  }
  const readLoop = (id) => api('GET', route(id), 200);
  function awaitResponse(target, method, path) {
    return target.waitForResponse((r) =>
      r.request().method() === method && new URL(r.url()).pathname === path, { timeout: 15000 });
  }
  async function captured(pending, status, code) {
    const r = await pending;
    const req = r.request();
    const body = await r.json();
    equal(r.status(), status, 'Expected browser ' + req.method() + ' ' + new URL(req.url()).pathname);
    if (code) equal(body.code, code, 'Expected problem code');
    return { status, body, request: req.postData() === null ? null : req.postDataJSON(),
      ifMatch: req.headers()['if-match'] ?? null };
  }

  async function focus(locator) {
    const handle = await locator.elementHandle({ timeout: 4000 });
    await page.waitForFunction((element) => document.activeElement === element, handle, { timeout: 4000 });
    await handle.dispose();
  }
  async function value(locator, expected) {
    await locator.waitFor({ timeout: 4500 });
    equal(await locator.inputValue(), expected, 'Field value');
  }
  async function text(locator, expected) {
    await locator.waitFor({ timeout: 4500 });
    equal(await locator.textContent(), expected, 'Document text');
  }
  async function expectSaved(target) {
    await target.waitForFunction(() =>
      document.querySelector('[data-testid="save-state"]')?.textContent === 'All changes saved', null, { timeout: 8000 });
  }
  async function openEditor(target, id, name) {
    await target.bringToFront();
    await target.goto(origin + '/app' + route(id) + '/edit');
    await target.getByRole('heading', { name, exact: true }).waitFor({ timeout: 8000 });
    await target.getByText('The editor is available. Checking the server and this device before saving changes.', { exact: true })
      .waitFor({ state: 'hidden', timeout: 8000 });
  }
  async function settings(target) {
    const expand = target.getByRole('button', { name: /^(Show|Hide) loop settings$/ });
    await expand.waitFor();
    if (await expand.getAttribute('aria-expanded') === 'false') await expand.click();
  }
  async function openNode(target, id, kind) {
    await target.getByTestId('node-' + id).locator(':scope > div:has([data-kind])').click({ timeout: 6000 });
    const d = target.getByRole('dialog', { name: 'Edit ' + kind + ' ' + id, exact: true });
    await d.waitFor({ timeout: 5000 });
    return d;
  }
  async function closeNode(d) {
    await d.getByRole('button', { name: 'Done', exact: true }).click();
    await d.waitFor({ state: 'hidden', timeout: 5000 });
  }
  async function replaceDocument(target, locator, content) {
    await locator.click();
    await target.keyboard.press('ControlOrMeta+A');
    await target.keyboard.insertText(content);
  }
  const renameNotice = (scope, from, to) =>
    scope.getByRole('status').filter({ hasText: 'Renamed ' + from + ' to ' + to });

  async function readDevice(target, loopId, token, synced) {
    const reader = await target.waitForFunction(async ({ loopId, token, synced }) => {
      const copy = await new Promise((done) => {
        const opened = indexedDB.open('graphgoblin');
        opened.onupgradeneeded = () => opened.transaction.abort();
        opened.onerror = () => done(null);
        opened.onsuccess = () => {
          const db = opened.result;
          try {
            const req = db.transaction('drafts').objectStore('drafts').get(loopId);
            req.onsuccess = () => { db.close(); done(req.result ?? null); };
            req.onerror = () => { db.close(); done(null); };
          } catch { db.close(); done(null); }
        };
      });
      return copy?.baseToken === token && copy.synced === synced && copy;
    }, { loopId, token, synced }, { timeout: 7000, polling: 100 });
    const copy = await reader.jsonValue();
    await reader.dispose();
    return copy;
  }

  async function snapshotDevice(target, loopId) {
    return target.evaluate((id) => new Promise((done) => {
      const opened = indexedDB.open('graphgoblin');
      opened.onupgradeneeded = () => opened.transaction.abort();
      opened.onerror = () => done(null);
      opened.onsuccess = () => {
        const db = opened.result;
        try {
          const req = db.transaction('drafts').objectStore('drafts').get(id);
          req.onsuccess = () => { db.close(); done(req.result ?? null); };
          req.onerror = () => { db.close(); done(null); };
        } catch { db.close(); done(null); }
      };
    }), loopId);
  }

  function fixture(name) {
    const node = (id, kind, label, x, y, config) => ({ id, kind, label, ui: { x, y }, config });
    const edge = (id, from, port, to) => ({ id, from: { node: from, port }, to: { node: to, port: 'in' } });
    return {
      schemaVersion: 4,
      name,
      description: 'The old gate stays here as prose.',
      variables: { key: { type: 'string' } },
      nodes: [
        node('start', 'trigger', 'Manual start', 0, 120, { type: 'manual' }),
        node('gate', 'decision', 'The gate label remains', 300, 120, {
          kind: 'expression',
          jsonata: 'counters.nodeVisits.gate < 2 ? "again" : "finish"',
          routes: [{ id: 'again', label: 'Again', repeat: true }, { id: 'finish', label: 'Finish' }],
          maxPasses: 4,
        }),
        node('again', 'mutate', 'Repeat', 300, -180, {
          operations: [{ op: 'set', path: '/vars/cycle', value: { kind: 'literal', value: true } }],
        }),
        node('collect', 'mutate', 'Collect', 600, 120, {
          operations: [
            { op: 'coerce', source: '/counters/nodeVisits/gate', target: '/vars/count',
              jsonSchema: { type: 'integer' }, repair: { enabled: false } },
            { op: 'append-message', content: 'gate prose stays; counted={{ counters.nodeVisits.gate }}' },
            { op: 'set', path: '/vars/text', value: { kind: 'literal',
              value: { sample: 'gate', path: '/counters/nodeVisits/gate' } } },
          ],
        }),
        node('done', 'exit', 'Finished', 900, 120, {
          returns: '{"visits":counters.nodeVisits.gate,"passes":gates.gate.passes,"count":vars.count,"text":vars.text}',
        }),
        node('opaque', 'script', 'Unused limit path', 600, 430, {
          command: 'node', args: ['-e','void "counters.nodeVisits.gate"'],
          stdin: 'thread', stdout: 'ignore',
        }),
        node('limited', 'exit', 'Exhausted', 900, 430, {
          outcome: 'exhausted', returns: '$exists($lookup(gates, vars.key))',
        }),
      ],
      edges: [
        edge('enter', 'start', 'out', 'gate'),
        edge('repeat', 'gate', 'again', 'again'),
        edge('back', 'again', 'out', 'gate'),
        edge('on-time', 'gate', 'finish', 'collect'),
        edge('return', 'collect', 'out', 'done'),
        edge('limit', 'gate', 'limit-reached', 'opaque'),
        edge('exhausted', 'opaque', 'out', 'limited'),
      ],
    };
  }

  function expectedRename(before, next) {
    const expected = neat(before);
    const renamed = nodeInfo(expected, 'gate');
    renamed.id = next;
    // Deliberately enumerate understood source edits without importing the production rename code.
    renamed.config.jsonata = 'counters.nodeVisits.' + next + ' < 2 ? "again" : "finish"';
    const ops = nodeInfo(expected, 'collect').config.operations;
    ops[0].source = '/counters/nodeVisits/' + next;
    ops[1].content = 'gate prose stays; counted={{ counters.nodeVisits.' + next + ' }}';
    nodeInfo(expected, 'done').config.returns =
      '{"visits":counters.nodeVisits.' + next + ',"passes":gates.' + next + '.passes,"count":vars.count,"text":vars.text}';
    for (const e of expected.edges) {
      if (e.from.node === 'gate') e.from.node = next;
      if (e.to.node === 'gate') e.to.node = next;
    }
    return expected;
  }

  async function exercisePin(loopId, versionId, gateId) {
    const accepted = await api('POST', route(loopId) + '/runs', 202, { versionId });
    equal(accepted.run.versionId, versionId, 'Admitted pin');
    let snapshot;
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      snapshot = await api('GET', '/runs/' + accepted.run.id, 200);
      if (snapshot.finalizedAt || ['failed', 'cancelled', 'exhausted'].includes(snapshot.status)) break;
      await page.evaluate(() => new Promise((done) => setTimeout(done, 125)));
    }
    equal(snapshot?.status, 'succeeded', 'Finalized provider-free run ' + canon(snapshot));
    check(snapshot.finalizedAt, 'Run did not finalize');
    equal(snapshot.versionId, versionId, 'Readback pin');
    equal(snapshot.result, { visits: 2, passes: 2, count: 2,
      text: { sample: 'gate', path: '/counters/nodeVisits/gate' } }, 'Runtime reflects understood references with untouched literals');
    const thread = await api('GET', '/runs/' + snapshot.id + '/thread', 200);
    equal(thread.counters.nodeVisits[gateId], 2, 'Runtime visit key');
    equal(thread.gates[gateId].passes, 2, 'Runtime gate key');
    check(thread.messages.some((message) => message.content === 'gate prose stays; counted=2'), 'Repaired Liquid did not render');
    const trace = await api('GET', '/runs/' + snapshot.id + '/events?limit=100', 200);
    check(!trace.hasMore, 'Unexpectedly broad test trace');
    const routed = trace.items.filter((event) => event.type === 'node.finished' && event.nodeId === gateId);
    equal(routed.map((decision) => [decision.nodeId, decision.route]),
      [[gateId, 'again'], [gateId, 'finish']], 'Exact executed route IDs');
    check(!trace.items.some((event) => event.nodeId === 'opaque'), 'Unused script path ran');
    return { accepted, snapshot, thread, routed };
  }

  try {
    check(/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(origin) && !/:474[78]$/.test(origin), 'Refused nonfixture origin');

    if (!chatOnly) {
    active = 'public rename, atomic history and input hold';
    const name = 'Independent reference cycle ' + suffix;
    const created = await api('POST', '/loops', 201, { definition: fixture(name) });
    const id = created.loop.id;
    const draftPath = route(id) + '/draft';
    const firstRelease = (await api('POST', route(id) + '/publish', 200)).version;
    await openEditor(page, id, name);
    await settings(page);
    const variable = page.locator('.cm-content').and(page.getByLabel('Variables value 1', { exact: true }));
    const originalText = await variable.textContent();
    check(originalText?.includes('"string"'), 'Seed variable JSON missing');
    await variable.click();
    await page.keyboard.press('Control+Home');
    // One native insertion retains the entire previous JSON and avoids an intermediate empty document.
    await page.keyboard.insertText('[');
    const heldText = '[' + originalText;
    equal(await variable.textContent(), heldText, 'Exact held Variables JSON');
    const heldDom = await variable.elementHandle({ timeout: 4500 });
    const priorUndo = page.getByRole('button', { name: /^Undo\b/ });
    check(await priorUndo.getAttribute('aria-disabled') !== 'true', 'Held Variables history was not recognized');
    const priorUndoName = await priorUndo.getAttribute('title');
    const gate = await openNode(page, 'gate', 'decision');
    // Bind the accepted definition and prior requests after the held typing, immediately before rename.
    const before = await readLoop(id);
    const beforeDefinition = (before.draft ?? before.current).definition;
    const preRenameChronology = neat(writes);
    const acceptedDeviceBeforeRename = await snapshotDevice(page, id);
    checkpoints.push({ phase: 'immediately before rename', heldText, before,
      acceptedDeviceBeforeRename, preRenameChronology });
    equal(beforeDefinition, firstRelease.definition, 'Held typing altered the accepted definition before rename');
    if (acceptedDeviceBeforeRename) {
      equal(acceptedDeviceBeforeRename.definition.variables, beforeDefinition.variables,
        'Held typing changed accepted Variables in device storage before rename');
    }
    const next = 'cycleReview';
    const rename = awaitResponse(page, 'PUT', draftPath);
    const nodeId = gate.getByLabel('Node id', { exact: true });
    const beforeForm = await jsonataField(gate, 'jsonata').elementHandle({ timeout: 5000 });
    await nodeId.fill(next);
    await gate.getByLabel('Maximum passes', { exact: true }).click();
    const renamed = page.getByRole('dialog', { name: 'Edit decision ' + next, exact: true });
    const afterForm = jsonataField(renamed, 'jsonata');
    await text(afterForm, 'counters.nodeVisits.cycleReview < 2 ? "again" : "finish"');
    await focus(renamed.getByLabel('Maximum passes', { exact: true }));
    check(await beforeForm.evaluate((element) => !element.isConnected), 'Decision form did not remount');
    await beforeForm.dispose();
    const notice = renameNotice(renamed, 'gate', next);
    await notice.waitFor();
    const noticeText = await notice.innerText();
    check(noticeText.includes('NODE_REFERENCE_UNCERTAIN') && noticeText.includes('scripts'),
      'Rename notice did not expose dynamic and opaque-scope uncertainty');
    await notice.getByRole('button', { name: /NODE_REFERENCE_UNCERTAIN.*node limited config.returns/ }).waitFor();
    equal(await notice.getByRole('button', { name: /check scripts and generated patches/i }).count(), 0,
      'Opaque script warning exposed a misleading field action');
    await page.screenshot({ path: 'rename-remount-desktop.png', animations: 'disabled' });
    const accepted = await captured(rename, 200);
    const expected = expectedRename(beforeDefinition, next);
    equal(accepted.request.definition, expected, 'One complete browser rename body');
    equal(accepted.ifMatch, conditional(before.draftToken)['if-match'], 'Rename used observed base token');
    equal(accepted.body.draft.definition, expected, 'Server accepted the exact rename');
    await closeNode(renamed);
    await focus(uiCard(page, next));
    check(await page.getByTestId('node-' + next).evaluate((el) => el.classList.contains('glow-node-selected')),
      'The renamed card is not selected');
    equal(await page.url(), origin + '/app' + route(id) + '/edit', 'Editor route changed during rename');
    equal(await variable.textContent(), heldText, 'Unrelated held text after rename');
    check(await heldDom.evaluate((element) => element.isConnected), 'Unrelated Variables document needlessly remounted');
    await heldDom.dispose();
    const renamedDevice = await readDevice(page, id, accepted.body.draftToken, true);
    equal(renamedDevice.definition, expected, 'Synced device definition matches one rename');
    const observedRenameRequests = neat(writes.slice(preRenameChronology.length));
    equal(observedRenameRequests.filter((write) => write.path === draftPath).length, 1,
      'Rename produced a fragmented or duplicate draft request');

    const undo = awaitResponse(page, 'PUT', draftPath);
    await page.getByRole('button', { name: 'Undo rename gate to ' + next, exact: true }).click();
    const undone = await captured(undo, 200);
    equal(undone.ifMatch, conditional(accepted.body.draftToken)['if-match'], 'Undo chained the rename token');
    equal(undone.request.definition, beforeDefinition, 'One undo restores the complete original graph');
    check(await page.getByTestId('node-gate').evaluate((el) => el.classList.contains('glow-node-selected')),
      'Undo did not move selection to the original identity');
    equal(await priorUndo.getAttribute('title'), priorUndoName, 'Rename inserted more than one undo step');
    equal(await variable.textContent(), heldText, 'Unrelated held text after undo');
    const redo = awaitResponse(page, 'PUT', draftPath);
    await page.getByRole('button', { name: 'Redo rename gate to ' + next, exact: true }).click();
    const redone = await captured(redo, 200);
    equal(redone.ifMatch, conditional(undone.body.draftToken)['if-match'], 'Redo chained the undo token');
    equal(redone.request.definition, expected, 'One redo restores the complete new graph');
    check(await page.getByTestId('node-' + next).evaluate((el) => el.classList.contains('glow-node-selected')),
      'Redo did not move selection to the replacement identity');
    equal(await variable.textContent(), heldText, 'Unrelated held text after redo');
    await replaceDocument(page, variable, originalText);
    equal(await variable.textContent(), originalText, 'Explicitly repaired held Variable text');

    const gateAgain = await openNode(page, next, 'decision');
    const passSave = awaitResponse(page, 'PUT', draftPath);
    await gateAgain.getByLabel('Maximum passes', { exact: true }).fill('5');
    await closeNode(gateAgain);
    const passResult = await captured(passSave, 200);
    const finalDefinition = neat(expected);
    nodeInfo(finalDefinition, next).config.maxPasses = 5;
    equal(passResult.request.definition, finalDefinition, 'Post-remount sibling edit retained repaired source');
    await expectSaved(page);
    const finalDevice = await readDevice(page, id, passResult.body.draftToken, true);
    equal(finalDevice.definition, finalDefinition, 'Synced device retained the complete final definition');
    await openEditor(page, id, name);
    const reloaded = await readLoop(id);
    equal(reloaded.draftToken, passResult.body.draftToken, 'Reload retained the saved draft token');
    equal(reloaded.draft.definition, finalDefinition, 'Reload reads the exact saved draft');
    equal(reloaded.current, firstRelease, 'Original release is immutable before publishing');
    outcomes.push({ active, id, preRenameChronology, before, acceptedDeviceBeforeRename, noticeText, accepted, observedRenameRequests,
      undone, redone, passResult, renamedDevice, finalDevice, reloaded });

    active = 'publish exactly what was saved and run immutable pins';
    const publish = awaitResponse(page, 'POST', route(id) + '/publish');
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    const publication = await captured(publish, 200);
    const newVersion = publication.body.version;
    equal(newVersion.definition, finalDefinition, 'Browser published the saved definition');
    check(newVersion.id !== firstRelease.id, 'Publication reused a mutable ID');
    const history = (await api('GET', route(id) + '/versions', 200)).items;
    equal(history.find((item) => item.id === firstRelease.id), firstRelease, 'Previous published history changed');
    equal(history.find((item) => item.id === newVersion.id), newVersion, 'New history version differs');
    const originalPin = await exercisePin(id, firstRelease.id, 'gate');
    const currentPin = await exercisePin(id, newVersion.id, next);
    outcomes.push({ active, publication, history, originalPin, currentPin });

    active = 'validation warnings remain visible and known references are refused';
    const warningFixture = neat(finalDefinition);
    nodeInfo(warningFixture, 'done').config.returns =
      '[$exists(gates.ghostOptional), $exists(outputs.foreignResult), $exists($lookup(gates, vars.key))]';
    const warnings = await api('POST', route(id) + '/validate', 200, { definition: warningFixture });
    equal(warnings.publishable, true, 'Optional, inherited, and dynamic reads must be publishable');
    for (const code of ['NODE_REFERENCE_OPTIONAL_MISSING', 'NODE_REFERENCE_OUTPUT_UNVERIFIED', 'NODE_REFERENCE_UNCERTAIN']) {
      check(warnings.issues.some((issue) =>
        issue.severity === 'warning' && issue.code === code && issue.nodeId === 'done' && issue.path === 'config.returns'),
      'Missing warning at the actual field: ' + code);
    }
    await openEditor(page, id, name);
    const foldSettings = page.getByRole('button', { name: 'Hide loop settings', exact: true });
    if (await foldSettings.isVisible()) await foldSettings.click();
    const exit = await openNode(page, 'done', 'exit');
    await page.setViewportSize({ width: 390, height: 900 });
    const bad = 'gates.ghostGate.passes + counters.nodeVisits.ghostVisit';
    const savedBad = awaitResponse(page, 'PUT', draftPath);
    await replaceDocument(page, jsonataField(exit, 'returns'), bad);
    const badDraft = await captured(savedBad, 200);
    equal(nodeInfo(badDraft.body.draft.definition, 'done').config.returns, bad, 'Broken known reference can be saved for repair');
    await exit.getByRole('button', { name: /^\d+ issues? on done$/ }).click();
    const missing = exit.getByRole('button', { name: /NODE_REFERENCE_MISSING.*ghostGate/ });
    await missing.focus();
    await page.keyboard.press('Enter');
    const returnMode = exit.locator('[data-field="returns"]').getByRole('radio', { name: 'JSONata expression' });
    await focus(returnMode);
    await page.keyboard.press('Tab');
    await focus(jsonataField(exit, 'returns'));
    const layout = await exit.evaluate((element) => ({
      viewport: window.innerWidth, documentWidth: document.documentElement.scrollWidth,
      dialogWidth: Math.ceil(element.getBoundingClientRect().width),
      theme: document.documentElement.dataset.theme,
    }));
    check(layout.documentWidth <= layout.viewport && layout.dialogWidth <= layout.viewport, 'Narrow validation overflow');
    await page.screenshot({ path: 'known-missing-focus-narrow.png', animations: 'disabled' });
    await closeNode(exit);
    const blocked = awaitResponse(page, 'POST', route(id) + '/publish');
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    const problem = await captured(blocked, 422, 'LOOP_INVALID');
    const explicit = await api('POST', route(id) + '/validate', 200, { definition: badDraft.body.draft.definition });
    equal(explicit.publishable, false, 'Known missing identities must block');
    for (const [concept, message] of [['gates.ghostGate', 'gate'], ['counters.nodeVisits.ghostVisit', 'visit']]) {
      for (const diagnostics of [problem.body.errors, explicit.issues]) {
        check(diagnostics.some((issue) => issue.code === 'NODE_REFERENCE_MISSING' &&
          issue.severity === 'error' && issue.nodeId === 'done' && issue.path === 'config.returns' &&
          issue.message.includes(concept)), 'Missing blocked ' + message + ' diagnostic');
      }
    }
    const surviving = await readLoop(id);
    equal(surviving.current, newVersion, 'Rejected publication changed active release');
    equal(surviving.draftToken, badDraft.body.draftToken, 'Aborted publish changed the draft token');
    equal(surviving.draft, badDraft.body.draft, 'Aborted publish lost the repairable draft');
    outcomes.push({ active, warnings, badDraft, problem, explicit, surviving, layout });

    active = 'stale tab keeps an atomic device copy and explicit overwrite';
    await page.setViewportSize({ width: 1280, height: 900 });
    const staleName = 'Independent reference stale ' + suffix;
    const staleTarget = await api('POST', '/loops', 201, { definition: fixture(staleName) });
    const staleId = staleTarget.loop.id;
    const stalePath = route(staleId) + '/draft';
    const earliest = await readLoop(staleId);
    await openEditor(page, staleId, staleName);
    const fresh = await page.context().newPage();
    pages.push(fresh);
    bind(fresh, 'fresh tab');
    await openEditor(fresh, staleId, staleName);
    await settings(fresh);
    const freshWrite = awaitResponse(fresh, 'PUT', stalePath);
    await fresh.getByLabel('Description', { exact: true }).fill('Server edit from the second tab');
    const written = await captured(freshWrite, 200);
    await expectSaved(fresh);
    await page.bringToFront();
    const dialog = await openNode(page, 'gate', 'decision');
    const staleSignal = awaitResponse(page, 'PUT', stalePath);
    const idField = dialog.getByLabel('Node id', { exact: true });
    await idField.fill('staleGate');
    await idField.press('Enter');
    const refused = await captured(staleSignal, 409, 'DRAFT_CONFLICT');
    equal(refused.ifMatch, conditional(earliest.draftToken)['if-match'], 'First tab used the old token');
    equal(refused.body.draftToken, written.body.draftToken, 'Conflict returned the exact current token');
    const staleExpected = expectedRename(earliest.draft.definition, 'staleGate');
    equal(refused.request.definition, staleExpected, 'Conflict body was a complete atomic rename');
    equal((await readLoop(staleId)).draft, written.body.draft, 'Stale submission overwrote server draft');
    const conflicted = page.getByRole('dialog', { name: 'Edit decision staleGate', exact: true });
    await conflicted.getByText('The draft changed on the server', { exact: true }).waitFor();
    const heldCopy = await readDevice(page, staleId, earliest.draftToken, false);
    equal(heldCopy.definition, staleExpected, 'Stale device copy fragmented the rename');
    await page.screenshot({ path: 'stale-rename-desktop.png', animations: 'disabled' });
    const overwrite = awaitResponse(page, 'PUT', stalePath);
    await conflicted.getByRole('button', { name: 'Overwrite with this copy', exact: true }).click();
    const overwritten = await captured(overwrite, 200);
    equal(overwritten.ifMatch, conditional(written.body.draftToken)['if-match'], 'Explicit overwrite used current token');
    equal(overwritten.request.definition, staleExpected, 'Overwrite lost part of rename');
    equal((await readLoop(staleId)).draft.definition, staleExpected, 'Explicit selection was not stored');
    outcomes.push({ active, earliest, written, refused, heldCopy, overwritten });
    }

    active = 'protected voice IDs and ordinary reference repair in system Chat';
    const loops = await api('GET', '/loops', 200);
    const chat = loops.items.find((loop) => loop.system?.audience?.kind === 'gateway');
    check(chat, 'Missing gateway system loop');
    const chatBefore = await readLoop(chat.id);
    await openEditor(page, chat.id, chat.name);
    const beforeWrites = writes.length;
    const protectedControls = [];
    for (const id of ['chat-normalize', 'chat-normalize-check', 'chat-normalize-invalid']) {
      const kind = nodeInfo(chatBefore.draft.definition, id).kind;
      await uiCard(page, id).press('Enter');
      const panel = page.getByRole('dialog', { name: 'Edit ' + kind + ' ' + id, exact: true });
      await panel.waitFor();
      const input = panel.getByLabel('Node id', { exact: true });
      const readOnly = await input.evaluate((element) => element.readOnly);
      check(readOnly, id + ' has no readonly browser control');
      check(await panel.getByRole('button', { name: 'Delete node', exact: true }).isDisabled(),
        id + ' has a reachable delete control');
      await input.press('End');
      await page.keyboard.type('x');
      await input.press('Enter');
      await value(input, id);
      protectedControls.push({ id, kind, readOnly });
      await closeNode(panel);
    }
    equal(writes.length, beforeWrites, 'Protected Chat gesture emitted a mutation');
    equal(await readLoop(chat.id), chatBefore, 'Protected gesture changed the Chat graph');
    await uiCard(page, 'respond').press('Enter');
    const respond = page.getByRole('dialog', { name: 'Edit inference respond', exact: true });
    await respond.waitFor();
    const chatSave = awaitResponse(page, 'PUT', route(chat.id) + '/draft');
    const respondId = respond.getByLabel('Node id', { exact: true });
    await respondId.fill('replyWriter');
    await respondId.press('Enter');
    const savedChat = await captured(chatSave, 200);
    const expectedChat = neat(chatBefore.draft.definition);
    nodeInfo(expectedChat, 'respond').id = 'replyWriter';
    nodeInfo(expectedChat, 'chat-envelope').config.operations[0].value.jsonata =
      '{"protocol":"graphgoblin.chat.v1","reply":outputs.replyWriter.value}';
    for (const e of expectedChat.edges) {
      if (e.from.node === 'respond') e.from.node = 'replyWriter';
      if (e.to.node === 'respond') e.to.node = 'replyWriter';
    }
    equal(savedChat.body.draft.definition, expectedChat, 'Ordinary Chat repair preserved protected nodes and the boundary');
    equal((await readLoop(chat.id)).current, chatBefore.current, 'QA mutated published Chat');
    check(!writes.some((item) => item.unexpectedChatTurn), 'Browser sent an unrequested provider turn');
    equal(pageErrors, [], 'Uncaught page errors');
    outcomes.push({ active, protectedControls, chatBefore, savedChat });

    await Promise.allSettled(outstandingResponses);
    return { origin, browser: await page.evaluate(() => navigator.userAgent), outcomes, writes,
      setupResponses, checkpoints, pageErrors, failure: null };
  } catch (error) {
    await page.screenshot({ path: 'first-failure.png', animations: 'disabled' }).catch(() => {});
    await Promise.race([Promise.allSettled(outstandingResponses),
      page.evaluate(() => new Promise((done) => setTimeout(done, 300))).catch(() => {})]);
    return { origin, outcomes, writes, setupResponses, checkpoints, pageErrors,
      failure: { active, error: String(error), stack: error.stack } };
  } finally {
    for (const pane of pages) await pane.close();
  }
}
