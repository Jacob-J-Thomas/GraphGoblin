async (page) => {
  const initial = new URL(page.url());
  const origin = initial.origin;
  const phase=initial.searchParams.get('qa-phase');
  const servedBundle=initial.searchParams.get('qa-bundle');
  const expectedGatewayPid = initial.searchParams.get('qa-pid');
  const errors = [], checkpoints = [], writes = [], bundles=[];
  const suffix = crypto.randomUUID().slice(0, 8);
  const wait = { timeout: 9000 };

  function check(ok, explanation) { if (!ok) throw new Error(explanation); }
  function canon(value) {
    return JSON.stringify(value, (_, data) => data && typeof data === 'object' && !Array.isArray(data)
      ? Object.fromEntries(Object.keys(data).sort().map((key) => [key, data[key]])) : data);
  }
  function same(a, b, explanation) {
    check(canon(a) === canon(b), explanation + '\nExpected ' + canon(b) + '\nActual ' + canon(a));
  }
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('response',(reply)=>{
    const url=new URL(reply.url());
    if(url.origin===origin && url.pathname===servedBundle) bundles.push(reply.status());
  });
  page.on('request', (req) => {
    const path = new URL(req.url()).pathname;
    if (req.method() !== 'PUT' || !/^\/loops\/[^/]+\/draft$/.test(path)) return;
    writes.push({ path, at: Date.now(), ifMatch: req.headers()['if-match'] ?? null, body: req.postDataJSON() });
  });
  const route = (id) => '/loops/' + id;
  const file = (id) => route(id) + '/draft';
  async function api(method, path, status, data) {
    const r = await page.request.fetch(origin + path, { method, timeout: 10000,
      ...(data === undefined ? {} : { data }) });
    const result = await r.json();
    same(r.status(), status, method + ' ' + path + ' ' + canon(result));
    return result;
  }
  const get = (id) => api('GET', route(id), 200);
  async function create(graph) {
    return (await api('POST', '/loops', 201, { definition: graph })).loop.id;
  }
  const card = (id) => page.locator('.react-flow__node[data-id="' + id + '"]');
  const line = (id) => page.locator('.react-flow__edge[data-id="' + id + '"]');
  const port = (id, direction, handle) => card(id).locator('.react-flow__handle.' + direction +
    '[data-handleid=' + JSON.stringify(handle) + ']');
  async function ports(id) {
    await card(id).waitFor(wait);
    return card(id).locator('.react-flow__handle').evaluateAll((els) => els.map((el) => ({
      direction: el.classList.contains('source') ? 'source' : 'target',
      id: el.dataset.handleid,
      label: el.getAttribute('aria-label'),
    })));
  }
  async function fit() {
    for (const name of ['Hide palette', 'Hide loop settings']) {
      const button = page.getByRole('button', { name, exact: true });
      if (await button.isVisible()) await button.click();
    }
    // The retained xyflow controls do not expose the draft plan's proposed English name.
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
          else if (stable >= 8) done();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
    });
  }
  async function open(id, name) {
    await page.goto(origin + '/app' + route(id) + '/edit');
    await page.getByRole('heading', { name, exact: true }).waitFor(wait);
    await page.getByText('The editor is available. Checking the server and this device before saving changes.', { exact: true })
      .waitFor({ state: 'hidden', timeout: 9000 });
    await fit();
  }
  async function center(handle) {
    await handle.waitFor(wait);
    return handle.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      if ((hit !== element && !element.contains(hit)) || rect.width <= 0 || rect.height <= 0) {
        throw new Error('Fixture target not hittable ' + element.dataset.nodeid + '/' + element.dataset.handleid);
      }
      return { x, y, width: rect.width, height: rect.height };
    });
  }
  async function pointer(a, b, click = false) {
    await page.mouse.move(a.x, a.y);
    if (click) {
      await page.mouse.click(a.x, a.y);
      await page.mouse.click(b.x, b.y);
    } else {
      await page.mouse.down();
      try { await page.mouse.move(b.x, b.y, { steps: 16 }); }
      finally { await page.mouse.up(); }
    }
    return { a, b, click };
  }
  async function draw(from, to, click = false) {
    return pointer(await center(from),await center(to),click);
  }
  async function edgeEvidence(id) {
    const edge = line(id);
    await edge.waitFor(wait);
    return { id, accessibleName: await edge.getAttribute('aria-label'),
      d: await edge.locator('.react-flow__edge-path').getAttribute('d') };
  }
  async function device(id, token, synced = true) {
    const handle = await page.waitForFunction(async ({ id, token, synced }) => {
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
      return value?.synced === synced && value.baseToken === token && value;
    }, { id, token, synced }, { timeout: 9000, polling: 125 });
    const local = await handle.jsonValue();
    await handle.dispose();
    return local;
  }
  async function waitDraft(id) {
    const response = await page.waitForResponse(
      (r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === file(id), wait);
    same(response.status(), 200, 'Draft HTTP status');
    const saved = await response.json();
    const req = response.request();
    const persisted = await get(id);
    same(persisted.draft, saved.draft, 'Exact public draft readback');
    same(persisted.draftToken, saved.draftToken, 'Exact public draft token');
    same(req.postDataJSON().definition, persisted.draft.definition, 'Browser submitted the full durable definition');
    const local = await device(id, persisted.draftToken);
    same(local.definition, persisted.draft.definition, 'Device mirror equals durable draft');
    return { persisted, local, ifMatch: req.headers()['if-match'] ?? null };
  }
  async function editAndRead(id, edit, previous, label) {
    const before = writes.filter((request) => request.path === file(id)).length;
    const [state] = await Promise.all([waitDraft(id), Promise.resolve().then(edit)]);
    await page.waitForFunction(()=>document.querySelector('[data-testid="save-state"]')?.textContent==='All changes saved',null,wait);
    await page.waitForTimeout(850);
    same(state.ifMatch, '"' + previous.draftToken + '"', 'Action kept its base token');
    same(writes.filter((request) => request.path === file(id)).length - before, 1, label + ' sent exactly one PUT');
    checkpoints.push({ label, ...state });
    return state.persisted;
  }
  async function unchanged(id, before, operation, label) {
    const count = writes.length;
    await operation();
    await new Promise((done) => setTimeout(done, 950)); // Baseline debounce is 600 ms.
    same(writes.length, count, label + ' sent an unintended PUT');
    same(await get(id), before, label + ' changed persisted graph/token');
  }
  const delta = (before, after) => {
    const a = before.draft.definition, b = after.draft.definition;
    const { edges: ignoredOldEdges, ...oldSetup } = a;
    const { edges: ignoredNewEdges, ...newSetup } = b;
    same(newSetup,oldSetup,'Topology gesture changed definition outside the edge list');
    const old = new Map(a.edges.map((e) => [e.id, e]));
    const current = new Map(b.edges.map((e) => [e.id, e]));
    const gone = a.edges.filter((e) => !current.has(e.id) || canon(e) !== canon(current.get(e.id)));
    const added = b.edges.filter((e) => !old.has(e.id) || canon(e) !== canon(old.get(e.id)));
    return { gone, added };
  };
  function node(id,kind,label,x,y,config) { return { id,kind,label,ui:{x,y},config }; }
  function edge(id,source,out,target) { return { id,from:{node:source,port:out},to:{node:target,port:'in'} }; }
  const script = (exitCodeRoutes) => ({
    command:'never-execute-this-fixture',stdin:'none',stdout:'ignore',exitCodeRoutes,
  });
  async function openDialog(id,kind) {
    await card(id).press('Enter');
    const dialog = page.getByRole('dialog', { name:'Edit ' + kind + ' ' + id, exact:true });
    await dialog.waitFor(wait);
    return dialog;
  }
  async function closeDialog(dialog) {
    await dialog.getByRole('button',{name:'Done',exact:true}).click();
    await dialog.waitFor({state:'hidden',timeout:9000});
  }
  async function undo() { await page.getByRole('button', {name:/^Undo\b/}).click(); }
  async function selectEdge(id) {
    const selected = line(id);
    await selected.focus();
    if (!(await selected.evaluate((edge)=>edge.classList.contains('selected')))) {
      await page.keyboard.press('Enter');
    }
    await page.waitForFunction((id) => {
      const edge = document.querySelector('.react-flow__edge[data-id="' + id + '"]');
      return edge?.classList.contains('selected');
    }, id, wait);
  }
  async function removeWith(id) {
    await selectEdge(id);
    const button=page.getByRole('button',{name:'Remove connection',exact:true});
    await button.waitFor(wait);
    const point=await center(button);
    await page.mouse.click(point.x,point.y);
    await line(id).waitFor({state:'detached',...wait});
  }
  const connect = (from, output, to, click = false) => draw(port(from,'source',output),port(to,'target','in'),click);
  async function portContract(id, hasInput, outgoing) {
    const handles = await ports(id);
    same(handles.filter(({direction})=>direction === 'target').map(({id})=>id),hasInput ? ['in'] : [],
      'Input handles of '+id);
    same(handles.filter(({direction})=>direction === 'source').map(({id})=>id),outgoing,'Output handles of '+id);
    checkpoints.push({label:'port inventory',subject:id,handles});
  }
  async function freshRead(id, name, last) {
    await open(id, name);
    same(await get(id), last, 'Fresh reload preserves full API draft and token');
    same((await device(id,last.draftToken)).definition,last.draft.definition,
      'Fresh reload preserves the synced device definition');
  }
  async function addEdge(id, previous, from, output, to, click = false) {
    const next = await editAndRead(id,()=>connect(from,output,to,click),previous,'draw '+from+'.'+output+' → '+to);
    const change = delta(previous,next);
    same(change.gone,[],'Canvas draw kept every existing edge, including optional routes');
    same(change.added.length,1,'Canvas draw added one edge');
    const [added] = change.added;
    same([added.from,added.to],[{node:from,port:output},{node:to,port:'in'}],'Native draw created the exact tuple');
    check(!added.ui?.route,'New edge inherited a removed manual route');
    const evidence = await edgeEvidence(added.id);
    check(evidence.accessibleName?.includes(' to '+to) && /^M/.test(evidence.d),'New edge has the intended visible endpoint');
    checkpoints.push({label:'new canvas edge',...evidence});
    return {next,added};
  }
  async function removeEdge(id, previous, edge) {
    const next = await editAndRead(id,()=>removeWith(edge.id),previous,'remove '+edge.from.node+'.'+edge.from.port);
    same(delta(previous,next),{gone:[edge],added:[]},'Removal kept every other full edge');
    return next;
  }
  let active='fixture admission',failure=null,outcome=null;
  const shot=(name)=>page.screenshot({path:name+'.png',animations:'disabled'});
  try {
    check(phase==='corrected' && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) && !/:474[78]$/.test(origin),'Require disposable fixture');
    same(servedBundle,'/app/assets/index-DauABcWi.js','Retained, bound phase-1 bundle');
    const health=await page.request.get(origin+'/healthz',{timeout:5000});
    same(health.status(),200,'Public fixture identity');
    same(health.headers()['x-graphgoblin-pid'],expectedGatewayPid,'Refuse unowned gateway');
    const control={...edge('entry','start','out','subject'),ui:{route:[179]}};
    const stranded={...edge('stale','subject','retired','other'),ui:{route:[495,302,590]}};
    const graph={schemaVersion:4,name:'Script and stranded route '+suffix,
      nodes:[
        node('start','trigger','Manual entry',0,165,{type:'manual'}),
        node('subject','script','Draft-only Script',345,180,script({7:'retry'})),
        node('done','exit','Destination One',780,50,{outcome:'success'}),
        node('other','exit','Destination Two',780,340,{outcome:'failure'}),
      ],
      edges:[control,stranded]};
    const id=await create(graph);
    await open(id,graph.name);
    let current=await get(id);
    const original=current;
    same(current.draft.definition.edges,[control,stranded],'Both exact manual routes were stored before any gesture');
    await portContract('subject',true,['out','retry']);
    const selected=[];
    for(const output of ['out','retry']){
      active='Script '+output+' canvas round trip';
      const created=await addEdge(id,current,'subject',output,'done');
      current=await removeEdge(id,created.next,created.added);
      const redrawn=await addEdge(id,current,'subject',output,'other');
      selected.push({output,created:created.added,redrawn:redrawn.added});
      current=redrawn.next;
    }
    await shot('script-two-final-ports');
    active='Legacy modal Connections check';
    await unchanged(id,current,async()=>{
      const dialog=await openDialog('subject','script');
      const connections=dialog.getByRole('region',{name:'Connections',exact:true});
      await connections.waitFor(wait);
      same(await connections.count(),1,'Legacy modal Connections region still present before retirement');
      check((await connections.innerText()).includes('Connections'),'Connections heading visible');
      for(const {redrawn} of selected) {
        same(await connections.getByRole('button',{name:'Remove edge '+redrawn.id,exact:true}).count(),1,
          'Legacy region lists exact still-drawable edge '+redrawn.id);
      }
      checkpoints.push({label:'Legacy modal Connections',view:await connections.ariaSnapshot()});
      await connections.scrollIntoViewIfNeeded(wait);
      await shot('predeletion-modal-connections');
      await closeDialog(dialog);
    },'Modal inspection');
    active='Stranded edge with authored manual route through Loop issues';
    const validation=await api('POST',route(id)+'/validate',200,{definition:current.draft.definition});
    check(validation.issues.some(({edgeId,code})=>edgeId===stranded.id && code==='EDGE_PORT_MISSING'),
      'Gateway identifies the exact stranded output');
    same(await line(stranded.id).locator('.react-flow__edge-path').count(),0,'Manual route does not invent a drawable path');
    const approvals=page.locator('button[aria-haspopup="dialog"][data-severity]').filter({hasText:/\d+ (?:error|warning)/});
    same(await approvals.count(),1,'Distinct toolbar issue indicator');
    await approvals.click();
    const popover=page.getByRole('dialog',{name:'Loop issues',exact:true});
    await popover.waitFor(wait);
    const remove=popover.getByRole('button',{name:'Remove edge '+stranded.id,exact:true});
    same(await remove.count(),1,'Exactly one recovery action for stranded edge');
    for(const e of current.draft.definition.edges.filter(({id})=>id!==stranded.id)){
      same(await popover.getByRole('button',{name:'Remove edge '+e.id,exact:true}).count(),0,
        'Recovery omits unrelated healthy edge '+e.id);
    }
    const recoveryView=await popover.ariaSnapshot();
    await shot('stranded-route-recovery');
    const removed=await editAndRead(id,()=>remove.click(),current,'Remove the exact stranded edge');
    same(delta(current,removed),{gone:[stranded],added:[]},'Recovery removes only the edge and its route');
    const restored=await editAndRead(id,undo,removed,'Undo once to restore exact manual edge');
    same(restored.draft.definition,current.draft.definition,'One Undo restores all exact edges including both manual routes');
    same(restored.draftToken,current.draftToken,'Content-identical Undo restores the exact draft token');
    same(await line(stranded.id).locator('.react-flow__edge-path').count(),0,'Undo restores storage and issue, not a fictional drawable path');
    await freshRead(id,graph.name,restored);
    outcome={selected,validation,recoveryView,stranded,original:original.draft.definition,
      restored:restored.draft.definition,mutations:writes.length};
    same(writes.length,8,'Six Script gestures and two recovery changes only');
    check(bundles.includes(200),'Browser loaded the actual bound JS');
    same(errors,[],'No uncaught page errors');
  } catch(error) {
    failure={active,message:String(error),stack:error.stack};
    await shot('first-'+active.toLowerCase().replace(/[^a-z0-9]+/g,'-')).catch(()=>{});
  }
  return {origin,suite:'207-phase1-supplement-independent',outcome,checkpoints,writes,bundles,pageErrors:errors,failure,
    browser:await page.evaluate(()=>navigator.userAgent).catch(()=>null)};
}
