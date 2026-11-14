async (page) => {
  const address = new URL(page.url());
  const origin = address.origin;
  const mode = address.searchParams.get('qa-mode');
  const outcomes = [], checkpoints = [], browser = [], pageErrors = [], problems = [];
  const suffix = crypto.randomUUID().slice(0, 8);
  let target;
  let active;
  let releaseOne;

  function assert(condition, reason) {
    if (!condition) throw new Error(reason);
  }
  function canon(x) {
    return JSON.stringify(x, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]]))
      : v);
  }
  function exact(actual, expected, reason) {
    assert(canon(actual) === canon(expected),
      reason + '\nexpected ' + canon(expected) + '\nactual ' + canon(actual));
  }
  function latch() {
    let open;
    const waiting = new Promise((resolve) => { open = resolve; });
    return { open, waiting };
  }
  async function api(method, path, expected, body) {
    const res = await page.request.fetch(origin + path, { method, timeout: 8000,
      ...(body === undefined ? {} : { data: body }) });
    const data = await res.json();
    exact(res.status(), expected, method + ' ' + path);
    return data;
  }
  const list = async () => (await api('GET', '/loops', 200)).items;
  const detail = (id) => api('GET', '/loops/' + id, 200);
  const graph = ({ name, ...definition }) => definition;
  const ids = (rows) => rows.map((item) => item.id).sort();
  const initial = (tag, name) => ({
    schemaVersion: 4, name, description: 'Independent import graph ' + tag + ' ' + suffix,
    nodes: [
      { id: 'trigger' + tag, kind: 'trigger', label: tag + ' start', ui: { x: 0, y: 90 }, config: { type: 'manual' } },
      { id: 'exit' + tag, kind: 'exit', label: tag + ' leaf', ui: { x: 290, y: 90 },
        config: { returns: JSON.stringify('result unique to graph ' + tag + ' ' + suffix) } },
    ],
    edges: [{ id: 'edge' + tag, from: { node: 'trigger' + tag, port: 'out' }, to: { node: 'exit' + tag, port: 'in' } }],
  });
  function observe(target, scenario) {
    target.on('pageerror', (error) => pageErrors.push({ scenario, error: String(error) }));
    target.on('request', (req) => {
      const u = new URL(req.url());
      if (u.pathname !== '/loops/import' || req.method() !== 'POST') return;
      browser.push({ scenario, at: Date.now(), body: req.postDataJSON(), queryName: u.searchParams.get('name') });
    });
  }
  function response(target, expectedGraph, retryName) {
    return target.waitForResponse((res) => {
      const req = res.request();
      const path = new URL(req.url());
      if (path.pathname !== '/loops/import' || req.method() !== 'POST') return false;
      if (retryName !== undefined) return path.searchParams.get('name') === retryName;
      return !path.searchParams.has('name') &&
        req.postDataJSON()?.loop?.nodes?.[0]?.id === expectedGraph.loop.nodes[0].id;
    }, { timeout: 12000 });
  }
  const picker = (t) => t.getByLabel('Import an exported loop (JSON)', { exact: true });
  const retry = (t) => t.getByRole('region', { name: 'Import under another name', exact: true });
  const retryName = (t) => retry(t).getByRole('textbox', { name: 'Name for the imported loop', exact: true });
  function setFile(t, fileName, exported) {
    return picker(t).setInputFiles({ name: fileName, mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(exported), 'utf8') });
  }

  async function snapshot(t, stage) {
    const value = await t.evaluate(() => {
      const input = document.querySelector('#import-loop');
      const panel = document.querySelector('[aria-label="Import under another name"]');
      const field = panel?.querySelector('input');
      return {
        path: location.pathname,
        pickerAriaDescription: (input?.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? null),
        pickerDisabled: input?.disabled ?? null,
        panel: panel?.innerText ?? null,
        name: field?.value ?? null,
        nameFocused: field === document.activeElement,
        result: document.querySelector('#import-loop-result')?.innerText ?? null,
      };
    });
    checkpoints.push({ active, stage, ...value });
    return value;
  }
  async function finishReact(t) {
    // Give real fetch and React callbacks a bounded observation window after HTTP delivery.
    await t.evaluate(() => new Promise((done) => setTimeout(done, 400)));
  }
  function holdRealResponse(t, doc) {
    const intercepted = latch(), release = latch(), done = latch();
    const path = (url) => url.origin === origin && url.pathname === '/loops/import';
    let used = false;
    const handler = async (route) => {
      const req = route.request();
      if (used || req.method() !== 'POST' || new URL(req.url()).searchParams.has('name') ||
          req.postDataJSON()?.loop?.nodes?.[0]?.id !== doc.loop.nodes[0].id) {
        await route.fallback();
        return;
      }
      used = true;
      try {
        const upstream = await route.fetch({ timeout: 10000, maxRetries: 0, maxRedirects: 0 });
        const body = await upstream.json();
        intercepted.open({ status: upstream.status(), body });
        await release.waiting;
        await route.fulfill({ response: upstream });
        await upstream.dispose();
        done.open({ ok: true });
      } catch (error) {
        const result = { error: String(error) };
        intercepted.open(result);
        done.open(result);
      }
    };
    return {
      install: () => t.route(path, handler),
      captured: async () => {
        const timeout = t.evaluate(() => new Promise((done) => setTimeout(() => done({ timeout: true }), 11000)));
        const result = await Promise.race([intercepted.waiting, timeout]);
        assert(!(result.timeout || result.error), 'A upstream response was not captured: ' + canon(result));
        return result;
      },
      release: async () => { release.open(); return done.waiting; },
      close: async () => { release.open(); await t.unroute(path, handler).catch(() => {}); },
    };
  }

  async function scenario(oldSuccess) {
    active = oldSuccess ? 'late success while the newer import conflict remains actionable' :
      'late conflict after the newer import name is displayed and edited';
    const key = oldSuccess ? 'Success' : 'Conflict';
    const aDefinition = initial('A' + key, 'Archived import A ' + key + ' ' + suffix);
    const bDefinition = initial('B' + key, 'Visible import B ' + key + ' ' + suffix);
    const aFile = 'prior-A-' + key.toLowerCase() + '.json';
    const bFile = 'selected-B-' + key.toLowerCase() + '.json';
    const aSource = await api('POST', '/loops', 201, { definition: aDefinition });
    const bSource = await api('POST', '/loops', 201, { definition: bDefinition });
    const a = await api('GET', '/loops/' + aSource.loop.id + '/export?draft=true', 200);
    const b = await api('GET', '/loops/' + bSource.loop.id + '/export?draft=true', 200);
    if (oldSuccess) {
      // Archive the original A export, then free its name through the ordinary conditional API.
      const old = await detail(aSource.loop.id);
      const renamed = await page.request.put(origin + '/loops/' + aSource.loop.id + '/draft', {
        data: { definition: { ...old.draft.definition, name: 'Displaced source A ' + suffix } },
        headers: { 'if-match': '"' + old.draftToken + '"' }, timeout: 8000,
      });
      exact(renamed.status(), 200, 'A original name was released before import');
    }
    const before = await list();
    const originA = await detail(aSource.loop.id);
    const originB = await detail(bSource.loop.id);
    target = await page.context().newPage();
    await target.setViewportSize({ width: 1280, height: 900 });
    observe(target, key);
    const held = holdRealResponse(target, a);
    releaseOne = held.close;
    await held.install();
    await target.goto(origin + '/app/loops');
    await setFile(target, aFile, a);
    const offscreen = await held.captured();
    exact(offscreen.status, oldSuccess ? 201 : 409, 'A response obtained from actual server');
    if (!oldSuccess) exact(offscreen.body.code, 'LOOP_NAME_CONFLICT', 'A real name collision');
    const acceptedOrNotYetVisible = await list();
    if (oldSuccess) {
      assert(!ids(before).includes(offscreen.body.loop.id), 'A accepted an independent row');
      exact(graph((await detail(offscreen.body.loop.id)).draft.definition), graph(a.loop), 'A is already committed');
    } else exact(ids(acceptedOrNotYetVisible), ids(before), 'Held A refusal did not mutate store');

    assert(await picker(target).isEnabled(), 'A pending request blocked newest file choice');
    const bError = response(target, b);
    await setFile(target, bFile, b);
    const bReply = await bError;
    const bProblem = await bReply.json();
    exact(bReply.status(), 409, 'B gets the real name refusal');
    exact(bProblem.code, 'LOOP_NAME_CONFLICT', 'B collision code');
    await retry(target).getByText(bFile + ' was not imported', { exact: true }).waitFor({ timeout: 7000 });
    exact(await retryName(target).inputValue(), bProblem.suggestedName, 'B field shows B suggestion');
    const explicitName = bProblem.suggestedName + ' kept for B';
    await retryName(target).fill(explicitName);
    const pendingName = await retryName(target).inputValue();
    exact(pendingName, explicitName, 'User-entered B name is established');
    const whileB = await snapshot(target, 'B visible before A finishes');
    assert(whileB.pickerAriaDescription.includes(bFile), 'Picker accessible description did not name B');

    const aBrowser = response(target, a);
    const release = await held.release();
    assert(release.ok, 'Held A failed to reach the browser: ' + canon(release));
    exact((await aBrowser).status(), offscreen.status, 'A late browser response delivered unchanged');

    await finishReact(target);
    const afterA = await snapshot(target, 'after actual older A reply reached browser');
    assert(afterA.pickerAriaDescription.includes(bFile), 'Picker stopped reporting latest selected file');
    await target.screenshot({ path: mode + '-' + key.toLowerCase() + '-after-a.png', animations: 'disabled' });

    assert(afterA.panel?.includes(bFile + ' was not imported'), 'Late A did not preserve newer B form');
    assert(!afterA.panel?.includes(aFile), 'Newer B form was overwritten by the earlier A result');
    exact(afterA.name, explicitName, 'Authored B retry name after late A');
    assert(!afterA.result?.includes(offscreen.body.loop?.name ?? aFile),
      'Older A rendered its success as the active B attempt outcome');
    if (oldSuccess) {
      const oldRow = target.locator('tr').filter({ has: target.getByRole('link', { name: offscreen.body.loop.name, exact: true }) });
      await oldRow.getByRole('link', { name: offscreen.body.loop.name, exact: true }).waitFor({timeout: 7000});
      const href = await oldRow.getByRole('link', { name: offscreen.body.loop.name, exact: true }).getAttribute('href');
      exact(href, '/app/loops/' + offscreen.body.loop.id + '/edit', 'Stale success reconciled the actual row independently of B');
    }
    const beforeRetry = browser.filter((record) => record.scenario === key);
    exact(beforeRetry.map(({ queryName }) => queryName), [null, null],
      'Replacing an earlier selection did not send any implicit retry');
    const posted = response(target, null, explicitName);
    await retry(target).getByRole('button', { name: 'Import as new loop', exact: true }).click();
    const created = await posted;
    const body = await created.json();
    const request = created.request().postDataJSON();
    exact(created.status(), 201, 'Explicit browser retry persisted');
    exact(body.loop.name, explicitName, 'Persisted the exact B retry name');
    const stored = await detail(body.loop.id);
    exact(request, b, 'Retry retained the exact latest document B');
    exact(graph(stored.draft.definition), graph(b.loop), 'Real SQLite graph matches the POSTed exact document');
    assert(canon(graph(stored.draft.definition)) !== canon(graph(a.loop)), 'Candidate saved the earlier A graph');
    const now = await list();
    const admittedOlder = oldSuccess ? [offscreen.body.loop] : [];
    exact(ids(now), ids([...before, ...admittedOlder, body.loop]), 'No extra or overwritten loop IDs');
    exact(await detail(aSource.loop.id), originA, 'Original source A is unchanged');
    exact(await detail(bSource.loop.id), originB, 'Original source B is unchanged');
    outcomes.push({ active, correct: true, a: offscreen, bProblem, whileB, afterA,
      explicitName, request, stored, expectedSource: 'B' });
  }

  try {
    assert(/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(origin) && !/:474[78]$/.test(origin), 'Refused origin');
    assert(mode === 'candidate', 'Use candidate mode only with freshly bound corrected build');
    for (const oldSuccess of [false, true]) {
      try {
        await scenario(oldSuccess);
      } catch (error) {
        problems.push({ active, error: String(error), stack: error.stack });
        await target?.screenshot({ path: mode + (oldSuccess ? '-success' : '-conflict') + '-first-failure.png',
          animations: 'disabled' }).catch(() => {});
      } finally {
        await releaseOne?.();
        await target?.close().catch(() => {});
        target = undefined;
        releaseOne = undefined;
      }
    }
    exact(pageErrors, [], 'Unexpected page errors');
  } catch (error) {
    problems.push({ active, error: String(error), stack: error.stack });
  }
  return { suite: 'import-selection-209-correction', mode, origin, outcomes, checkpoints, browser, pageErrors, problems };
}
