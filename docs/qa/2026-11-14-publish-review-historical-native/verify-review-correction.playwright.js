async (page) => {
  const url = new URL(page.url());
  const origin = url.origin;
  const targetGroup = url.searchParams.get('qa-group');
  const phase = url.searchParams.get('qa-phase');
  const bundle = url.searchParams.get('qa-bundle');
  const mapping = '237-review-correction-independent-v1';
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
  const groups = ['f1','f2','f3','f4'];
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
    target.on('response',(reply)=>{
      const resource = new URL(reply.url());
      if (resource.origin===origin && resource.pathname===bundle) {
        note('bound browser entry',{tag,path:resource.pathname,status:reply.status()});
      }
    });
    target.on('request', (req) => {
      const { pathname } = new URL(req.url());
      if (!/^\/(?:loops(?:\/|$)|runs(?:\/|$))/.test(pathname)) return;
      const match = note('browser request', { tag, path: pathname, method: req.method(),
        ifMatch: req.headers()['if-match'] ?? null, body: req.postData() === null ? null : req.postDataJSON() });
      req.response().then(async (reply) => {
        if (reply) {
          note('browser response', { requestSeq: match.seq, status: reply.status(), tag, path: pathname, method: req.method() });
          if(req.method()==='POST' && /\/validate$/.test(pathname) && reply.status()===200) {
            const data=await reply.json();
            note('browser validation result',{requestSeq:match.seq,tag,path:pathname,issues:data.issues});
          }
        } else note('browser request ended without HTTP response', { requestSeq: match.seq, tag, path: pathname });
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

  async function heldInput() {
    const editor = page.locator('.cm-content').and(page.getByLabel('Variables value 1',{exact:true}));
    const original = await editor.textContent();
    await editor.click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.insertText('[');
    same(await editor.textContent(),'['+original,'Actual invalid Variables buffer');
    return {editor,original};
  }
  async function settlePublish() {
    await page.getByRole('button',{name:'Publishing…',exact:true}).waitFor({state:'hidden',...waitOptions});
    await publish(page).waitFor(waitOptions);
  }
  const readbackIssue = (state)=>state.notices.find(({text})=>/Publish not confirmed|Checking the server before publishing/i.test(text))?.text;
  const conflictButton = ()=>page.getByRole('button',{name:'Reload server draft',exact:true});
  async function makeUnknown(id,afterFirstIntercept) {
    const p=pathFor(id);
    const first=await barrier(page,{method:'POST',path:p+'/publish',order:'before',drop:true,
      label:'The first browser POST never reaches the gateway'});
    const blocked=[];
    const fault=async(route)=>{
      if(route.request().method()!=='GET') {await route.fallback();return;}
      blocked.push(note('deliberately failed browser detail read',{path:p}));
      await route.abort('failed');
    };
    await publish(page).click();
    await reached(page,first);
    if(afterFirstIntercept) {
      await afterFirstIntercept();
      await release(first);
      await settlePublish();
      return {blocked};
    }
    await page.route(origin+p,fault);
    try {
      await release(first);
      await notice(page,'unknown');
      await settlePublish();
      check(blocked.length>0,'First direct readback did not fail');
    } finally {
      await page.unroute(origin+p,fault);
    }
    return {blocked};
  }
  async function f1() {
    const variant=url.searchParams.get('qa-variant')??'divergent';
    check(['divergent','held','initial','healthy'].includes(variant),'Specifies F1 variant');
    active='F1 '+variant;
    const id=await create('Divergent retry '+variant,'Exact older version','v1');
    const v1=await freeze(id);
    const initial=await detail(id);
    const a1={...v1.definition,description:'A1 acknowledged by the original editor'};
    const accepted=await update(id,a1,initial.draftToken);
    await open(page,id,initial.loop.name);
    let latest,oldOutcome;
    const makeB=async()=>{
      const b=structuredClone(a1);
      findNode(b,'done').config.returns='"Separate B graph"';
      b.description='B from independent writer';
      await update(id,b,accepted.draftToken);
      latest=await detail(id);
      check(latest.draftToken!==accepted.draftToken,'B actually changes persisted token');
    };
    if(variant==='initial') {
      oldOutcome=await makeUnknown(id,makeB);
      same(postings(id).length,1,'No extra browser request for initial readback');
    } else {
      oldOutcome=await makeUnknown(id);
      const uncommitted=await detail(id);
      same([uncommitted.current,uncommitted.draft,uncommitted.draftToken],[v1,accepted.draft,accepted.draftToken],
        'Aborted first POST did not commit');
      if(variant==='healthy') latest=await detail(id); else await makeB();
      const lease=await barrier(page,{method:'GET',path:pathFor(id),order:'after',
        label:'Known actual retry readback is held for observation'});
      await publish(page).click();
      const captured=(await reached(page,lease)).response;
      same(captured.status,200,'Successful actual precheck');
      same(captured.body,latest,'Retry GET already captured exact server content and draft token');
      same(postings(id).length,1,'Publish cannot pass held GET');
      const pending=variant==='held'?await heldInput():null;
      await release(lease);
      await settlePublish();
      if(pending) {
        same(await pending.editor.textContent(),'['+pending.original,'Divergence handling keeps held browser text');
        same(postings(id).length,1,'Held input prevents dispatch before deliberate discard');
        await page.getByRole('button',{name:'Discard the unparsed text',exact:true}).click();
        await publish(page).click();
        await settlePublish();
      }
    }
    const after=await detail(id), state=await readUI(page,'Completed F1 '+variant);
    const count=postings(id).length;
    const conflict=await conflictButton().isVisible();
    same(await exactVersion(id,v1.id),v1,'Known previous release remains exact');
    let finding, local;
    if(variant==='healthy') {
      same(count,2,'Healthy unchanged acknowledgment permits one fresh POST');
      same(after.current.definition,a1,'Healthy precheck only publishes original acknowledged graph');
      await storedRelease(id,after.current);
    } else if(phase==='before' && variant!=='initial') {
      same(count,2,'Observed exact excess browser retry POST on reviewed baseline');
      same(after.current.definition,latest.draft.definition,'The excess POST published known B');
      finding='KNOWN_DIVERGENCE_ADMITTED_OTHER_WRITER_DRAFT';
    } else {
      same(count,1,'Known divergence prevents further POST');
      same(after,latest,'Exact B draft and prior version remain unchanged');
      if(phase==='corrected') {
        check(conflict,'Successful divergent readback must provide conflict recovery');
        local=await laterUntil(page,async()=>{
          const data=await deviceCopy(page,id);
          return data && data.synced===false ? data : null;
        });
        check(local,'Divergence requires actual unsynced device recovery copy');
        same(local.definition,a1,'Device preserves original A1, not B');
        if(variant==='initial') check(state.notices.some(({text})=>/reload|overwrite|different|changed/i.test(text)),
          'Known conflict must explain the available recovery');
      }
    }
    const publishedHistory=(await versions(id)).items.filter(({status})=>status==='published');
    const expectedIds=after.current.id===v1.id ? [v1.id] : [v1.id,after.current.id];
    same(publishedHistory.map(({id})=>id).sort(),expectedIds.sort(),'Only the observed immutable releases exist');
    await page.screenshot({path:phase+'-f1-'+variant+'.png',animations:'disabled'});
    outcomes.push({active,variant,finding,oldOutcome:{failedReads:oldOutcome.blocked},count,conflict,local,server:after,
      publishedHistory,state});
  }

  async function f2() {
    active='F2 unknown A1 and different acknowledged A3, failed precheck without dispatch';
    const id=await create('Earlier request wording','A1 distinct original');
    const a1=await detail(id);
    await open(page,id,a1.loop.name);
    await makeUnknown(id);
    same(await detail(id),a1,'A1 unknown request never reached server');
    const a3='A3 accepted during the same editor load';
    const put=response(page,'PUT',pathFor(id)+'/draft');
    await desc(page).fill(a3);
    const savedA3=await received(put,200);
    await saved(page);
    const failed=await barrier(page,{method:'GET',path:pathFor(id),order:'before',drop:true,
      label:'Failed A3 precheck before any second POST'});
    await publish(page).click();
    await reached(page,failed);
    await release(failed);
    await settlePublish();
    const state=await readUI(page,'Notice after failed A3 readback');
    const line=readbackIssue(state);
    check(line,'Failed recheck needs an actual visible notice');
    check(/earlier|previous|prior/i.test(line) && /nothing was sent|no publish request (?:was )?sent|did not send/i.test(line),
      'Notice must identify an unresolved earlier attempt and no current dispatch');
    const misattributes=/earlier request published the draft saved for this publish/i.test(line);
    same(misattributes,phase==='before','Previous request cannot be described as publishing the current A3 snapshot');
    same(postings(id).length,1,'A3 failed precheck sent no POST');
    const durable=await detail(id);
    same(durable.draft,savedA3.data.draft,'A3 remains the exact accepted draft');
    same(durable.current,undefined,'No publish was admitted');
    const stored=await laterUntil(page,async()=>{
      const copy=await deviceCopy(page,id);
      return copy?.synced && copy.baseToken===durable.draftToken ? copy : null;
    });
    same(stored.definition,durable.draft.definition,'A3 exact device definition');
    check(durable.draftToken!==a1.draftToken,'A3 and A1 are distinct immutable comparison inputs');
    await page.screenshot({path:phase+'-f2.png',animations:'disabled'});
    outcomes.push({active,notice:line,a1,durable,stored,finding:misattributes?'UNKNOWN_NOTICE_ATTRIBUTED_TO_A3':null});
  }

  async function f3() {
    const variant=url.searchParams.get('qa-variant')??'matched';
    check(['matched','mismatch','held'].includes(variant),'Specifies F3 reply type');
    active='F3 '+variant+' old immutable reply with newest A2 already released';
    const id=await create('Scope older release '+variant,'A1 acknowledged','exact A1');
    const a1=await detail(id);
    await open(page,id,a1.loop.name);
    let first, old;
    if(variant==='mismatch') {
      const path=pathFor(id)+'/publish';
      const admitted=deferred(), allowCommit=deferred(), responseReady=deferred(), show=deferred(), finished=deferred();
      const match=(request)=>request.origin===origin && request.pathname===path;
      let used=false;
      const handler=async(route)=>{
        if(used || route.request().method()!=='POST'){await route.fallback();return;}
        used=true;
        admitted.resolve();
        try {
          await allowCommit.promise;
          const stored=await route.fetch({maxRetries:0});
          const actual={status:stored.status(),body:await stored.json()};
          responseReady.resolve(actual);
          await show.promise;
          await route.fulfill({response:stored});
          finished.resolve({ok:true});
        } catch(error) {responseReady.resolve({error:String(error)});finished.resolve({error:String(error)});}
      };
      await page.route(match,handler);
      first={label:'held mismatched v1 after genuine commit',wait:responseReady.promise,open:()=>show.resolve(),
        done:finished.promise,detach:async()=>{allowCommit.resolve();show.resolve();await page.unroute(match,handler).catch(()=>{});}};
      barriers.push(first);
      await publish(page).click();
      const reachedRequest=await Promise.race([admitted.promise.then(()=>true),page.waitForTimeout(8000).then(()=>false)]);
      check(reachedRequest,'First real Publish was not intercepted before admission');
      const wrong=structuredClone(a1.draft.definition);
      findNode(wrong,'done').config.returns='"Different admitted v1"';
      await update(id,wrong,a1.draftToken);
      allowCommit.resolve();
      old=await reached(page,first);
    } else {
      first=await barrier(page,{method:'POST',path:pathFor(id)+'/publish',order:'after',label:'Hold exact committed v1 reply'});
      await publish(page).click();
      old=(await reached(page,first)).response;
    }
    same(old.status,200,'Real first publish committed');
    const v1=old.body.version;
    const a2={...a1.draft.definition,description:'A2 already published separately'};
    await desc(page).fill(a2.description);
    const mirrored=await laterUntil(page,async()=>{
      const copy=await deviceCopy(page,id);
      return copy?.definition.description===a2.description ? copy : null;
    });
    check(mirrored,'Independent local A2 authored with old reply held');
    same(mirrored.definition,a2,'A2 original exact local executable graph');
    const previous=await detail(id);
    await update(id,a2,previous.draftToken);
    const v2=await freeze(id);
    same(v2.definition,a2,'Independent v2 froze exact current local definition');
    if(variant==='held') await heldInput();
    await release(first);
    await settlePublish();
    await page.getByText('published v2',{exact:true}).waitFor(waitOptions);
    const state=await readUI(page,'v1 reply after exact A2 v2 is current');
    const line=state.notices.find(({text})=>(/published version 1/i.test(text) ||
      /(?:version 1.*(?:another|different) draft|a different draft was published)/i.test(text)));
    check(line,'Actual old release outcome notice is required');
    const broad=/changes made after that are not published\.|This editor’s draft is not published\./i.test(line.text);
    const expandedBadClaim=/\b(?:your|this editor['’]s|the current) (?:draft|work|changes) (?:are|is|remain) (?:still )?unpublished\b/i;
    if(variant!=='held') same(broad,phase==='before','Old version comparison cannot claim A2 is unpublished');
    if(phase==='corrected') {
      check(!expandedBadClaim.test(line.text),'Corrected copy must not imply all newer releases lack A2');
      if(variant==='held') {
        check(state.notices.some(({text})=>/unapplied|unfinished|unparsed|held input/i.test(text)),
          'Genuinely held input remains separately identified');
      }
    }
    same(line.links,[],'No historical response claims release-specific navigation');
    same(await exactVersion(id,v1.id),v1,'Original immutable publication remains exact');
    same(await exactVersion(id,v2.id),v2,'A2 immutable publication remains exact');
    same((await detail(id)).current,v2,'Latest exact public version stays v2');
    const releases=(await versions(id)).items.filter(({status})=>status==='published');
    same(releases.map(({id})=>id).sort(),[v1.id,v2.id].sort(),'Two immutable releases, no automatic additional publication');
    await page.screenshot({path:phase+'-f3-'+variant+'.png',animations:'disabled'});
    outcomes.push({active,variant,v1,v2,broad,notice:line,finding:broad&&variant!=='held'?'OLDER_NOTICE_OVERCLAIMS_UNPUBLISHED':null});
  }

  async function f4() {
    const variant=url.searchParams.get('qa-variant')??'warm';
    check(['warm','cold'].includes(variant),'Specifies F4 cache variant');
    active='F4 '+variant+' dependent validation response crosses actual publication';
    const a=await create('Dependency target '+variant,'A draft only');
    const aBefore=await detail(a);
    const bDef=definition('Dependent B '+variant+' '+suffix,'B stays exact');
    bDef.nodes.splice(1,0,{id:'invoke',kind:'subloop',label:'Invoke A',ui:{x:285,y:200},config:{
      loopRef:{loopId:a,version:'latest'},input:{mode:'fresh'},output:{mode:'result-only',resultTo:{lastOutput:true}},
    }});
    bDef.edges[0].to.node='invoke';
    bDef.edges.push({id:'after',from:{node:'invoke',port:'out'},to:{node:'done',port:'in'}});
    const b=(await api('POST','/loops',201,{definition:bDef})).loop.id;
    const beforeB=await detail(b);
    const c=await create('Unrelated cache C '+variant,'A separate valid draft');
    const cBefore=await detail(c);
    const validatePath=(id)=>pathFor(id)+'/validate';
    const validationRequests=(id,after=0)=>chronology.filter((event)=>event.seq>after &&
      event.type==='browser request' && event.method==='POST' && event.path===validatePath(id));
    const lackA=(data)=>data.issues.some(({code,nodeId})=>code==='SUBLOOP_NOT_PUBLISHED' && nodeId==='invoke');
    const bIssues=page.getByRole('button',{name:/^\d+ errors?$/});
    async function navigate(id,name) {
      await loopListLink(page).click();
      await waitRow(page,id,name);
      await row(page,id).getByRole('link',{name,exact:true}).click();
      await open(page,id,name,false);
    }
    if(variant==='warm') {
      await open(page,b,beforeB.loop.name);
      await bIssues.waitFor(waitOptions);
      same(lackA(await api('POST',validatePath(b),200,{definition:beforeB.draft.definition})),true,'Warm B truly lacks A');
      // An ordinary unrelated browser publication marks inactive B stale without changing
      // its actual source/token/catalog composition.
      await navigate(c,cBefore.loop.name);
      const committed=response(page,'POST',pathFor(c)+'/publish');
      await publish(page).click();
      await received(committed,200);
      await settlePublish();
      await navigate(a,aBefore.loop.name);
    } else {
      await open(page,a,aBefore.loop.name);
    }
    await page.getByText('Ready to publish',{exact:true}).waitFor(waitOptions);
    const referenceStart=seq;
    const holdA=await barrier(page,{method:'POST',path:pathFor(a)+'/publish',order:'before',
      label:'A waits before any real upstream publication'});
    const commitResponse=response(page,'POST',pathFor(a)+'/publish');
    await publish(page).click();
    await reached(page,holdA);
    const holdB=await barrier(page,{method:'POST',path:validatePath(b),order:'after',
      label:'B validate has really read A as unpublished but its reply is held'});
    await navigate(b,beforeB.loop.name);
    const pre=(await reached(page,holdB)).response;
    same(pre.status,200,'Old validation HTTP status');
    same(lackA(pre.body),true,'Old actual gateway validation contains dependency refusal');
    const bRequest=validationRequests(b).at(-1);
    same(bRequest.body.definition,beforeB.draft.definition,'Held validation belongs to exact unchanged B definition');
    same(await detail(a),aBefore,'A publication has not yet entered the gateway');
    const beforeCommit=seq;
    // Clicking back into the list while retaining B's active query is unavailable. Let A's
    // mounted publish mutation settle after normal navigation and retain the actual order.
    await release(holdA);
    const committed=await received(commitResponse,200);
    same(committed.data.version.definition,aBefore.draft.definition,'A actually published its own whole draft');
    // Allow an observer turn after the actual A commit and record any follow-up.
    await page.waitForTimeout(600);
    const refresh=chronology.filter(({seq,type,tag,path,method})=>seq>beforeCommit && type==='browser response' &&
      tag==='primary' && (path==='/loops' || path===pathFor(a)) && method==='GET');
    // Lists and A detail may be inactive while B is open; retain their observed requests
    // without assuming they must force-refresh. The GET barriers and B's actual reopen
    // determine whether a precommit payload persisted.
    const afterA=await detail(a);
    same(afterA.current,committed.data.version,'A latest immutable version');
    const releaseAt=seq;
    const late=await release(holdB);
    await page.waitForTimeout(400);
    const during=await readUI(page,'After actual stale B reply released');
    const activeRechecks=validationRequests(b,releaseAt);
    const ownRechecks=validationRequests(a,referenceStart);
    same(ownRechecks.length,0,'Publishing A and visiting B must not refetch A unchanged validation');
    const untouchedRechecks=validationRequests(c,beforeCommit);
    same(untouchedRechecks.length,0,'Inactive unrelated C does not get a blanket forced refetch');
    const reopenAt=seq;
    await navigate(c,cBefore.loop.name);
    await navigate(b,beforeB.loop.name);
    const eventuallyFresh=phase==='corrected'
      ? await page.getByText('Ready to publish',{exact:true}).waitFor(waitOptions).then(()=>true,()=>false)
      : await page.getByText('Ready to publish',{exact:true}).isVisible();
    const fresh = validationRequests(b,releaseAt);
    const reopened = fresh.filter(({seq})=>seq>reopenAt);
    const responseToFresh=()=>chronology.find(({type,requestSeq,issues})=>type==='browser validation result' &&
      fresh.some(({seq})=>seq===requestSeq) && Array.isArray(issues) && !lackA({issues}));
    const actual=await api('POST',validatePath(b),200,{definition:beforeB.draft.definition});
    same(lackA(actual),false,'Actual gateway now sees A as published');
    same(await detail(b),beforeB,'Validation refresh never mutated B or its token');
    const visible=await readUI(page,'B on ordinary reopening after A commit');
    const remainedOld=!eventuallyFresh && fresh.length===0 && await bIssues.isVisible();
    if(phase==='before' && variant==='warm') {
      check(remainedOld,'Historical warm stale-cache behavior requires a persisted refusal across reopen');
    } else if(phase==='corrected') {
      check(eventuallyFresh && fresh.length>0,'B must receive fresh validation by normal reopen');
      await laterUntil(page,async()=>responseToFresh());
      check(!await bIssues.isVisible(),'Old dependency error remains visible after fresh response');
    }
    await page.screenshot({path:phase+'-f4-'+variant+'.png',animations:'disabled'});
    outcomes.push({active,variant,old:pre,bRequest,late,during,visible,afterA,beforeB,refresh,actual,activeRechecks,ownRechecks,untouchedRechecks,
      fresh,reopened,responseToFresh:responseToFresh(),finding:remainedOld?'LATE_DEPENDENT_VALIDATION_CERTIFIES_OLD_RESULT':null});
  }

  try {
    check(/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(origin) && !/:474[78]$/.test(origin), 'Refused browser origin');
    check(groups.includes(targetGroup), 'Unknown scenario group');
    check(['before','corrected'].includes(phase),'Bind verified historical artifacts or clean corrected source explicitly');
    check(url.searchParams.get('qa-profile') === mapping,'Bind the frozen notice profile before execution');
    const pid = url.searchParams.get('qa-pid');
    check(/^[1-9][0-9]*$/.test(pid??''),'Pass the known PID of the disposable gateway');
    const health = await page.request.get(origin+'/healthz',{timeout:5000});
    same(health.status(),200,'Gateway health');
    same(health.headers()['x-graphgoblin-pid'],pid,'Refused different or unowned gateway');
    check(Object.values(noticeSelectors).every((entry) => typeof entry === 'function'),
      'Bind the final rendered notice selectors before running this driver.');
    const cases = {f1,f2,f3,f4};
    const selected = [targetGroup];
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
    check(chronology.some((event)=>event.type==='bound browser entry' && event.status===200),
      'Observed browser entry differs from preflight');
  } catch (error) {
    failures.push({ active, error: String(error), stack: error.stack });
  }
  return { origin, mapping, phase, scenario: targetGroup, browser: await page.evaluate(() => navigator.userAgent).catch(() => null),
    outcomes, chronology, checkpoints, pageErrors, failures };
}
