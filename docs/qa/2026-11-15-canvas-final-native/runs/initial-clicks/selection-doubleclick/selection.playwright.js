async (page) => {
  const url = new URL(page.url());
  const origin = url.origin;
  const scenario = url.searchParams.get('case');
  const bundle = url.searchParams.get('bundle');
  const gatewayPid = url.searchParams.get('gatewayPid');
  const wait = { timeout: 9000 };
  const result = { suite: '207-selection-doubleclick-corrected', scenario, origin, gatewayPid, bundle, checkpoints: [], pageErrors: [], puts: [], bundleResponses: [] };
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

  function specimen(name) {
    return {
      schemaVersion: 4,
      name,
      nodes: [
        node('start', 'trigger', 'Fixture start', 100, 145, { type: 'manual' }),
        node('work', 'mutate', 'Lower action', 790, 545, {
          operations: [{ op: 'append-message', role: 'note', content: 'Fixture control' }],
        }),
        node('done', 'exit', 'Fixture success', 1150, 565, { outcome: 'success' }),
      ],
      edges: [
        edge('e1', 'start', 'out', 'work'),
        edge('control', 'work', 'out', 'done'),
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

  async function selectEdge(id, send = clickAt) {
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
    await send(point);
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

  async function peek(point) {
    return page.evaluate(({ x, y }) => {
      const hit = document.elementFromPoint(x, y);
      const connection = hit?.closest('.react-flow__edge');
      return {
        tag: hit?.tagName ?? null, class: hit?.getAttribute('class') ?? null,
        button: hit?.closest('button')?.textContent.trim() ?? null,
        edge: connection?.dataset.id ?? null,
        node: hit?.closest('.react-flow__node')?.dataset.id ?? null,
        pane: hit?.matches('.react-flow__pane') ?? false,
        selection: connection?.classList.contains('selected') ?? false,
        viewport: document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? null,
        elements: document.elementsFromPoint(x, y).slice(0, 8).map((node) => ({ tag: node.tagName, class: node.getAttribute('class'), edge: node.closest('.react-flow__edge')?.dataset.id ?? null })),
      };
    }, point);
  }

  async function deselect(send = clickAt) {
    const at = await page.locator('.react-flow__pane').evaluate((pane) => {
      const r = pane.getBoundingClientRect();
      for (const y of [0.18, 0.35, 0.67, 0.82]) {
        for (const x of [0.2, 0.4, 0.65, 0.85]) {
          const point = { x: r.x + r.width * x, y: r.y + r.height * y };
          if (document.elementFromPoint(point.x, point.y) === pane) return point;
        }
      }
      return null;
    });
    check(at, 'No natural pane area to clear edge selection');
    await send(at);
    await assertSelectionCleared('e1', 'native pane deselection');
  }

  async function monitor() {
    await page.evaluate(() => {
      const raw = [];
      const events = [];
      const byEvent = new WeakMap();
      const identities = new WeakMap();
      let sequence = 0;
      const identity = (item) => { if (!item) return null; if (!identities.has(item)) identities.set(item, ++sequence); return identities.get(item); };
      const record = (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const edge = target?.closest('.react-flow__edge');
        const button = target?.closest('button');
        const entry = {
          type: event.type, trusted: event.isTrusted, at: performance.now(), eventTime: event.timeStamp,
          detail: event.detail, key: event.key ?? null, control: !!event.ctrlKey, meta: !!event.metaKey, shift: !!event.shiftKey, alt: !!event.altKey,
          x: event.clientX, y: event.clientY, screenX: event.screenX, screenY: event.screenY,
          pointerType: event.pointerType ?? null, buttonState: event.buttons,
          targetKey: identity(target), target: target?.tagName, classes: target?.getAttribute('class'),
          path: event.composedPath().slice(0, 10).map(identity),
          button: button?.textContent.trim() ?? null,
          disabled: button?.disabled ?? null, ariaDisabled: button?.getAttribute('aria-disabled') ?? null,
          edge: edge?.dataset.id ?? null, edgeSelected: edge?.classList.contains('selected') ?? false,
          node: target?.closest('.react-flow__node')?.dataset.id ?? null,
          pane: target?.matches('.react-flow__pane') ?? false,
          clickBlocker: (window.__on ?? []).some((item) => item.name === 'drag' && item.type === 'click'),
          before: event.defaultPrevented, reachedDocument: false,
        };
        events.push(entry);
        raw.push(event);
        byEvent.set(event, entry);
      };
      for (const type of ['pointermove', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend', 'keydown', 'keyup']) {
        window.addEventListener(type, record, { capture: true, passive: true });
        document.addEventListener(type, (event) => {
          const old = byEvent.get(event);
          if (old) old.reachedDocument = true;
        }, { capture: true, passive: true });
      }
      window.__gg207SelectionProbe = () => events.map((entry, i) => ({ ...entry, after: raw[i].defaultPrevented }));
    });
  }
  const trace = () => page.evaluate(() => window.__gg207SelectionProbe());

  async function osDoubleClick(point, expectedHit) {
    const endpoint = url.searchParams.get('ownedMouseEndpoint');
    const key = url.searchParams.get('ownedMouseKey');
    const marker = url.searchParams.get('ownedMouseMarker');
    if (!/^http:\/\/127\.0\.0\.1:\d+\/mouse$/.test(endpoint ?? '') ||
        !/^[a-f0-9]{48}$/.test(key ?? '') || !/^GG207 Owned [a-f0-9]{32}$/.test(marker ?? ''))
      return { limited: 'DISPOSABLE_CONTROLLER_NOT_ADMITTED' };
    const browser = page.context().browser();
    if (!browser) return { limited: 'BROWSER_PROCESS_ID_UNAVAILABLE' };
    let session;
    let browserPid;
    try {
      session = await browser.newBrowserCDPSession();
      const { processInfo } = await session.send('SystemInfo.getProcessInfo');
      const owners = processInfo.filter(({ type, id }) => type === 'browser' && Number.isSafeInteger(id) && id > 0);
      if (owners.length !== 1) return { limited: 'BROWSER_PROCESS_ID_UNAVAILABLE' };
      browserPid = owners[0].id;
    } catch (error) {
      return { limited: 'BROWSER_PROCESS_ID_UNAVAILABLE', detail: String(error) };
    } finally {
      await session?.detach();
    }

    await page.evaluate((marker) => { document.title = marker; }, marker);
    await page.bringToFront();
    const offset = (await trace()).length;
    await page.mouse.move(point.x, point.y);
    const read = async () => (await trace()).slice(offset).filter(({ trusted, type, pointerType }) =>
      trusted && type === 'pointermove' && pointerType === 'mouse');
    const movement = (await read()).at(-1);
    const metrics = await page.evaluate(() => ({ dpr: devicePixelRatio, focused: document.hasFocus(),
      visible: document.visibilityState, width: screen.width, height: screen.height }));
    const screen = { x: movement?.screenX, y: movement?.screenY };
    if (!Number.isInteger(screen.x) || !Number.isInteger(screen.y) || screen.x < 0 || screen.y < 0 ||
        screen.x >= metrics.width || screen.y >= metrics.height || metrics.dpr !== 1 ||
        !metrics.focused || metrics.visible !== 'visible')
      return { limited: 'DESKTOP_GEOMETRY_OR_FOCUS_UNVERIFIED', movement, metrics, screen };
    async function command(stage) {
      const reply = await page.request.post(endpoint, { headers: { 'x-gg207-owned-mouse': key }, timeout: 19000,
        data: { stage, browserPid, screenX: screen.x, screenY: screen.y } });
      const record = await reply.json();
      const partial = record.operation?.presses?.find(({ requested, submitted }) => submitted !== requested);
      if (partial) {
        const limited = partial.submitted === 1 && partial.cleanupAccepted !== true ? 'PARTIAL_SEND_RELEASE_FAILED' : 'PARTIAL_SEND';
        return { ...record, limited };
      }
      if (!reply.ok() || record.operation?.limited) return { ...record, limited: 'WINDOW_OR_PROCESS_GUARD' };
      return record;
    }
    const moved = await command('move');
    if (moved.limited) return { limited: moved.limited, moved, screen, movement };
    let real = null;
    for (let i = 0; i < 4 && !real; i++) {
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done())));
      real = (await read()).find((entry) => entry.at > movement.at &&
        entry.screenX === screen.x && entry.screenY === screen.y &&
        Math.abs(entry.x - point.x) <= 1 && Math.abs(entry.y - point.y) <= 1 && entry.edge === 'e1');
    }
    const hit = await peek(point);
    const exactBrowserTarget = await page.evaluate((marker) =>
      document.hasFocus() && document.visibilityState === 'visible' && document.title === marker, marker);
    if (!real || !expectedHit(hit) || !exactBrowserTarget)
      return { limited: 'OS_POINTER_CALIBRATION_NOT_PROVEN', moved, screen, movement, real, hit, exactBrowserTarget };
    const clicked = await command('double');
    return { limited: clicked.limited ?? null, moved, clicked, screen, movement, real, hit };
  }

  async function nativeConcern() {
    const touch = scenario === 'selection-touch';
    const osMouse = scenario === 'selection-os-mouse';
    const fixture = await create('Automatic edge double click fixture');
    const { id } = fixture;
    const historical = { x: 478.9016, y: 474.8826 };
    await open(fixture, { settings: true });
    const base = await durable(id, 'public automatic baseline', { initial: true });
    const ready = await edit(id, base,
      () => page.getByLabel('Description', { exact: true }).fill('Disposable synced baseline for native pointer comparison.'),
      'establish exact synced baseline with one label edit');
    check(definitionOf(ready).edges.every((item) => item.ui === undefined), 'Expected an automatic edge fixture');
    const hide = page.getByRole('button', { name: 'Hide loop settings', exact: true });
    if (await hide.isVisible()) await hide.click(wait);
    await fit();
    const inputContext = await page.evaluate(() => ({ coarse: matchMedia('(pointer: coarse)').matches,
      anyCoarse: matchMedia('(any-pointer: coarse)').matches, maxTouchPoints: navigator.maxTouchPoints,
      width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
    checkpoint('actual input context', { inputContext });
    if (touch) check(inputContext.coarse && inputContext.maxTouchPoints > 0, 'Expected an actual coarse, touch-enabled context');

    await monitor();
    if (touch) await selectEdge('e1', (point) => page.touchscreen.tap(point.x, point.y));
    else await selectEdge('e1');
    const control = selected('e1').getByRole('button', { name: 'Remove connection', exact: true });
    await control.waitFor(wait);
    const future = await control.boundingBox();
    check(future && !(await page.getByRole('button', { name: 'Reset route', exact: true }).count()),
      'Fresh automatic selection has Remove alone');
    if (touch) check(future.height >= 43, 'Coarse Remove did not expose the expected height');
    const clear = () => deselect(touch ? (point) => page.touchscreen.tap(point.x, point.y) : clickAt);
    await clear();
    const path = allEdges('e1').locator('.react-flow__edge-path');
    const trackedHit = (hit) => hit.edge === 'e1' && hit.tag?.toLowerCase() === 'path' &&
      hit.class?.split(/\s+/).includes('react-flow__edge-interaction') && !hit.selection && hit.button === null;
    const sampled = await path.evaluate((line, box) => {
      const transform = line.getScreenCTM();
      const length = line.getTotalLength();
      if (!transform) return null;
      for (let i = 2; i < 599; i += 1) {
        const pathPoint = line.getPointAtLength(i * length / 600).matrixTransform(transform);
        const point = { x: Math.round(pathPoint.x), y: Math.round(pathPoint.y), fraction: i / 600 };
        const hit = document.elementFromPoint(point.x, point.y);
        if (hit?.classList.contains('react-flow__edge-interaction') &&
            hit.closest('.react-flow__edge')?.dataset.id === 'e1' &&
            point.x > box.x + 3 && point.x < box.x + box.width - 3 &&
            point.y > box.y + 3 && point.y < box.y + box.height - 3) return point;
      }
      return null;
    }, future);
    const historicalHit = await peek(historical);
    const historicalInside = historical.x > future.x + 3 && historical.x < future.x + future.width - 3 &&
      historical.y > future.y + 3 && historical.y < future.y + future.height - 3;
    const point = !touch && !osMouse && trackedHit(historicalHit) && historicalInside ? historical : sampled;
    checkpoint('candidate overlay geometry', { historical, historicalHit, historicalInside, future, sampled, point });
    check(point, 'Required live unselected e1 inside its actual later Remove box was not reachable');
    const initial = await peek(point);
    check(trackedHit(initial), 'First-target hit must be unselected e1 interaction path');
    const fingerprint = await idleFingerprint(id);
    const clickHere = () => touch ? page.touchscreen.tap(point.x, point.y) : clickAt(point);
    async function selectionState() {
      return page.evaluate(() => {
        const edge = document.querySelector('.react-flow__edge.selected[data-id="e1"]');
        const active = document.activeElement;
        const remove = Array.from(edge?.querySelectorAll('button') ?? []).find((item) => item.textContent.trim() === 'Remove connection');
        return { selected: !!edge, edgeFocused: edge === active, activeTag: active?.tagName ?? null,
          activeLabel: active?.getAttribute('aria-label') ?? active?.textContent?.trim().slice(0, 80) ?? null,
          enabled: !!remove && !remove.disabled && remove.getAttribute('aria-disabled') !== 'true',
          viewport: document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? null };
      });
    }
    const singleStart = (await trace()).length;
    await noWrite(id, fingerprint, clickHere, 'ordinary first press selects without an edit');
    const single = await selectionState();
    const promoted = await peek(point);
    checkpoint('actual first target and same point after selection', { initial, single, promoted, events: (await trace()).slice(singleStart) });
    check(single.selected && promoted.selection && promoted.button === 'Remove connection' && promoted.edge === 'e1',
      'Required same-point overlap did not promote Remove');
    if (!touch) check(single.edgeFocused, 'Ordinary pointer selection must focus e1');
    await clear();
    async function burst(label, action, expectedCounts, { controlKey = false } = {}) {
      const before = await peek(point);
      same(before, initial, 'Before burst actual target and viewport must match');
      const offset = { event: (await trace()).length, write: result.puts.length };
      const dispatch = await action();
      await saveState('All changes saved').waitFor(wait);
      await waitDebounce();
      const current = await durable(id, label + ' full graph and synced device');
      const writes = result.puts.slice(offset.write);
      const events = (await trace()).slice(offset.event);
      const clicks = events.filter((event) => event.trusted && event.type === 'click');
      const pointers = events.filter((event) => event.trusted && event.type === 'pointerdown');
      const after = await idleFingerprint(id);
      const selection = await selectionState();
      const hit = await peek(point);
      checkpoint(label, { before, dispatch: dispatch ?? null, events, clicks, pointers, writes, after, selection, hit });
      const removed = !definitionOf(current).edges.some((edge) => edge.id === 'e1');
      if (osMouse && dispatch?.limited?.startsWith('PARTIAL_SEND')) {
        return 'LIMITED_OS_MOUSE_' + dispatch.limited + (removed || writes.length ? '_DRAFT_CHANGED' : '');
      }
      if (removed) {
        same(definitionOf(current), without(definitionOf(ready), 'e1'), 'Unintended removal touched only e1');
        same(writes.map(({ ifMatch, status, body }) => [ifMatch, status, body.definition]),
          [['"' + ready.draftToken + '"', 200, definitionOf(current)]], 'Unexpected removal recorded one exact conditional PUT');
        await checkUndoLabel('remove edge start to work');
        return touch ? 'REPRODUCED_TOUCH_SEQUENCE_REMOVES_CONNECTION'
          : osMouse ? 'REPRODUCED_OS_MOUSE_SEQUENCE_REMOVES_CONNECTION'
          : 'REPRODUCED_SELECTION_MOUSE_SEQUENCE_REMOVES_CONNECTION';
      }
      same(after, fingerprint, label + ' preserves graph, API token, IndexedDB, history and save state');
      same(writes.length, 0, label + ' sends no PUT');
      if (osMouse && dispatch?.limited) return 'LIMITED_OS_MOUSE_' + dispatch.limited;
      const device = touch ? 'touch' : 'mouse';
      const classified = clicks.length === expectedCounts.length &&
        clicks.every((item, i) => item.detail === expectedCounts[i] && item.pointerType === device && item.reachedDocument) &&
        pointers.length === expectedCounts.length && pointers.every((item) => item.pointerType === device);
      if (!classified && touch) return 'LIMITED_TOUCH_BROWSER_CLASSIFICATION';
      if (!classified && osMouse) return 'LIMITED_OS_MOUSE_BROWSER_CLASSIFICATION';
      check(classified, label + ' missing required trusted counts or pointer sequence');
      check(clicks[0].edge === 'e1' && !clicks[0].edgeSelected && clicks[0].button === null &&
        clicks.slice(1).every((item) => item.edge === 'e1' && item.edgeSelected && item.button === 'Remove connection' &&
          item.disabled === false && item.ariaDisabled !== 'true' && !item.after && !item.clickBlocker),
        label + ' must exercise the enabled promoted Remove on every continuation');
      if (controlKey) check(clicks.every((item) => item.control), 'Control was not delivered on the actual click sequence');
      check(selection.selected && selection.edgeFocused && selection.enabled, 'Selection, edge focus and enabled Remove must survive');
      same(selection.viewport, initial.viewport, 'No viewport movement or zoom');
      same(await page.getByRole('dialog', { name: /^Edit / }).count(), 0, 'No node editor opens');
      return null;
    }

    if (touch) {
      const failure = await burst('real touch taps with no driver-supplied click counts', async () => {
        const cdp = await page.context().newCDPSession(page);
        try {
          for (let i = 0; i < 2; i++) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y }] });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          }
        } finally { await cdp.detach(); }
      }, [1, 2]);
      return failure ?? 'PASS_TOUCH_BROWSER_CLASSIFICATION';
    }
    if (osMouse) {
      const failure = await burst('owned headed Edge OS-injected double-click', () => osDoubleClick(point, trackedHit), [1, 2]);
      return failure ?? 'PASS_OS_MOUSE_BROWSER_CLASSIFICATION';
    }

    for (const count of [2, 3]) {
      const failure = await burst('CDP-numbered click sequence ' + count,
        () => page.mouse.click(point.x, point.y, { clickCount: count }), Array.from({ length: count }, (_, i) => i + 1));
      if (failure) return failure;
      await clear();
    }
    const modified = await burst('real Control with CDP-numbered double click', async () => {
      await page.keyboard.down('Control');
      try { await page.mouse.dblclick(point.x, point.y); }
      finally { await page.keyboard.up('Control'); }
    }, [1, 2], { controlKey: true });
    if (modified) return modified;
    await clear();

    async function removeAndUndo(label, action, inputCheck, key = null) {
      const start = (await trace()).length;
      const removed = await edit(id, ready, action, label);
      const events = (await trace()).slice(start);
      checkpoint(label + ' exact native action', { events });
      same(definitionOf(removed), without(definitionOf(ready), 'e1'), 'Deliberate removal touches only e1');
      check(events.some(inputCheck), label + ' lacked a trusted activation at its required count');
      if (key) check(events.some((event) => event.trusted && event.type === 'keydown' &&
        event.key === key && event.edge === 'e1' && event.button === 'Remove connection'),
        label + ' lacked a trusted keydown on Remove');
      await checkUndoLabel('remove edge start to work');
      await assertUndoFocus();
      const restored = await edit(id, removed, undo, 'one Undo restores the removed connection');
      same(definitionOf(restored), definitionOf(ready), 'Exact graph restored');
      same(restored.draftToken, ready.draftToken, 'Exact token restored');
      await assertSelectionCleared('e1', 'Undo after the intentional Remove');
    }
    const authenticRemoveClick = (detail) => (event) => event.trusted && event.type === 'click' &&
      event.edge === 'e1' && event.button === 'Remove connection' && event.detail === detail;
    await noWrite(id, fingerprint, clickHere, 'separate first count-one click at the original overlap');
    const atSamePoint = await peek(point);
    check(atSamePoint.edge === 'e1' && atSamePoint.button === 'Remove connection', 'Separate count-one target precheck');
    await removeAndUndo('separate count-one click at the same point', clickHere, authenticRemoveClick(1));
    await selectEdge('e1');
    const center = await buttonHit('e1');
    await removeAndUndo('separate count-one click at Remove center', () => clickAt(center), authenticRemoveClick(1));

    async function tabToRemove() {
      const trail = [];
      for (let i = 0; i <= 20; i++) {
        const active = await page.evaluate(() => {
          const item = document.activeElement;
          const owner = item?.closest('.react-flow__edge.selected')?.dataset.id;
          const name = item?.getAttribute('aria-label') ?? item?.textContent?.trim().slice(0, 70);
          const ready = item instanceof HTMLButtonElement && owner === 'e1' && name === 'Remove connection' &&
            !item.disabled && item.getAttribute('aria-disabled') !== 'true';
          return { name, owner, ready, tag: item?.tagName ?? null };
        });
        trail.push(active);
        if (active.ready) return { reached: true, trail };
        if (i < 20) await page.keyboard.press('Tab');
      }
      return { reached: false, trail };
    }
    for (const key of ['Enter', 'Space']) {
      await selectEdge('e1');
      const focus = await tabToRemove();
      checkpoint('natural keyboard focus path before ' + key, focus);
      if (!focus.reached) return 'LIMITED_KEYBOARD_REMOVE_UNREACHABLE';
      await removeAndUndo('native ' + key + ' emits detail zero', () => page.keyboard.press(key), authenticRemoveClick(0), key === 'Space' ? ' ' : 'Enter');
    }
    return 'PASS_SELECTION_COUNTS_FOCUS_AND_DELIBERATE_ACTIVATION';
  }


  try {
    check(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) && !/:474[78]$/.test(origin), 'Refused owner or nonfixture address');
    check(/^\/app\/assets\/index-[\w-]+\.js$/.test(bundle ?? ''), 'Current bound main bundle required');
    const health = await page.request.get(origin + '/healthz', { timeout: 5000 });
    same(health.status(), 200, 'Compiled disposable gateway health');
    same(health.headers()['x-graphgoblin-pid'], gatewayPid, 'Fixture gateway PID matches');
    check(['selection-doubleclick', 'selection-touch', 'selection-os-mouse'].includes(scenario), 'Bounded cases only');
    result.outcome = await nativeConcern();
    check(result.bundleResponses.some((entry) => entry.status === 200), 'Expected candidate JS did not load');
    same(result.pageErrors, [], 'No browser page errors');
  } catch (error) {
    result.failure = { message: String(error), stack: error.stack };
    try { result.partialTrace = await page.evaluate(() => window.__gg207SelectionProbe?.() ?? []); }
    catch (traceError) { result.traceFailure = String(traceError); }
  }
  return result;
}

