async (page) => {
  // EXPLORATORY PROBE (not a measurement fixture): learns selectors, header structure and
  // state labels of the built UI before the measurement drivers are written.
  const initial = new URL(page.url());
  const origin = initial.origin;
  const out = { suite: 'probe-ui', origin, config: initial.searchParams.get('qa-config'), steps: [], requests: [], failure: null };
  const t0 = Date.now();
  page.on('request', (r) => { const u = new URL(r.url()); if (u.origin === origin && !u.pathname.startsWith('/app/')) out.requests.push({ t: Date.now() - t0, m: r.method(), p: u.pathname }); });
  const same = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m + ' ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b)); };
  async function api(method, path, status, data) {
    const r = await page.request.fetch(origin + path, { method, timeout: 10000, ...(data === undefined ? {} : { data }) });
    const body = await r.json();
    same(r.status(), status, method + ' ' + path + ' ' + JSON.stringify(body).slice(0, 300));
    return body;
  }
  const node = (id, kind, label, x, y, config) => ({ id, kind, label, ui: { x, y }, config });
  const graph = { schemaVersion: 4, name: 'Probe history ' + crypto.randomUUID().slice(0, 6),
    nodes: [node('start', 'trigger', 'Manual entry', 0, 120, { type: 'manual' }),
      node('work', 'mutate', 'Note', 300, 120, { operations: [{ op: 'append-message', role: 'note', content: 'probe' }] }),
      node('done', 'exit', 'Finished', 620, 120, { outcome: 'success', returns: '"ok"' })],
    edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'work', port: 'in' } },
      { id: 'e2', from: { node: 'work', port: 'out' }, to: { node: 'done', port: 'in' } }] };
  try {
    const id = (await api('POST', '/loops', 201, { definition: graph })).loop.id;
    await page.goto(origin + '/app/loops/' + id + '/edit');
    await page.getByRole('heading', { name: graph.name, exact: true }).waitFor({ timeout: 9000 });
    await page.getByText('The editor is available. Checking the server and this device before saving changes.', { exact: true })
      .waitFor({ state: 'hidden', timeout: 9000 });
    const dump = () => page.evaluate(() => {
      const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
      const header = document.querySelector('header[class*="border-b"][class*="z-\\[3\\]"]') || document.querySelectorAll('header')[1];
      const undo = document.querySelector('[data-history=undo]'), redo = document.querySelector('[data-history=redo]');
      const cs = (el) => { if (!el) return null; const c = getComputedStyle(el); return { translate: c.translate, transform: c.transform, transition: c.transitionProperty + ' ' + c.transitionDuration, width: c.width, height: c.height }; };
      const kids = header ? Array.from(header.children).map((c) => ({ tag: c.tagName, cls: (c.getAttribute('class') || '').slice(0, 60), text: (c.textContent || '').trim().slice(0, 60), box: box(c), kids: c.tagName === 'DIV' ? Array.from(c.children).map((k) => ({ tag: k.tagName, text: (k.textContent || '').trim().slice(0, 40), box: box(k) })) : undefined })) : null;
      return {
        w: innerWidth, h: innerHeight, pointerCoarse: matchMedia('(pointer: coarse)').matches, pointerFine: matchMedia('(pointer: fine)').matches,
        anyCoarse: matchMedia('(any-pointer: coarse)').matches, hover: matchMedia('(hover: hover)').matches, dark: matchMedia('(prefers-color-scheme: dark)').matches,
        rootFont: getComputedStyle(document.documentElement).fontSize, dpr: devicePixelRatio, online: navigator.onLine,
        scroll: { y: scrollY, sh: document.scrollingElement.scrollHeight, ch: document.scrollingElement.clientHeight },
        undo: box(undo), redo: box(redo), undoCs: cs(undo), redoCs: cs(redo),
        undoAttrs: undo && Object.fromEntries(Array.from(undo.attributes).map((a) => [a.name, a.value])),
        redoAttrs: redo && Object.fromEntries(Array.from(redo.attributes).map((a) => [a.name, a.value])),
        save: document.querySelector('[data-testid=save-state]')?.textContent, header: box(header), kids,
        statusRoles: Array.from(document.querySelectorAll('[role=status]')).map((e) => ({ text: (e.textContent || '').trim().slice(0, 100), box: box(e) })),
        nodes: document.querySelectorAll('.react-flow__node').length,
        frame: box(document.querySelector('[class*="h-\\[calc(100dvh"]')),
      };
    });
    out.steps.push({ step: 'opened', dump: await dump() });
    await page.waitForTimeout(1200);
    out.steps.push({ step: 'opened+1200', dump: await dump() });
    // Add nodes by the palette rail/panel.
    for (const kind of ['Script', 'Mutate', 'Wait']) {
      const button = page.getByRole('button', { name: 'Add ' + kind + ' node', exact: true }).first();
      await button.click({ timeout: 9000 });
      await page.waitForTimeout(100);
      out.steps.push({ step: 'added ' + kind + ' +100ms', dump: await dump() });
      await page.waitForTimeout(1500);
      out.steps.push({ step: 'added ' + kind + ' +1600ms', dump: await dump() });
    }
    await page.screenshot({ path: 'probe-after-adds.png', animations: 'disabled' });
    // Publish state.
    const publish = page.getByRole('button', { name: 'Publish', exact: true });
    out.steps.push({ step: 'publish button', count: await publish.count(), disabled: await publish.isDisabled().catch(() => null) });
  } catch (error) { out.failure = { message: String(error), stack: error.stack }; }
  return out;
}
