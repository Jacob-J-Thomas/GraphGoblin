async (page) => {
  const url = new URL(page.url());
  const origin = url.origin;
  const scenario = url.searchParams.get('case');
  const bundle = url.searchParams.get('bundle');
  const gatewayPid = url.searchParams.get('gatewayPid');
  const wait = { timeout: 9000 };
  const result = { suite: '207-corrected-review-focused', scenario, origin, gatewayPid, bundle, checkpoints: [], pageErrors: [], puts: [], bundleResponses: [] };
  const checkpoint = (label, details) => result.checkpoints.push({ label, ...details });
  const check = (truth, message) => { if (!truth) throw new Error(message); };
  function canon(value) {
    return JSON.stringify(value, (_, data) => data && typeof data === 'object' && !Array.isArray(data)
      ? Object.fromEntries(Object.keys(data).sort().map((key) => [key, data[key]])) : data);
  }
  const same = (actual, expected, message) => {
    check(canon(actual) === canon(expected), message + '\nExpected ' + canon(expected) + '\nActual ' + canon(actual));
  };
  const waitDebounce = () => new Promise((done) => setTimeout(done, 1000));
  const definitionOf = (record) => record.draft?.definition ?? record.current?.definition;
  const editPath = (id) => '/loops/' + id;
  const edge = (id, source, port, target) => ({ id, from: { node: source, port }, to: { node: target, port: 'in' } });
  const node = (id, kind, label, x, y, config) => ({ id, kind, label, ui: { x, y }, config });

  page.on('pageerror', (error) => result.pageErrors.push(String(error)));
  page.on('request', (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.origin !== origin || request.method() !== 'PUT' ||
      !/^\/loops\/[^/]+\/draft$/.test(requestUrl.pathname)) return;
    result.puts.push({
      url: request.url(), body: request.postDataJSON(), ifMatch: request.headers()['if-match'] ?? null,
      at: Date.now(), status: null,
    });
  });
  page.on('response', (response) => {
    const responseUrl = new URL(response.url());
    if (responseUrl.origin === origin && responseUrl.pathname === bundle)
      result.bundleResponses.push({ status: response.status(), pid: response.headers()['x-graphgoblin-pid'] ?? null });
    if (response.request().method() !== 'PUT') return;
    const pending = result.puts.find((item) => item.url === response.url() && item.status === null);
    if (pending) pending.status = response.status();
  });

  async function api(method, path, body, { status = 200, token } = {}) {
    const response = await page.request.fetch(origin + path, {
      method,
      timeout: 10000,
      ...(body === undefined ? {} : { data: body }),
      ...(token === undefined ? {} : { headers: { 'if-match': '"' + token + '"' } }),
    });
    const payload = await response.json();
    same(response.status(), status, method + ' ' + path + ' status');
    return payload;
  }
  const get = (id) => api('GET', editPath(id));
  const put = (id, definition, token) => api('PUT', editPath(id) + '/draft', { definition }, { token });
  const saveState = (text) => page.getByTestId('save-state').filter({ hasText: text });
  const selected = (id) => page.locator('.react-flow__edge.selected[data-id=' + JSON.stringify(id) + ']');
  const allEdges = (id) => page.locator('.react-flow__edge[data-id=' + JSON.stringify(id) + ']');
  const card = (id) => page.locator('.react-flow__node[data-id=' + JSON.stringify(id) + ']');
  const undo = () => page.locator('button[data-history="undo"]').click(wait);

  async function deviceCopy(id, expectedToken, expectedSynced, graphPredicate) {
    const copy = await page.waitForFunction(async ({ id, expectedToken, expectedSynced, graphPredicate }) => {
      const value = await new Promise((done) => {
        const open = indexedDB.open('graphgoblin');
        open.onupgradeneeded = () => open.transaction.abort();
        open.onerror = () => done(null);
        open.onsuccess = () => {
          const db = open.result;
          try {
            const query = db.transaction('drafts').objectStore('drafts').get(id);
            query.onsuccess = () => { db.close(); done(query.result ?? null); };
            query.onerror = () => { db.close(); done(null); };
          } catch { db.close(); done(null); }
        };
      });
      if (!value || value.synced !== expectedSynced || value.baseToken !== expectedToken) return false;
      if (graphPredicate) {
        const expected = graphPredicate;
        const node = value.definition.nodes.find((item) => item.id === 'work');
        if (node?.config.routes?.[0]?.id !== '' || value.definition.edges.some((item) => item.id === expected.edgeId) !== expected.edgePresent)
          return false;
      }
      return value;
    }, { id, expectedToken, expectedSynced, graphPredicate }, { timeout: 9000, polling: 100 });
    try { return await copy.jsonValue(); }
    finally { await copy.dispose(); }
  }

  async function initialDeviceCopy(id) {
    return page.evaluate((id) => new Promise((done) => {
      const open = indexedDB.open('graphgoblin');
      open.onupgradeneeded = () => open.transaction.abort();
      open.onerror = () => done(null);
      open.onsuccess = () => {
        const db = open.result;
        try {
          const query = db.transaction('drafts').objectStore('drafts').get(id);
          query.onsuccess = () => { db.close(); done(query.result ?? null); };
          query.onerror = () => { db.close(); done(null); };
        } catch { db.close(); done(null); }
      };
    }), id);
  }

  async function durable(id, label, { initial = false } = {}) {
    const current = await get(id);
    check(typeof current.draftToken === 'string', 'Fixture has no public draft token');
    const local = initial ? await initialDeviceCopy(id) : await deviceCopy(id, current.draftToken, true);
    if (local) {
      same(local.definition, definitionOf(current), label + ' matches device and server');
      same(local.synced, true, label + ' browser copy is synced');
      same(local.baseToken, current.draftToken, label + ' browser copy token');
    }
    checkpoint(label, { id, public: current, local });
    return current;
  }

  async function edit(id, base, action, label) {
    const start = result.puts.length;
    const [response] = await Promise.all([
      page.waitForResponse((value) => value.request().method() === 'PUT' && new URL(value.url()).pathname === editPath(id) + '/draft', wait),
      Promise.resolve().then(action),
    ]);
    same(response.status(), 200, label + ' PUT response');
    const receipt = await response.json();
    await saveState('All changes saved').waitFor(wait);
    const current = await durable(id, label);
    await waitDebounce();
    const requests = result.puts.slice(start);
    same(requests.length, 1, label + ' exactly one browser PUT');
    same(requests[0].ifMatch, '"' + base.draftToken + '"', label + ' preserves conditional base');
    same(receipt.draft, current.draft, label + ' response and exact readback agree');
    same(receipt.draftToken, current.draftToken, label + ' response token');
    same(requests[0].body.definition, definitionOf(current), label + ' exact body');
    return current;
  }

  function specimen(name, { decision = false, script = false } = {}) {
    const work = decision
      ? node('work', 'decision', 'Editable decision', 355, 265, {
          kind: 'expression', jsonata: '"accept"',
          routes: [{ id: 'accept', label: 'Accept' }, { id: 'fallback', label: 'Fallback' }],
        })
      : script
        ? node('work', 'script', 'Editable Script', 355, 265, {
            command: 'never-execute-fixture', stdin: 'none', stdout: 'ignore',
            exitCodeRoutes: { 0: 'out', 7: 'retry', 23: 'report' },
          })
        : node('work', 'mutate', 'Do work', 355, 265, {
          operations: [{ op: 'append-message', role: 'note', content: 'Fixture work' }],
        });
    return {
      schemaVersion: 4,
      name,
      nodes: [
        node('start', 'trigger', 'Fixture start', 20, 285, { type: 'manual' }),
        work,
        node('done', 'exit', 'Fixture success', 735, 270, { outcome: 'success' }),
        node('other', 'exit', 'Other terminal', 730, 590, { outcome: 'failure' }),
        node('spare', 'mutate', 'Unaffected source', 90, 600, {
          operations: [{ op: 'append-message', role: 'note', content: 'Control edge' }],
        }),
      ],
      edges: [
        edge('entry', 'start', 'out', 'work'),
        { ...edge('e1', 'work', decision ? 'accept' : script ? 'retry' : 'out', 'done'), ui: { route: [635] } },
        edge('control', 'spare', 'out', 'other'),
        ...(decision ? [edge('fallback', 'work', 'fallback', 'other')] : []),
      ],
    };
  }

  async function create(name, options) {
    const definition = specimen(name, options);
    const { loop } = await api('POST', '/loops', { definition }, { status: 201 });
    const current = await get(loop.id);
    checkpoint('public fixture created', { id: loop.id, public: current });
    return { id: loop.id, current, name };
  }

  async function fit() {
    await page.locator('.react-flow__controls-fitview').click(wait);
    await page.locator('.react-flow__viewport').evaluate(async (view) => {
      await document.fonts.ready;
      await new Promise((done, reject) => {
        let previous = view.getAttribute('style'), stable = 0, frames = 0;
        const frame = () => {
          const now = view.getAttribute('style');
          stable = now === previous ? stable + 1 : 0;
          previous = now;
          if (++frames > 180) reject(new Error('Viewport did not settle'));
          else if (stable >= 6) done();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
    });
  }

  async function open({ id, name }, { settings = false } = {}) {
    await page.goto(origin + '/app' + editPath(id) + '/edit');
    await page.getByRole('heading', { name, exact: true }).waitFor(wait);
    await page.getByText('The editor is available. Checking the server and this device before saving changes.', { exact: true })
      .waitFor({ state: 'hidden', timeout: 9000 });
    const hidePalette = page.getByRole('button', { name: 'Hide palette', exact: true });
    if (await hidePalette.isVisible()) await hidePalette.click(wait);
    const toggle = page.getByRole('button', { name: settings ? 'Show loop settings' : 'Hide loop settings', exact: true });
    if (await toggle.isVisible()) await toggle.click(wait);
    await fit();
  }

  async function selectEdge(id) {
    await allEdges(id).first().waitFor(wait);
    const point = await allEdges(id).evaluateAll((roots) => {
      for (const root of roots) {
        const path = root.querySelector('.react-flow__edge-path');
        const transform = path?.getScreenCTM();
        if (!transform) continue;
        for (const fraction of [0.25, 0.4, 0.55, 0.7, 0.8]) {
          const point = path.getPointAtLength(path.getTotalLength() * fraction).matrixTransform(transform);
          const hit = document.elementFromPoint(point.x, point.y);
          if (hit?.closest('.react-flow__edge')?.dataset.id === root.dataset.id &&
              hit.classList.contains('react-flow__edge-interaction')) return { x: point.x, y: point.y };
        }
      }
      return null;
    });
    check(point, 'No unique hittable canvas path point for ' + id);
    await page.mouse.click(point.x, point.y);
    await selected(id).first().waitFor(wait);
    const identity = await selected(id).first().getAttribute('aria-label');
    checkpoint('trusted pointer selected edge', { id, point, identity });
    return identity;
  }

  async function buttonHit(id, { allowUnavailable = false } = {}) {
    const buttons = selected(id).getByRole('button', { name: 'Remove connection', exact: true });
    await buttons.first().waitFor(wait);
    const point = await buttons.evaluateAll((items) => {
      for (const button of items) {
        const rect = button.getBoundingClientRect();
        const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        if (items.includes(hit?.closest('button')))
          return { x, y, width: rect.width, height: rect.height,
            disabled: button.disabled, ariaDisabled: button.getAttribute('aria-disabled'),
            label: hit.closest('.react-flow__edge')?.getAttribute('aria-label') };
      }
      return null;
    });
    check(point && (allowUnavailable || (!point.disabled && point.ariaDisabled !== 'true')), 'Selected Remove needs an enabled, hit-tested center');
    return point;
  }
  const clickAt = ({ x, y }) => page.mouse.click(x, y);

  function without(definition, id) {
    return { ...definition, edges: definition.edges.filter((item) => item.id !== id) };
  }

  async function idleFingerprint(id) {
    const history = await page.locator('button[data-history]').evaluateAll((buttons) =>
      buttons.map((button) => [button.dataset.history, button.textContent, button.getAttribute('aria-disabled')]));
    return { public: await get(id), local: await initialDeviceCopy(id), history,
      save: await page.getByTestId('save-state').textContent() };
  }

  async function noWrite(id, before, action, label) {
    const offset = result.puts.length;
    await action();
    await waitDebounce();
    same(result.puts.length, offset, label + ' sent no browser PUT');
    const after = await idleFingerprint(id);
    same(after, before, label + ' kept public graph, token, device, history and save state');
    checkpoint(label, after);
  }

  async function assertSelectionCleared(id, label) {
    await selected(id).first().waitFor({ state: 'detached', timeout: 9000 });
    same(await page.getByRole('button', { name: 'Remove connection', exact: true }).count(), 0,
      label + ' left a selected-edge control');
  }

  async function checkUndoLabel(label) {
    await page.getByRole('button', { name: 'Undo ' + label, exact: true }).waitFor(wait);
  }

  async function assertUndoFocus() {
    await page.waitForFunction(() => document.activeElement?.matches('button[data-history="undo"]'), null, wait);
  }

  async function duplicate() {
    const fixture = await create('Corrected duplicate refusal');
    const { id } = fixture;
    const definition = structuredClone(definitionOf(fixture.current));
    definition.edges[0].id = 'e1';
    const staged = await put(id, definition, fixture.current.draftToken);
    check(staged.issues.some((issue) => issue.code === 'DUPLICATE_EDGE_ID'), 'Expected duplicate-ID diagnostic from draft PUT');
    same(staged.draft.definition, definition, 'Public draft silently changed duplicate fixture');
    checkpoint('public duplicate admission remains unchanged', { receipt: staged });
    await open(fixture);
    const before = await durable(id, 'duplicate baseline', { initial: true });
    await selectEdge('e1');
    await card('spare').getByText('Unaffected source', { exact: true }).click({ modifiers: ['Control'], timeout: 9000 });
    const dialog = page.getByRole('dialog', { name: 'Edit mutate spare' });
    await dialog.getByRole('button', { name: 'Done', exact: true }).click(wait);
    await dialog.waitFor({ state: 'detached', timeout: 9000 });
    check(await card('spare').evaluate((node) => node.classList.contains('selected')), 'No live node present to catch unintended fallback');
    const buttons = selected('e1').getByRole('button', { name: 'Remove connection', exact: true });
    await buttons.first().waitFor(wait);
    const controls = await buttons.evaluateAll((items) => items.map((button) => ({
      nativeDisabled: button.disabled, reason: button.title, gesture: button.getAttribute('data-gesture'),
    })));
    check(controls.length && controls.every((item) => item.nativeDisabled && item.gesture === null),
      'Ambiguous selected Remove remained actionable or reported the gesture instead');
    const reason = controls[0].reason;
    check(/duplicate|more than one|multiple|shared/i.test(reason) && reason.includes('e1'),
      'Disabled reason does not identify the ambiguous ID');
    same(controls.every((item) => item.reason === reason), true, 'Ambiguous rendered controls must agree');
    const idle = await idleFingerprint(id);
    await noWrite(id, idle, async () => {
      await selected('e1').first().focus(wait);
      for (const key of ['Delete', 'Backspace']) {
        await page.keyboard.press(key);
        const notice = page.getByText('Connection refused: ' + reason, { exact: true });
        await notice.waitFor(wait);
        check(await selected('e1').count(), 'Refusal lost the edge selection');
        check(await card('spare').evaluate((node) => node.classList.contains('selected')), 'Refusal fell through to the selected node');
      }
    }, 'both real keyboard refusals');
    await selectEdge('control');
    const point = await buttonHit('control');
    const removed = await edit(id, before, () => clickAt(point), 'single unique Remove control');
    await assertUndoFocus();
    await checkUndoLabel('remove edge spare to other');
    same(definitionOf(removed), without(definitionOf(before), 'control'), 'Unique removal touched other records');
    const undone = await edit(id, removed, undo, 'Undo unique Remove control');
    same(definitionOf(undone), definitionOf(before), 'Unique control Undo restored exact graph and duplicate holders');
    same(undone.draftToken, before.draftToken, 'Unique control original content token');
    return 'PASS_AMBIGUOUS_REFUSAL_AND_UNIQUE_CONTROL';
  }


  async function reloadReplacement() {
    const fixture = await create('Corrected same-ID reload');
    const { id } = fixture;
    await open(fixture, { settings: true });
    const base = await durable(id, 'reload baseline', { initial: true });
    const old = await selectEdge('e1');
    check(old.startsWith('work out to done'), 'Wrong original selection');
    const serverNext = structuredClone(definitionOf(base));
    const replacement = serverNext.edges.find((item) => item.id === 'e1');
    replacement.to.node = 'other';
    delete replacement.ui;
    const staged = await put(id, serverNext, base.draftToken);
    const reloaded = await get(id);
    same(staged.draft, reloaded.draft, 'Separate public writer staged exact replacement');
    const start = result.puts.length;
    const description = page.getByLabel('Description', { exact: true });
    check(await description.isVisible(), 'Loop settings description unavailable');
    const [conflict] = await Promise.all([
      page.waitForResponse((response) => response.status() === 409 && response.request().method() === 'PUT' &&
        new URL(response.url()).pathname === editPath(id) + '/draft', wait),
      description.fill('Unsaved edit to prove real conditional conflict.'),
    ]);
    const conflictResponse = await conflict.json();
    same(result.puts[start]?.ifMatch, '"' + base.draftToken + '"', 'Conflict used exact stale token');
    same(await get(id), reloaded, 'Failed edit changed the server');
    checkpoint('native edit caused actual stale-token conflict', { conflict: conflictResponse, public: reloaded });
    const reload = page.getByRole('button', { name: 'Reload server draft', exact: true });
    await reload.click(wait);
    await reload.waitFor({ state: 'detached', timeout: 9000 });
    await saveState('All changes saved').waitFor(wait);
    const afterReload = await durable(id, 'explicit same-loop reload');
    same(afterReload, reloaded, 'Reload changed durable draft');
    const replacementEdge = allEdges('e1').first();
    await replacementEdge.waitFor(wait);
    check((await replacementEdge.getAttribute('aria-label')).startsWith('work out to other'),
      'Expected same-ID different-ends connection to be visible');
    await assertSelectionCleared('e1', 'real reload');
    const idle = await idleFingerprint(id);
    await noWrite(id, idle, async () => {
      await replacementEdge.focus(wait);
      await page.keyboard.press('Backspace');
    }, 'focused but unselected replacement is not deleted');
    const name = await selectEdge('e1');
    check(name.startsWith('work out to other') && name !== old, 'Replacement was not freshly selected');
    const point = await buttonHit('e1');
    const removed = await edit(id, afterReload, () => clickAt(point), 'explicitly reselected replacement Remove');
    await assertUndoFocus();
    await checkUndoLabel('remove edge work to other');
    same(definitionOf(removed), without(definitionOf(afterReload), 'e1'), 'Wrong replacement mutation');
    const restored = await edit(id, removed, undo, 'one Undo restores exact replacement');
    same(definitionOf(restored), definitionOf(afterReload), 'Replacement Undo exact graph');
    same(restored.draftToken, afterReload.draftToken, 'Replacement Undo content token');
    await assertSelectionCleared('e1', 'Undo');
    return 'PASS_RELOAD_CLEARS_SELECTION_AND_RESELECT_REMOVES_ONCE';
  }


  async function hiddenSelection() {
    const fixture = await create('Corrected hidden Decision selection', { decision: true });
    const { id } = fixture;
    await open(fixture);
    const base = await durable(id, 'selected Decision baseline', { initial: true });
    await selectEdge('e1');
    await card('work').getByText('Editable decision', { exact: true }).click({ modifiers: ['Control'], timeout: 9000 });
    const dialog = page.getByRole('dialog', { name: 'Edit decision work' });
    await dialog.waitFor(wait);
    same(await selected('e1').count(), 1, 'Control-click did not retain the original selected edge');
    const start = result.puts.length;
    await dialog.locator('[data-field="routes.0.id"] input').fill('');
    await saveState('Saved on this device only').waitFor(wait);
    const blank = await deviceCopy(id, base.draftToken, false, { edgeId: 'e1', edgePresent: true });
    same(blank.definition.edges, definitionOf(base).edges, 'Clearing the ID pruned stored topology');
    const owner = blank.decisionRoutes?.work?.rows?.[0];
    same(owner?.edgeIds, ['e1'], 'Blank Decision row still owns its exact edge');
    await dialog.getByRole('button', { name: 'Done', exact: true }).click(wait);
    await dialog.waitFor({ state: 'detached', timeout: 9000 });
    await allEdges('e1').first().waitFor({ state: 'detached', timeout: 9000 });
    await assertSelectionCleared('e1', 'blank Decision port');
    await page.waitForFunction(() => document.activeElement?.matches('.react-flow__node.selected[data-id="work"]'), null, wait);
    same(await get(id), base, 'Blank route ID modified the public draft or token');
    same(result.puts.length, start, 'Invalid blank was sent to the server');
    checkpoint('hidden edge kept until a new explicit action and node has focus', { blank, owner, writesBefore: start });

    const deleted = await edit(id, base, () => page.keyboard.press('Backspace'), 'explicit focused-node Backspace');
    await checkUndoLabel('delete work');
    const expected = structuredClone(blank.definition);
    expected.nodes = expected.nodes.filter((node) => node.id !== 'work');
    expected.edges = expected.edges.filter((edge) => edge.from.node !== 'work' && edge.to.node !== 'work');
    same(definitionOf(deleted), expected, 'Backspace must delete the selected node and all its incident edges');
    same(result.puts.length, start + 1, 'One node deletion produced one normal conditional PUT');
    await undo();
    const restored = await deviceCopy(id, deleted.draftToken, false, { edgeId: 'e1', edgePresent: true });
    same(restored.definition, blank.definition, 'One Undo restores full invalid graph and manual geometry');
    same(restored.decisionRoutes, blank.decisionRoutes, 'One Undo restores exact Decision ownership');
    await assertSelectionCleared('e1', 'Undo after node deletion');
    await waitDebounce();
    same(result.puts.length, start + 1, 'Undo of the invalid graph was sent to the server');
    same(await get(id), deleted, 'Undo of an invalid draft changed the saved server graph');
    checkpoint('one Undo restores device-only invalid node and its edges', { restored, server: deleted });

    await page.getByRole('button', { name: /^\d+ errors?\b/ }).click(wait);
    const group = page.getByRole('dialog', { name: 'Loop issues' }).getByRole('group', { name: 'Connections the canvas cannot draw' });
    await group.getByRole('button', { name: 'Remove edge e1', exact: true }).click(wait);
    const recovery = await deviceCopy(id, deleted.draftToken, false, { edgeId: 'e1', edgePresent: false });
    same(recovery.definition, without(blank.definition, 'e1'), 'Explicit recovery changed anything but the one edge');
    same(recovery.decisionRoutes.work.rows[0].edgeIds, [], 'Recovery did not release the row owner');
    await checkUndoLabel('remove edge work accept to done');
    await waitDebounce();
    same(result.puts.length, start + 1, 'Device-only recovery unexpectedly sent a PUT');
    checkpoint('Loop issues explicitly removes only the unique stranded connection', { recovery });
    return 'PASS_HIDDEN_EDGE_RETIRED_AND_EXPLICIT_NODE_DELETE';
  }

  async function scriptAndGeometry() {
    const fixture = await create('Corrected Script and geometry selection', { script: true });
    const { id } = fixture;
    await open(fixture);
    const before = await durable(id, 'Script baseline', { initial: true });
    await selectEdge('e1');
    await card('work').getByText('Editable Script', { exact: true }).click({ modifiers: ['Control'], timeout: 9000 });
    const dialog = page.getByRole('dialog', { name: 'Edit script work' });
    await dialog.waitFor(wait);
    same(await selected('e1').count(), 1, 'Control-click did not retain original Script edge');
    const advanced = dialog.getByRole('button', { name: /^Advanced\b/ });
    if ((await advanced.getAttribute('aria-expanded')) !== 'true') await advanced.click(wait);
    const edited = await edit(id, before, async () => {
      await dialog.getByRole('button', { name: 'Remove exit code routes 7', exact: true }).click(wait);
      await dialog.getByRole('button', { name: 'Done', exact: true }).click(wait);
    }, 'retire one selected Script port');
    const expected = structuredClone(definitionOf(before));
    delete expected.nodes.find((node) => node.id === 'work').config.exitCodeRoutes['7'];
    same(definitionOf(edited), expected, 'Script edit changed stored connections or other config');
    await assertSelectionCleared('e1', 'removed Script port');
    same(await allEdges('e1').count(), 0, 'Retired port retained edge path');
    const restored = await edit(id, edited, undo, 'restore Script port');
    same(definitionOf(restored), definitionOf(before), 'Script Undo exact full graph');
    await allEdges('e1').first().waitFor(wait);
    await assertSelectionCleared('e1', 'restored previously selected Script edge');

    await selectEdge('e1');
    const segment = selected('e1').locator('.gg-route-handle-x').first();
    await segment.waitFor(wait);
    const changed = await edit(id, restored, () => segment.press('ArrowRight'), 'same connection geometry nudge');
    const priorEdge = definitionOf(restored).edges.find((edge) => edge.id === 'e1');
    const geometry = definitionOf(changed).edges.find((edge) => edge.id === 'e1');
    check(geometry.ui?.route?.length && canon(geometry.ui.route) !== canon(priorEdge.ui.route), 'Native keyboard nudge did not change manual geometry');
    const expectedGeometry = structuredClone(definitionOf(restored));
    expectedGeometry.edges.find((edge) => edge.id === 'e1').ui = geometry.ui;
    same(definitionOf(changed), expectedGeometry, 'Geometry edit changed edges, endpoints or nodes');
    check(await selected('e1').count() === 1, 'Geometry change cleared the live selection');
    const undone = await edit(id, changed, undo, 'Undo same-connection geometry nudge');
    same(definitionOf(undone), definitionOf(before), 'Geometry Undo exact graph and manual route');
    check(await selected('e1').count() === 1, 'Geometry Undo cleared the live selection');
    const point = await buttonHit('e1');
    const removed = await edit(id, undone, () => clickAt(point), 'explicit Remove after retained geometry selection');
    same(definitionOf(removed), without(definitionOf(undone), 'e1'), 'Retained selection targeted another edge');
    await assertUndoFocus();
    return 'PASS_SCRIPT_PORT_IMPACT_AND_GEOMETRY_CONTINUITY';
  }


  async function monitorDrag(id) {
    await page.evaluate((edgeId) => {
      const events = [];
      const browserEvents = [];
      const byBrowserEvent = new WeakMap();
      const keys = new WeakMap();
      let ordinal = 0;
      const key = (value) => {
        if (!value || (typeof value !== 'object' && typeof value !== 'function')) return null;
        if (!keys.has(value)) keys.set(value, ++ordinal);
        return keys.get(value);
      };
      const d3 = () => (window.__on ?? []).filter((item) =>
        item.name === 'drag' && (item.type === 'mouseup' || item.type === 'click'))
        .map((item) => ({
          type: item.type, handler: key(item.value), wrapper: key(item.listener),
          capture: item.options === true || item.options?.capture === true,
          passive: item.options?.passive ?? null,
          ...(item.type === 'click' ? { callback: Function.prototype.toString.call(item.value) } : {}),
        }));
      const capture = (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const btn = target?.closest('button');
        const root = target?.closest('.react-flow__edge');
        const tracked = document.querySelector('.react-flow__edge.selected[data-id=' + JSON.stringify(edgeId) + ']');
        const remove = [...(tracked?.querySelectorAll('button') ?? [])].find((item) => item.textContent.trim() === 'Remove connection');
        const entry = {
          type: event.type, trusted: event.isTrusted, x: event.clientX, y: event.clientY,
          buttons: event.buttons, button: event.button, detail: event.detail, pointerId: event.pointerId,
          at: performance.now(), eventTime: event.timeStamp, control: event.ctrlKey,
          target: key(target), buttonTarget: key(btn), buttonText: btn?.textContent.trim() ?? null, edgeTarget: root?.dataset.id ?? null, nodeTarget: target?.closest('.react-flow__node')?.dataset.id ?? null, paneTarget: !!target?.closest('.react-flow__pane'),
          path: event.composedPath().slice(0, 9).map((item) => key(item)),
          selected: !!tracked, actualRemove: key(remove), disabled: remove?.disabled ?? null,
          ariaDisabled: remove?.getAttribute('aria-disabled') ?? null,
          gesture: remove?.getAttribute('data-gesture') ?? null,
          before: event.defaultPrevented, cancelable: event.cancelable, d3: d3(), reachedDocument: false,
        };
        events.push(entry);
        browserEvents.push(event);
        byBrowserEvent.set(event, entry);
      };
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick'])
        window.addEventListener(type, capture, { capture: true, passive: true });
      document.addEventListener('click', (event) => {
        const entry = byBrowserEvent.get(event);
        if (entry) entry.reachedDocument = true;
      }, { capture: true, passive: true });
      const read = () => events.map((entry, i) => ({ ...entry, after: browserEvents[i].defaultPrevented }));
      window.__gg207KnownNegative = { read, d3 };
    }, id);
  }

  async function resetDoubleClick() {
    const fixture = await create('Reset toolbar double-click concern');
    const { id } = fixture;
    await open(fixture);
    const baseline = await durable(id, 'manual-edge baseline', { initial: true });
    await selectEdge('e1');
    const reset = selected('e1').getByRole('button', { name: 'Reset route', exact: true });
    const remove = selected('e1').getByRole('button', { name: 'Remove connection', exact: true });
    const historical = { x: 793.704, y: 286.940 };

    async function toolbar() {
      return selected('e1').evaluate((edge) => {
        const box = (node) => node ? node.getBoundingClientRect().toJSON() : null;
        const info = (button) => button ? {
          box: box(button), disabled: button.disabled, ariaDisabled: button.getAttribute('aria-disabled'),
          tabIndex: button.tabIndex, title: button.title,
        } : null;
        const find = (name) => [...edge.querySelectorAll('button')].find((button) => button.textContent.trim() === name);
        const frame = edge.querySelector('.gg-route-toolbar-frame');
        return {
          reset: info(find('Reset route')), remove: info(find('Remove connection')),
          anchor: frame?.parentElement?.getAttribute('transform') ?? null,
          viewport: document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? null,
        };
      });
    }
    async function resetAt(point) {
      return reset.evaluate((button, { x, y }) => {
        const hit = document.elementFromPoint(x, y);
        return {
          hits: hit?.closest('button') === button, label: hit?.closest('button')?.textContent.trim() ?? null,
          target: hit?.getAttribute('class') ?? null, edge: hit?.closest('.react-flow__edge')?.dataset.id ?? null,
        };
      }, point);
    }
    async function clearSelection() {
      const point = await page.locator('.react-flow__pane').evaluate((pane) => {
        const box = pane.getBoundingClientRect();
        for (const y of [0.18, 0.35, 0.67, 0.82]) {
          for (const x of [0.2, 0.4, 0.65, 0.85]) {
            const point = { x: box.x + x * box.width, y: box.y + y * box.height };
            if (document.elementFromPoint(point.x, point.y) === pane) return point;
          }
        }
        return null;
      });
      check(point, 'No genuine pane point for clearing selection');
      await clickAt(point);
      await assertSelectionCleared('e1', 'genuine pane deselection');
    }

    const expectedAutomatic = structuredClone(definitionOf(baseline));
    delete expectedAutomatic.edges.find((edge) => edge.id === 'e1').ui;
    const manual = await toolbar();
    check(manual.reset && manual.remove && manual.anchor, 'Expected manual toolbar with Reset and Remove');
    const originalReset = await reset.elementHandle();
    const one = await edit(id, baseline, () => reset.click(wait), 'ordinary Reset only');
    same(definitionOf(one), expectedAutomatic, 'Ordinary Reset changed other graph data');
    await checkUndoLabel('reset route of work to done');
    const singleHold = await toolbar();
    const sameReset = await originalReset.evaluate((el) => el.isConnected);
    await originalReset.dispose();

    await clearSelection();
    await selectEdge('e1');
    const fresh = await toolbar();
    check(fresh.remove, 'Fresh automatic selection has no Remove');
    const restored = await edit(id, one, undo, 'one Undo of ordinary Reset');
    same(definitionOf(restored), definitionOf(baseline), 'Undo restored exact manual route');
    same(restored.draftToken, baseline.draftToken, 'Undo restored exact manual token');
    if (!(await selected('e1').count())) await selectEdge('e1');
    const before = await toolbar();
    check(before.reset && !before.reset.disabled && before.reset.ariaDisabled !== 'true', 'Restored manual Reset is not available');
    const { box } = before.reset;
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const oldOverlap = fresh.remove.box;
    const x0 = Math.max(box.x, oldOverlap.x), x1 = Math.min(box.right, oldOverlap.right);
    const y0 = Math.max(box.y, oldOverlap.y), y1 = Math.min(box.bottom, oldOverlap.bottom);
    const liveOverlap = x1 - x0 > 4 && y1 - y0 > 4 ? { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } : null;
    const candidates = [
      { kind: 'historical', point: historical },
      ...(liveOverlap ? [{ kind: 'candidate-overlap', point: liveOverlap }] : []),
      { kind: 'current-Reset-right', point: { x: box.x + box.width * 0.7, y: center.y } },
    ];
    for (const candidate of candidates) candidate.hit = await resetAt(candidate.point);
    const chosen = candidates.find(({ hit }) => hit.hits && hit.edge === 'e1');
    checkpoint('manual, held and freshly reselected toolbar geometry before the burst', {
      manual, singleHold, sameReset, fresh, before, candidates, chosen,
    });
    check(chosen, 'No genuine first-click target on manual e1 Reset');
    await monitorDrag('e1');
    const offsets = { writes: result.puts.length };
    const burstReset = await reset.elementHandle();
    same(await resetAt(chosen.point), chosen.hit, 'First-input target changed before the burst');
    await page.mouse.dblclick(chosen.point.x, chosen.point.y);
    await saveState('All changes saved').waitFor(wait);
    await waitDebounce();
    const current = await durable(id, 'final readback after Reset double-click');
    const events = await page.evaluate(() => window.__gg207KnownNegative.read());
    const clicks = events.filter(({ trusted, type }) => trusted && type === 'click');
    const after = await selected('e1').count() ? await toolbar() : null;
    const sameBurstReset = await burstReset.evaluate((el) => el.isConnected);
    await burstReset.dispose();
    const writes = result.puts.slice(offsets.writes);
    const history = await idleFingerprint(id);
    const active = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim());
    const modal = await page.getByRole('dialog', { name: /^Edit / }).count();
    checkpoint('Reset burst actual targets, toolbar and edit state', { events, clicks, after, sameBurstReset, writes, history, active, modal });
    check(clicks[0]?.buttonText === 'Reset route' && clicks[0]?.edgeTarget === 'e1' && clicks[0]?.detail === 1,
      'First trusted click must hit manual Reset on e1');
    const second = clicks.find((item) => item.detail === 2);
    check(second?.edgeTarget === 'e1', 'Second trusted click did not resolve to e1');
    if (!definitionOf(current).edges.some((edge) => edge.id === 'e1') && second.buttonText === 'Remove connection') {
      same(definitionOf(current), without(expectedAutomatic, 'e1'), 'Unexpected removal affected more than e1');
      const accepted = writes.map(({ status, ifMatch, body }) => ({ status, ifMatch, graph: body.definition }));
      check(accepted.length >= 1 && accepted.length <= 2 && accepted.every(({ status }) => status === 200),
        'Captured reset/remove operations did not produce the expected accepted PUT count');
      same(accepted[0].ifMatch, '"' + restored.draftToken + '"', 'Unexpected removal starts at exact token');
      same(accepted.at(-1).graph, definitionOf(current), 'Unexpected removal PUT and persisted graph agree');
      await checkUndoLabel('remove edge work to done');
      return 'REPRODUCED_RESET_DOUBLECLICK_REMOVES_CONNECTION';
    }
    const hitAfter = await resetAt(chosen.point);
    same(definitionOf(current), expectedAutomatic, 'Reset burst must change only manual geometry');
    same(writes.map(({ status, ifMatch, body }) => [status, ifMatch, body.definition]),
      [[200, '"' + restored.draftToken + '"', expectedAutomatic]], 'Exactly one conditional geometry-only PUT');
    same(modal, 0, 'Reset burst opens no node editor');
    await checkUndoLabel('reset route of work to done');
    check(second.buttonText === 'Reset route' && second.buttonTarget === clicks[0].buttonTarget,
      'Second click must hit the same retained Reset DOM button');
    check(hitAfter.hits && after?.reset?.ariaDisabled === 'true' && !after.reset.disabled && after.reset.tabIndex >= 0 &&
      sameBurstReset && sameReset && singleHold.reset?.ariaDisabled === 'true' && !fresh.reset,
      'Held Reset must be the same, focusable aria-disabled element until deselection or manual return');
    same([after.anchor, after.viewport], [before.anchor, before.viewport], 'Hold must retain toolbar transform and viewport');
    for (const control of ['reset', 'remove']) {
      for (const dimension of ['x', 'y', 'width', 'height']) {
        check(Math.abs(after[control].box[dimension] - before[control].box[dimension]) < 0.75,
          'Held toolbar changed ' + control + ' ' + dimension);
      }
    }

    const removePoint = await buttonHit('e1');
    const removed = await edit(id, current, () => clickAt(removePoint), 'deliberate unique Remove from held automatic toolbar');
    same(definitionOf(removed), without(expectedAutomatic, 'e1'), 'Deliberate Remove must touch only e1');
    await checkUndoLabel('remove edge work to done');
    await assertUndoFocus();
    const automatic = await edit(id, removed, undo, 'first Undo restores only deliberate automatic edge removal');
    same(definitionOf(automatic), expectedAutomatic, 'First Undo restores automatic edge');
    same(automatic.draftToken, current.draftToken, 'First Undo restores automatic token');
    await checkUndoLabel('reset route of work to done');
    const again = await edit(id, automatic, undo, 'second Undo restores the exact original manual route');
    same(definitionOf(again), definitionOf(baseline), 'Second Undo restores exact manual graph');
    same(again.draftToken, baseline.draftToken, 'Second Undo restores exact manual token');
    if (!(await selected('e1').count())) await selectEdge('e1');
    const control = await toolbar();
    check(control.reset && control.reset.ariaDisabled !== 'true', 'Manual route reinstates genuine Reset');
    const offset = (await page.evaluate(() => window.__gg207KnownNegative.read())).length;
    const modifier = await edit(id, again, () => reset.click({ ...wait, modifiers: ['Control'] }), 'genuine Control-Reset');
    same(definitionOf(modifier), expectedAutomatic, 'Control-Reset changes only geometry');
    const modifierEvents = (await page.evaluate(() => window.__gg207KnownNegative.read())).slice(offset);
    const modifierHold = await toolbar();
    checkpoint('modified Reset retained the deliberate edge selection and hold', { modifierEvents, modifierHold });
    check(modifierEvents.some((event) => event.trusted && event.control && event.type === 'click' &&
      event.buttonText === 'Reset route' && event.edgeTarget === 'e1') && modifierHold.reset?.ariaDisabled === 'true',
      'Control-Reset did not retain selection and the unavailable automatic Reset');
    const done = await edit(id, modifier, undo, 'Undo genuine Control-Reset');
    same(definitionOf(done), definitionOf(baseline), 'Control-Reset Undo exact graph');
    same(done.draftToken, baseline.draftToken, 'Control-Reset Undo exact token');
    return 'PASS_RESET_BURST_HELD_WITH_DELIBERATE_REMOVE_AND_UNDO';
  }


  async function nodeDrag() {
    const fixture = await create('Corrected rapid Control node drag');
    const { id } = fixture;
    await open(fixture);
    const before = await durable(id, 'node drag baseline', { initial: true });
    await selectEdge('e1');
    await monitorDrag('e1');
    const header = card('other').getByText('Other terminal', { exact: true });
    const rect = await header.boundingBox();
    check(rect, 'Unrelated node header missing');
    const from = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const to = { x: from.x - 36, y: from.y - 35 };
    await header.evaluate((element, point) => {
      const hit = document.elementFromPoint(point.x, point.y);
      if (hit !== element && !element.contains(hit)) throw new Error('Unrelated node drag press is intercepted');
    }, from);
    const cdp = await page.context().newCDPSession(page);
    const mouse = (type, point, button, buttons, count) => ({
      type, x: point.x, y: point.y, modifiers: 2, button, buttons,
      ...(count === undefined ? {} : { clickCount: count }),
    });
    const send = (params) => cdp.send('Input.dispatchMouseEvent', params);
    const writeStart = result.puts.length;
    let pressed = false;
    await page.keyboard.down('Control');
    try {
      await send(mouse('mouseMoved', from, 'none', 0));
      await send(mouse('mousePressed', from, 'left', 1, 1));
      pressed = true;
      for (let step = 1; step <= 6; step += 1) {
        await send(mouse('mouseMoved', {
          x: from.x + (to.x - from.x) * (step / 6),
          y: from.y + (to.y - from.y) * (step / 6),
        }, 'left', 1));
      }
      const point = await buttonHit('e1', { allowUnavailable: true });
      same(point.ariaDisabled, 'true', 'Moved mouse node drag kept Remove available');
      same(point.disabled, false, 'Unavailable node-drag button lost its native hit target');
      const batch = [
        mouse('mouseReleased', to, 'left', 0, 1),
        mouse('mouseMoved', point, 'none', 0),
        mouse('mousePressed', point, 'left', 1, 1),
        mouse('mouseReleased', point, 'left', 0, 1),
      ];
      const dispatched = await Promise.allSettled(batch.map(send));
      pressed = dispatched[3].status !== 'fulfilled';
      checkpoint('rapid CDP frame dispatch', { from, to, point, batch, dispatched: dispatched.map((item) =>
        item.status === 'fulfilled' ? item : { status: item.status, reason: String(item.reason) }) });
      check(dispatched.every((item) => item.status === 'fulfilled'), 'A CDP frame was rejected');
    } finally {
      if (pressed) await send(mouse('mouseReleased', to, 'left', 0, 1)).catch(() => undefined);
      await page.keyboard.up('Control');
      await cdp.detach();
    }

    const readyOrGone = await page.waitForFunction(() => {
      const edge = document.querySelector('.react-flow__edge[data-id="e1"]');
      if (!edge) return { alreadyRemoved: true };
      const button = [...edge.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Remove connection');
      if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
      if ((window.__on ?? []).some((item) => item.type === 'click' && item.name === 'drag' && (item.options === true || item.options?.capture))) return false;
      const rect = button.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (!button.contains(document.elementFromPoint(x, y))) return false;
      return { x, y };
    }, null, wait);
    const ready = await readyOrGone.jsonValue();
    await readyOrGone.dispose();
    if (!ready.alreadyRemoved) await clickAt(ready);
    await saveState('All changes saved').waitFor(wait);
    await waitDebounce();
    const after = await durable(id, 'post-node-drag first available Remove final state');
    const trace = await page.evaluate(() => ({
      events: window.__gg207KnownNegative.read(), remaining: window.__gg207KnownNegative.d3(),
    }));
    checkpoint('trusted drag and selected connection timeline', { ...trace, readiness: ready });
    const release = trace.events.find((event) => event.type === 'mouseup' && event.trusted &&
      event.d3.some((item) => item.type === 'mouseup') && event.buttonTarget === null);
    check(release, 'No trusted D3 node release observed');
    const clicks = trace.events.filter((event) => event.type === 'click' && event.trusted && event.at >= release.at);
    const dragOwn = clicks.find((event) => event.buttonTarget === null && event.d3.some(
      (item) => item.type === 'click' && item.capture && item.passive === false));
    check(dragOwn && dragOwn.after && !dragOwn.reachedDocument && dragOwn.selected &&
      dragOwn.ariaDisabled === 'true' && dragOwn.gesture, 'Drag-produced suppressed click lacks real unavailable gate witness');
    const buttonClicks = clicks.filter((event) => event.actualRemove && event.buttonTarget === event.actualRemove);
    check(buttonClicks.length, 'No genuine action hit the selected connection button');
    for (const event of buttonClicks.filter((item) => item.d3.some((entry) => entry.type === 'click' && entry.capture))) {
      check(event.selected && event.ariaDisabled === 'true' && event.gesture && event.after &&
        !event.reachedDocument, 'D3 canceled a toolbar click while it appeared available');
    }
    const allowed = buttonClicks.filter((event) => event.ariaDisabled !== 'true' && !event.disabled);
    same(allowed.length, 1, 'Exactly one trusted Remove click was available');
    check(allowed[0].reachedDocument && !allowed[0].after && !allowed[0].d3.some((item) => item.type === 'click' && item.capture),
      'First available Remove did not reach the action uncanceled');
    const downs = trace.events.filter((event) => event.type === 'pointerdown' && event.trusted &&
      event.at > release.at && event.buttonTarget === allowed[0].actualRemove);
    check(downs.some((down) => down.at <= allowed[0].at), 'The allowed click had no independent real button press');
    checkpoint('gate, D3 suppression, and first allowed action', { release, dragOwn, buttonClicks, allowed: allowed[0] });

    const oldNode = definitionOf(before).nodes.find((item) => item.id === 'other');
    const newNode = definitionOf(after).nodes.find((item) => item.id === 'other');
    check(canon(newNode.ui) !== canon(oldNode.ui), 'Unrelated node move did not persist');
    const moved = structuredClone(definitionOf(before));
    moved.nodes.find((item) => item.id === 'other').ui = newNode.ui;
    same(definitionOf(after), without(moved, 'e1'), 'Allowed Remove or drag changed an unintended record');
    const writes = result.puts.slice(writeStart);
    check(writes.length >= 1 && writes.length <= 2 && writes.every((entry) => entry.status === 200), 'Unexpected autosave count');
    same(writes[0].ifMatch, '"' + before.draftToken + '"', 'Original token used for first mutation');
    same(writes.at(-1).body.definition, definitionOf(after), 'Final PUT contains exact full graph');
    if (writes.length === 2) same(writes[0].body.definition, moved, 'Separate first PUT is node-move only');
    await checkUndoLabel('remove edge work to done');
    const undoRemoval = await edit(id, after, undo, 'Undo only Remove after node drag');
    same(definitionOf(undoRemoval), moved, 'First Undo must leave moved geometry untouched');
    await checkUndoLabel('move other');
    const undoDrag = await edit(id, undoRemoval, undo, 'Undo only the node drag');
    same(definitionOf(undoDrag), definitionOf(before), 'Second Undo restores exact original graph and route');
    same(undoDrag.draftToken, before.draftToken, 'Second Undo restores original content token');
    return 'PASS_NODE_DRAG_GATE_AND_FIRST_AVAILABLE_REMOVE';
  }


  try {
    check(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) && !/:474[78]$/.test(origin), 'Refused owner or nonfixture address');
    check(/^\/app\/assets\/index-[\w-]+\.js$/.test(bundle ?? ''), 'Current bound main bundle required');
    const health = await page.request.get(origin + '/healthz', { timeout: 5000 });
    same(health.status(), 200, 'Compiled disposable gateway health');
    same(health.headers()['x-graphgoblin-pid'], gatewayPid, 'Fixture gateway identity');

    const cases = { duplicate, reload: reloadReplacement, hidden: hiddenSelection, 'script-geometry': scriptAndGeometry, 'node-drag': nodeDrag, 'reset-doubleclick': resetDoubleClick };
    check(Object.hasOwn(cases, scenario), 'Unknown bounded fixture');
    result.outcome = await cases[scenario]();
    check(result.bundleResponses.some((entry) => entry.status === 200), 'Expected candidate JS did not load');
    check(result.pageErrors.length === 0, 'Browser emitted unhandled page errors');
  } catch (error) {
    result.failure = { message: String(error), stack: error.stack };
    if (['node-drag', 'reset-doubleclick'].includes(scenario)) {
      try { result.partialTrace = await page.evaluate(() => window.__gg207KnownNegative?.read() ?? []); }
      catch (traceError) { result.traceFailure = String(traceError); }
    }
  }
  return result;
}

