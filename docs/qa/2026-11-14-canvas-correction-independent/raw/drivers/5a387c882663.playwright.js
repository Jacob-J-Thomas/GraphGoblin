async (page) => {
  const initial = new URL(page.url());
  const origin = initial.origin;
  const mode = initial.searchParams.get('qa-mode');
  const action = initial.searchParams.get('qa-case');
  const expectedGatewayPid = initial.searchParams.get('qa-pid');
  const bundle = initial.searchParams.get('qa-bundle');
  const policy=JSON.parse(initial.searchParams.get('qa-policy')??'null');
  const group=initial.searchParams.get('qa-group');
  const mapping = initial.searchParams.get('qa-map');
  const errors = [], checkpoints = [], writes = [], loaded = [];
  const suffix = crypto.randomUUID().slice(0, 8);
  const wait = { timeout: 9000 };
  // Bind to the final tree before use. These locators reflect the accepted phase-1 code at c524.
  const delivered = {
    removeName:'Remove connection',
    recoveryRemoveName:(edge)=>'Remove edge '+edge.id,
    refusals:(target)=>target.getByRole('status').filter({hasText:'Connection refused:'}),
  };

  function check(ok, explanation) { if (!ok) throw new Error(explanation); }
  function canon(value) {
    return JSON.stringify(value, (_, data) => data && typeof data === 'object' && !Array.isArray(data)
      ? Object.fromEntries(Object.keys(data).sort().map((key) => [key, data[key]])) : data);
  }
  function same(a, b, explanation) {
    check(canon(a) === canon(b), explanation + '\nExpected ' + canon(b) + '\nActual ' + canon(a));
  }
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('response',(response)=>{
    const url=new URL(response.url());
    if(url.origin===origin && url.pathname===bundle) loaded.push(response.status());
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
  async function centerVisibleToolbar(button,id) {
    const position=await button.evaluate((el)=>{
      const box=el.getBoundingClientRect();
      const pane=document.querySelector('.react-flow__pane').getBoundingClientRect();
      return {top:box.top,bottom:box.bottom,viewTop:pane.top,viewBottom:pane.bottom};
    });
    if(position.top<position.viewTop+10 || position.bottom>position.viewBottom-10) {
      const dy=position.top<position.viewTop+10?110:-110;
      const at=await emptyPanePoint();
      await page.mouse.move(at.x,at.y);
      await page.mouse.down();
      try{await page.mouse.move(at.x,at.y+dy,{steps:12});}
      finally{await page.mouse.up();}
      const selected=await line(id).evaluate((edge)=>edge.classList.contains('selected'));
      if(!selected)await selectEdge(id);
      checkpoints.push({label:'pan selected toolbar into the canvas viewport',id,dy,position});
    }
    return center(button);
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
  async function edgePointer(id) {
    return line(id).evaluate((root)=>{
      const path=root.querySelector('.react-flow__edge-path');
      const hitLine=root.querySelector('.react-flow__edge-interaction');
      if(!path || !hitLine) return null;
      const transform=path.getScreenCTM();
      for(const fraction of [0.2,0.35,0.5,0.65,0.8]){
        const point=path.getPointAtLength(path.getTotalLength()*fraction).matrixTransform(transform);
        const hit=document.elementFromPoint(point.x,point.y);
        if(hit===hitLine || hit===path) return {x:point.x,y:point.y};
      }
      return null;
    });
  }
  async function device(id, token, synced = true, revision) {
    const handle = await page.waitForFunction(async ({ id, token, synced, revision }) => {
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
      const owner=value?.decisionRoutes?.subject?.rows?.[2];
      const expectedRevision=!revision||owner?.id===''&&
        owner.edgeIds.includes(revision.edgeId)===revision.owned&&
        value.definition.edges.some(edge=>edge.id===revision.edgeId)===revision.owned;
      return value?.synced === synced && value.baseToken === token && expectedRevision && value;
    }, { id, token, synced, revision }, { timeout: 9000, polling: 125 });
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
    await page.getByTestId('save-state').filter({hasText:'All changes saved'}).waitFor(wait);
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
  const note = { operations:[{op:'append-message',role:'note',content:'independent topology marker'}] };
  const routes = [{id:'accept',label:'Take this route'},{id:'decline',label:'Use fallback'}];
  const output = (id, label, criteria, repeat) => ({ id,label,criteria,...(repeat ? { repeat:true } : {}) });
  const script = (exitCodeRoutes) => ({
    command:'never-execute-this-fixture',stdin:'none',stdout:'ignore',exitCodeRoutes,
  });
  const triggerTypes = {
    manual: {type:'manual'},
    cron: {type:'cron',expression:'0 2 * * *',timezone:'UTC',enabled:false},
    webhook: {type:'webhook'},
    event: {type:'event',eventType:'fixture-event'},
    poll: {type:'poll',intervalSeconds:60,fireWhen:'false',probe:{kind:'none'},enabled:false},
  };
  const waitTypes = {
    input: {mode:'input',prompt:'Reply when ready'},
    duration: {mode:'duration',seconds:17},
    until: {mode:'until',timestamp:'2031-06-18T13:24:15.000Z'},
    signal: {mode:'signal',name:'fixture-signal',filter:'true'},
  };
  const families = {
    trigger: {kind:'trigger',config:triggerTypes.manual,ports:['out']},
    inference: {kind:'inference',config:{harness:'codex',prompt:{template:'Fixture text'}},ports:['out']},
    mutate: {kind:'mutate',config:note,ports:['out']},
    script: {kind:'script',config:script({0:'out',7:'retry',23:'report'}),ports:['out','retry','report']},
    subloop: {kind:'subloop',config:null,ports:['out']},
    wait: {kind:'wait',config:waitTypes.input,ports:['out']},
    heartbeat: {kind:'heartbeat',config:{intervalSeconds:60,maxBeats:2,probe:{kind:'none'}},ports:['out']},
    expression: {kind:'decision',config:{kind:'expression',jsonata:'"accept"',routes},ports:['accept','decline']},
    llm: {kind:'decision',config:{kind:'llm',harness:'codex',instructions:'Choose an available route.',
      model:{mode:'inherit'},effort:{mode:'inherit'},
      routes:[...routes.slice(0,1),{...routes[1],repeat:true}],maxPasses:3},
      ports:['accept','decline','limit-reached'],repeat:'decline'},
    choice: {kind:'decision',config:{kind:'classifier',model:'jev',question:'Which evidence matched?',
      answer:{type:'choice',options:[output('confirmed','Confirmed match','All fields agree.'),
        output('review','Requires review','At least one field differs.')]}},ports:['confirmed','review']},
    noul: {kind:'decision',config:{kind:'classifier',model:'jev',question:'Has the file been approved?',
      answer:{type:'noul',true:output('approved','Approved as submitted','The approval record exists.'),
        false:output('returned','Send back','There is no approval record.',true)},maxPasses:3},
      ports:['approved','returned','limit-reached'],repeat:'returned'},
    score: {kind:'decision',config:{kind:'classifier',model:'jev',question:'How many rubric checks matched?',
      answer:{type:'score',anchors:['No match','Partial match','Complete match'],bands:[
        {id:'low',label:'Review lower band',min:0,max:0.5},
        {id:'middle',label:'Review middle band',min:0.5,max:1.5,repeat:true},
        {id:'high',label:'Pass upper band',min:1.5,max:2}]},maxPasses:3},
      ports:['low','middle','high','limit-reached'],repeat:'middle'},
  };
  function fixture() {
    return { schemaVersion:4, name:'Canvas conformance ' + suffix,
      nodes:[
        node('start','trigger','Manual entry',0,180,{type:'manual'}),
        node('work','mutate','Cycle work',300,20,{operations:[{op:'append-message',content:'cycle only'}]}),
        node('gate','decision','Route chooser',620,180,{kind:'expression',jsonata:'"finish"',maxPasses:3,
          routes:[{id:'loop',label:'Try again',repeat:true},{id:'finish',label:'Keep result'}]}),
        node('done','exit','Completed',940,20,{outcome:'success',returns:'"success marker"'}),
        node('alternate','exit','New target',940,210,{outcome:'failure',returns:'"alternate marker"'}),
        node('limit','exit','Exhausted',940,405,{outcome:'exhausted'}),
      ],
      edges:[edge('entry','start','out','gate'),edge('work-entry','work','out','gate'),
        edge('budget','gate','limit-reached','limit')],
    };
  }
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
  async function modalGateCheck(id, kind, repeat = false) {
    const dialog = await openDialog(id,kind);
    const connections = dialog.getByRole('region',{name:'Connections',exact:true});
    same(await connections.count(),0,'Node dialog has no Connections region');
    same(await dialog.getByRole('heading',{name:'Connections',exact:true}).count(),0,'No retired Connections heading');
    same(await dialog.locator('form[aria-label^="Connect "]').count(),0,'Retired keyboard connection-creation form');
    same(await dialog.getByRole('button',{name:/^Remove edge /}).count(),0,'Retired modal edge controls');
    await dialog.getByLabel('Node id',{exact:true}).waitFor(wait);
    await dialog.locator('[data-field-scope="node"]').getByLabel('Label',{exact:true}).waitFor(wait);
    await dialog.getByRole('button',{name:'Delete node',exact:true}).waitFor(wait);
    await dialog.locator('[data-field-scope="config"]').waitFor(wait);
    const primary = {
      trigger:'type',inference:'harness',mutate:'operations',script:'command',decision:'kind',
      subloop:'loopRef',wait:'mode',heartbeat:'intervalSeconds',exit:'outcome',
    }[kind];
    check(primary,'No configuration assertion for '+kind);
    const primaryField=kind==='subloop' ? dialog.getByLabel('Find a published loop',{exact:true})
      : kind==='wait' ? dialog.getByLabel('Mode',{exact:true})
      : dialog.locator('[data-field="'+primary+'"],[data-field^="'+primary+'."]').first();
    await primaryField.waitFor(wait);
    checkpoints.push({label:'postdeletion dialog',kind,id,repeat,configuration:primary});
    await closeDialog(dialog);
  }
  async function undo() { await page.getByRole('button', {name:/^Undo\b/}).click(); }
  async function redo() { await page.getByRole('button', {name:/^Redo\b/}).click(); }
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
  async function removeWith(id, method) {
    if (method === 'visible') {
      const point=await edgePointer(id);
      if(point) {
        await page.mouse.click(point.x,point.y);
        await page.waitForFunction((edgeId)=>document.querySelector(
          '.react-flow__edge[data-id='+JSON.stringify(edgeId)+']')?.classList.contains('selected'),id,wait);
      } else await selectEdge(id);
      const { removeName } = delivered;
      const button=page.getByRole('button',{name:removeName,exact:true});
      const click=await centerVisibleToolbar(button,id);
      await page.mouse.click(click.x,click.y);
      checkpoints.push({label:'visible Remove connection gesture',id,selection:point?'pointer':'keyboard',point,click});
    } else {
      await selectEdge(id);
      await page.keyboard.press(method);
    }
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
    if(action==='decisions') await fit();
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
  async function removeEdge(id, previous, edge, method) {
    const next = await editAndRead(id,()=>removeWith(edge.id,method),previous,'remove '+edge.from.node+'.'+edge.from.port);
    same(delta(previous,next),{gone:[edge],added:[]},'Removal kept every other full edge');
    return next;
  }
  function publishWitness(suffixLabel, repeat = false) {
    const name = 'Canvas witness '+suffixLabel+' '+suffix;
    const start = node('start','trigger','Manual start',0,170,{type:'manual'});
    const done = node('finished','exit','Completed',850,65,{outcome:'success',returns:'"ordinary terminal"'});
    if (!repeat) {
      return {schemaVersion:4,name,nodes:[start,done],edges:[edge('direct','start','out','finished')]};
    }
    const work = node('work','mutate','Count a pass',300,170,{
      operations:[{op:'set',path:'/vars/work',value:{kind:'expression',jsonata:'($exists(vars.work) ? vars.work : 0) + 1'}}],
    });
    const gate = node('gate','decision','Choose a route',575,170,{
      kind:'expression',jsonata:'trigger.payload.exhaust ? "again" : (gates.gate.passes = 3 ? "complete" : "again")',
      routes:[{id:'again',label:'Return for another pass',repeat:true},{id:'complete',label:'Finish normally'}],maxPasses:3,
    });
    const spent = node('spent','exit','Budget spent',865,370,{outcome:'exhausted',returns:'vars.work'});
    done.config.returns = 'vars.work';
    return {schemaVersion:4,name,settings:{maxNodeVisits:10},variables:{work:{type:'number'}},
      nodes:[start,work,gate,done,spent],
      edges:[edge('entry','start','out','work'),edge('pass','work','out','gate')]};
  }
  async function publishExact(id, expected, viaUi = false) {
    const definition = expected.draft.definition;
    const validation = await api('POST',route(id)+'/validate',200,{definition});
    same(validation.publishable,true,'Real validation refused the connected provider-free graph: '+canon(validation.issues));
    same(validation.issues.filter((issue)=>issue.severity === 'error'),[],'No structural errors');
    let published;
    if (viaUi) {
      const publish = page.getByRole('button',{name:'Publish',exact:true});
      const handle = await publish.elementHandle();
      check(handle,'No publish control');
      await page.waitForFunction((button)=>!button.disabled && button.getAttribute('aria-disabled')!=='true',handle,wait);
      await handle.dispose();
      const [response] = await Promise.all([
        page.waitForResponse((r)=>r.request().method()==='POST' && new URL(r.url()).pathname===route(id)+'/publish',wait),
        publish.click(),
      ]);
      same(response.status(),200,'Publish accepted the exact browser-saved graph');
      published = await response.json();
    } else {
      published = await api('POST',route(id)+'/publish',200);
    }
    const {version} = published;
    same(version.definition,definition,'Frozen version equals the full acknowledged draft');
    same(version.status,'published','Version record is immutable');
    same(await api('GET',route(id)+'/versions/'+version.id,200),version,'Exact immutable definition readback');
    const current = await get(id);
    same(current.current,version,'Public loop detail points at the exact version');
    checkpoints.push({label:'immutable publication',id,validation,version});
    return version;
  }
  async function pinnedRun(id, version, exhaust) {
    const started = await api('POST',route(id)+'/runs',202,{triggerNodeId:'start',input:{exhaust},versionId:version.id});
    let state;
    const until = Date.now()+12000;
    while (Date.now() < until) {
      state = await api('GET','/runs/'+started.run.id,200);
      if (state.finalizedAt) break;
      await new Promise((done)=>setTimeout(done,125));
    }
    const events = await api('GET','/runs/'+started.run.id+'/events?limit=200',200);
    const decisions = events.items.filter(({type})=>type === 'decision.made');
    checkpoints.push({label:'provider-free pinned run',exhaust,state,decisions});
    check(state?.finalizedAt,'Provider-free run did not finalize');
    same(state.versionId,version.id,'Run used the version that includes the native draws');
    same([state.status,state.outcome,state.result],exhaust ? ['exhausted','exhausted',3] : ['succeeded','success',3],
      'Expected bounded cycle and terminal value');
    same(decisions.map((event)=>[event.nodeId,event.portId,event.gate?.previousPasses,event.gate?.passes,event.gate?.limit]),
      [['gate','again',1,2,null],['gate','again',2,3,null],
        ['gate',exhaust ? 'limit-reached' : 'complete',3,3,exhaust ? 'max-passes' : null]],
      'Real run distinguishes chosen normal route and exhausted Limit reached');
    check(events.items.some((item)=>item.type==='node.finished' && item.nodeId===(exhaust ? 'spent' : 'finished')),
      'Expected terminal node was reached');
  }
  async function exerciseRepeat() {
    const graph = publishWitness('repeat',true);
    const id = await create(graph);
    await open(id,graph.name);
    await modalGateCheck('gate','decision',true);
    await portContract('gate',true,['again','complete','limit-reached']);
    let last = await get(id);
    for (const [output,to] of [['again','work'],['complete','finished'],['limit-reached','spent']]) {
      ({next:last} = await addEdge(id,last,'gate',output,to));
    }
    await freshRead(id,graph.name,last);
    const version = await publishExact(id,last,true);
    const afterPublication=await get(id);
    const description=page.getByLabel('Description',{exact:true});
    const show=page.getByRole('button',{name:'Show loop settings',exact:true});
    if(await show.isVisible()) await show.click();
    const revised=await editAndRead(id,()=>description.fill('Later draft only, after immutable release'),
      afterPublication,'Save a new draft after the published topology');
    same(revised.current,version,'Later draft edit did not replace the published version');
    same(revised.draft.definition,{...version.definition,description:'Later draft only, after immutable release'},
      'Only the intended new draft metadata changed');
    await pinnedRun(id,version,false);
    await pinnedRun(id,version,true);
    same(await api('GET',route(id)+'/versions/'+version.id,200),version,'Pins and later draft leave v1 immutable');
    same(await get(id),revised,'Pinned executions do not alter the stored graph or current token');
    await freshRead(id,graph.name,revised);
  }
  function familyGraph(name, family) {
    const start = node('start','trigger','Manual entry',0,257,{type:'manual'});
    const subject = node('subject',family.kind,'Topology subject',345,70,family.config);
    const done = node('done','exit','Success terminal',705,35,{outcome:'success',returns:'"first"'});
    const other = node('other','exit','Failure terminal',705,233,{outcome:'failure',returns:'"second"'});
    const spent = node('spent','exit','Exhausted terminal',705,425,{outcome:'exhausted',returns:'"spent"'});
    const work = node('work','mutate','Return to the gate',25,35,note);
    const alternateWork = node('work-more','mutate','Alternate return',25,455,note);
    const alternateSpent = node('spent-more','exit','Alternate exhaustion',705,617,{outcome:'exhausted',returns:'"alt spent"'});
    const isTrigger = family.kind === 'trigger';
    // A separate route is present as a byte-equal preservation control during all port edits.
    const entry = edge('control','start','out',isTrigger ? 'done' : 'subject');
    entry.ui = {route:[250]};
    return {schemaVersion:4,name:'Canvas '+name+' '+suffix,
      nodes:[start,subject,done,other,spent,...(family.repeat ? [work,alternateWork,alternateSpent] : [])],
      edges:[entry,...(family.repeat ? [
        edge('reenter','work','out','subject'),edge('reenter-more','work-more','out','subject'),
      ] : [])]};
  }
  async function classifierControl() {
    // The real gateway normally seeds this catalog entry. No key and no provider invocation.
    const {items} = await api('GET','/classifier-models',200);
    const jev = items.find((entry)=>entry.id === 'jev');
    check(jev,'Disposable gateway has no built-in classifier contract');
    for (const primitive of ['choice','noul','score']) {
      check(jev.primitives.includes(primitive),'Native fixture catalog lacks '+primitive);
    }
    same(jev.configured,false,'Classifier fixture must have no provider credentials');
    checkpoints.push({label:'existing classifier catalog for draft admission',id:jev.id,
      primitives:jev.primitives,configured:jev.configured});
  }
  async function exerciseFamily(name, family) {
    const graph = familyGraph(name,family);
    const id = await create(graph);
    await open(id,graph.name);
    await modalGateCheck('subject',family.kind,Boolean(family.repeat));
    await portContract('subject',family.kind !== 'trigger',family.ports);
    await portContract('start',false,['out']);
    for (const terminal of ['done','other','spent']) await portContract(terminal,true,[]);
    let last = await get(id);
    if (family.checkOnly) return;
    const method = mode === 'before' ? 'Backspace' : 'visible';
    const present = new Map();
    for (const output of family.ports) {
      const to = family.repeat === output ? 'work' : output === 'limit-reached' ? 'spent' : 'done';
      const {next, added} = await addEdge(id,last,'subject',output,to);
      last = next;
      present.set(output,added);
    }
    // Each distinct authored output repeats the topology operation once. Variant declarations
    // using the same structural branch do not duplicate this sequence.
    for (const output of family.ports) {
      const destination = output === family.repeat ? 'work-more' : output === 'limit-reached' ? 'spent-more' : 'other';
      last = await removeEdge(id,last,present.get(output),method);
      const replacement = await addEdge(id,last,'subject',output,destination);
      last = replacement.next;
      present.set(output,replacement.added);
    }
    await freshRead(id,graph.name,last);
    for (const replacement of present.values()) await edgeEvidence(replacement.id);
    return {id,graph,last};
  }
  async function setupSubloop() {
    const graph = publishWitness('child');
    const id = await create(graph);
    const version = await publishExact(id,await get(id));
    return {...families.subloop,config:{loopRef:{loopId:id,version:version.version},
      input:{mode:'fresh'},output:{mode:'result-only',resultTo:{lastOutput:true}}}};
  }
  async function exerciseModeCarry() {
    const modes = [
      {kind:'trigger',picker:'Trigger type',option:'Webhook',field:'type',expected:'webhook'},
      {kind:'wait',picker:'Mode',option:'duration',field:'mode',expected:'duration'},
    ];
    for (const fixture of modes) {
      const {kind,picker,option,field,expected} = fixture;
      const graph = familyGraph(kind+' mode carry',families[kind]);
      const id = await create(graph);
      await open(id,graph.name);
      const {next,added} = await addEdge(id,await get(id),'subject','out','done');
      const dialog = await openDialog('subject',kind);
      const updated = await editAndRead(id,async()=>{
        await dialog.getByLabel(picker,{exact:true}).selectOption({label:option});
        if (kind === 'wait') await dialog.getByLabel('Seconds',{exact:true}).fill('19');
        await closeDialog(dialog);
      },next,'change '+kind+' mode with existing canvas edge');
      const before = next.draft.definition, after = updated.draft.definition;
      same(after.edges,before.edges,'Mode switch kept the exact edge, including its unaffected route');
      same(after.nodes.filter(({id})=>id!=='subject'),before.nodes.filter(({id})=>id!=='subject'),
        'Mode switch kept all other nodes');
      const subject = after.nodes.find(({id})=>id==='subject');
      same(subject.config[field],expected,'Mode was changed via the real control');
      if (kind==='wait') same(subject.config.seconds,19,'Duration committed independently of the port');
      await freshRead(id,graph.name,updated);
      await portContract('subject',kind!=='trigger',['out']);
      await edgeEvidence(added.id);
    }
  }
  async function runFamilyGroup(group) {
    if (group === 'shared') {
      for (const name of ['trigger','inference','mutate','subloop','wait','heartbeat']) {
        const spec = name === 'subloop' ? await setupSubloop() : families[name];
        await exerciseFamily(name,spec);
      }
      // The three Exit outcomes were observed as targets throughout. Also exercise the modal of
      // each Exit without authoring any fictitious output.
      const graph = familyGraph('exit controls',families.trigger);
      const id = await create(graph);
      await open(id,graph.name);
      for (const terminal of ['done','other','spent']) {
        await portContract(terminal,true,[]);
        await modalGateCheck(terminal,'exit');
      }
      return;
    }
    if (group === 'variants') {
      for (const [branch,config] of Object.entries(triggerTypes)) {
        if (branch !== 'manual') await exerciseFamily('trigger '+branch,{...families.trigger,config,checkOnly:true});
      }
      for (const [branch,config] of Object.entries(waitTypes)) {
        if (branch !== 'input') await exerciseFamily('wait '+branch,{...families.wait,config,checkOnly:true});
      }
      await exerciseModeCarry();
      return;
    }
    if (group === 'script') {
      await exerciseFamily('script routes',families.script);
      const duplicates = {...families.script,config:script({0:'out',7:'retry',8:'retry',23:'report'}),checkOnly:true};
      await exerciseFamily('script dedup',duplicates);
      const refused = familyGraph('script schema control',{...duplicates,config:script({7:'retry',8:'retry'})});
      const response = await api('POST','/loops',400,{definition:refused});
      same(response.code,'VALIDATION_FAILED','Duplicate labels without explicit out fail the schema');
      const listed = await api('GET','/loops',200);
      check(!listed.items.some((entry)=>entry.name===refused.name),'A refused schema fixture wrote a loop');
      return;
    }
    if (group === 'decisions') {
      await classifierControl();
      for (const name of ['expression','llm','choice','noul','score']) {
        await exerciseFamily(name,families[name]);
      }
      return;
    }
    throw new Error('Unsupported family group: '+group);
  }
  function refusals() {
    return mode === 'before'
      ? page.getByRole('status').filter({hasText:'Connection refused:'})
      : delivered.refusals(page);
  }
  async function refusal(reason, label, guidance) {
    const status = refusals();
    if (mode !== 'before') {
      const relevant = status.filter({hasText:reason});
      await relevant.waitFor(wait);
      if (guidance) check(guidance.test(await relevant.innerText()),label+' lacks the expected recovery guidance');
    }
    checkpoints.push({label,expectedReason:reason,rendered:await status.allTextContents()});
  }
  async function occupiedRefusal(label) {
    await refusal('already connected',label,/remove/i);
    if (mode !== 'before') {
      const relevant = refusals().filter({hasText:'already connected'});
      const message = await relevant.innerText();
      check(/delete/i.test(message) && /backspace/i.test(message),
        'Occupied guidance omits retained keyboard deletion shortcuts');
    }
  }
  async function emptyPanePoint() {
    return page.locator('.react-flow__pane').evaluate((pane)=>{
      const bounds = pane.getBoundingClientRect();
      for (const dx of [0.55,0.7,0.85]) {
        for (const dy of [0.7,0.8,0.9]) {
          const x = bounds.left+bounds.width*dx, y = bounds.top+bounds.height*dy;
          if (document.elementFromPoint(x,y) === pane) return {x,y};
        }
      }
      throw new Error('No explicitly hittable empty pane point');
    });
  }
  async function exerciseRefusals() {
    const graph = familyGraph('refused gestures',families.expression);
    const id = await create(graph);
    await open(id,graph.name);
    let last = await get(id);
    const control = await addEdge(id,last,'subject','accept','done');
    last = control.next;
    const slot = port('subject','source','accept');
    const vacant = port('subject','source','decline');
    for (const target of ['done','other']) {
      await unchanged(id,last,()=>connect('subject','accept',target),'Drop occupied origin to '+target);
      await occupiedRefusal('occupied origin to '+target);
    }
    const inert = [
      ['source to source',async()=>draw(vacant,port('start','source','out'))],
      ['target to target',async()=>draw(port('done','target','in'),port('other','target','in'))],
      ['empty pane',async()=>pointer(await center(vacant),await emptyPanePoint())],
      ['near Trigger body',async()=>pointer(await center(vacant),await center(card('start').getByText('Manual entry',{exact:true})))],
    ];
    for (const [label,gesture] of inert) {
      await unchanged(id,last,gesture,label);
      const local = await device(id,last.draftToken);
      same(local.definition,last.draft.definition,label+' left the device graph intact');
    }
    // Make malformed authored states through the real input. The underlying schema refuses
    // the raw ID and the graph remains editable locally, as in the original U22 observation.
    for (const badId of ['Bad ID','accept']) {
      const dialog = await openDialog('subject','decision');
      const routeInput = dialog.locator('[data-field="routes.1.id"] input');
      const before = writes.length;
      await routeInput.fill(badId);
      await routeInput.press('Tab');
      await closeDialog(dialog);
      await page.getByText('Saved on this device only',{exact:true}).waitFor(wait);
      same(writes.length,before,'Invalid form state must not submit a draft');
      const local = await device(id,last.draftToken,false);
      same(local.definition.nodes.find(({id})=>id==='subject').config.routes[1].id,badId,
        'Device holds the exact invalid input');
      same(local.definition.edges,last.draft.definition.edges,'Invalid ID edit kept connected counterpart');
      const candidates=port('subject','source',badId);
      check(await candidates.count()>0,'The authored invalid port has no physical handle in the bound case');
      await unchanged(id,last,()=>draw(candidates.first(),port('other','target','in')),'Refused invalid authored port '+badId);
      await refusal('Finish a unique, valid route ID','invalid authored port '+badId);
      if (badId === 'Bad ID') {
        await page.screenshot({path:'207-'+mode+'-invalid-draft.png',animations:'disabled'});
      }
      same((await device(id,last.draftToken,false)).definition,local.definition,
        'Invalid gesture could not change current device data');
      // Use a distinct valid replacement every time. Reverting to the exact saved body would
      // legitimately produce no PUT and would fail to demonstrate admission resumed.
      const unique = badId === 'Bad ID' ? 'fallback-first' : 'fallback-final';
      const repaired = await openDialog('subject','decision');
      const repair = repaired.locator('[data-field="routes.1.id"] input');
      const repairedState = await editAndRead(id,async()=>{
        await repair.fill(unique);
        await repair.press('Tab');
        await closeDialog(repaired);
      },last,'repair invalid Decision ID');
      same(repairedState.draft.definition.edges,last.draft.definition.edges,'Repair retained existing edge');
      last = repairedState;
    }
    ({next:last} = await addEdge(id,last,'subject','fallback-final','other'));
    const status = refusals();
    // A valid draw clears a diagnostic from an earlier attempted connection.
    same(await status.count(),0,'Successful connection retained stale guidance');
    await freshRead(id,graph.name,last);
  }
  async function exerciseGeometry() {
    const graph = publishWitness('geometry',true);
    const id = await create(graph);
    await open(id,graph.name);
    let last = await get(id);
    const {next,added} = await addEdge(id,last,'gate','again','work');
    last = next;
    await selectEdge(added.id);
    const lane = line(added.id).locator('.gg-route-handle-x').first();
    await lane.waitFor(wait);
    const pathBefore = await edgeEvidence(added.id);
    const beforeNudge = last;
    last = await editAndRead(id,()=>lane.press('ArrowRight'),last,'move back-edge lane independently');
    const {gone,added: geometry} = delta(beforeNudge,last);
    same(gone,[added],'Route nudge touched only the existing edge');
    same(geometry.map(({id,from,to})=>({id,from,to})),[{id:added.id,from:added.from,to:added.to}],
      'Geometry does not change endpoint identity');
    const [manual] = geometry;
    check(manual.ui?.route?.length > 0,'Manual lane did not persist');
    check((await edgeEvidence(added.id)).d !== pathBefore.d,'Rendered path changed with route');
    await unchanged(id,last,async()=>{
      for (const key of ['Delete','Backspace','Enter']) await lane.press(key);
    },'Route handle owns its own keys');
    await lane.press('Escape');
    check(await line(added.id).evaluate((edge)=>document.activeElement===edge),'Escape returns focus to edge');
    const withManual = last;
    last = await removeEdge(id,last,manual,mode === 'before' ? 'Delete' : 'visible');
    const removed = last;
    ({next:last} = await addEdge(id,last,'gate','again','finished'));
    last = await editAndRead(id,undo,last,'undo redraw');
    same(last.draft.definition,removed.draft.definition,'First undo removes new topology only');
    last = await editAndRead(id,undo,last,'undo removal');
    same(last.draft.definition,withManual.draft.definition,'Second undo restores the exact manual edge');
    await freshRead(id,graph.name,last);
    await selectEdge(added.id);
    last = await editAndRead(id,()=>page.getByRole('button',{name:'Reset route',exact:true}).click(),last,'reset recovered route');
    same(last.draft.definition,beforeNudge.draft.definition,'Reset route did not alter topology or other layout');
    await freshRead(id,graph.name,last);
  }
  async function exerciseDeclarations() {
    const third = {id:'defer',label:'Decide later'};
    const graph = familyGraph('declaration ownership',{...families.expression,
      config:{...families.expression.config,routes:[...routes,third]}});
    const id = await create(graph);
    await open(id,graph.name);
    let last = await get(id);
    const first = await addEdge(id,last,'subject','accept','done');
    last = first.next;
    ({next:last} = await addEdge(id,last,'subject','decline','other'));
    ({next:last} = await addEdge(id,last,'subject','defer','spent'));
    const config = (state) => state.draft.definition.nodes.find(({id})=>id==='subject').config;
    const subjectChange = async (dialog, edit, label) => editAndRead(id,async()=>{
      await edit();
      await closeDialog(dialog);
    },last,label);
    const old = last;
    const labelEditor = await openDialog('subject','decision');
    last = await subjectChange(labelEditor,
      ()=>labelEditor.locator('[data-field="routes.0.label"] input').fill('Keep exact chosen route'),
      'Change route label only');
    same(config(last).routes[0],{...config(old).routes[0],label:'Keep exact chosen route'},'Label coexists with stable ID');
    same(last.draft.definition.edges,old.draft.definition.edges,'Label did not change wiring');
    check((await edgeEvidence(first.added.id)).accessibleName.includes('Keep exact chosen route (accept)'),
      'Visible route label and authored ID both survive');
    const beforeMove = last;
    const ordering = await openDialog('subject','decision');
    last = await subjectChange(ordering,()=>ordering.getByRole('button',{name:'Move routes 1 down',exact:true}).click(),
      'Reorder connected declarations');
    same(config(last).routes.map(({id})=>id),['decline','accept','defer'],'Moved declarations through actual control');
    same(last.draft.definition.edges,beforeMove.draft.definition.edges,'Reorder preserved exact existing topology');
    const beforeRename = last;
    const editing = await openDialog('subject','decision');
    last = await subjectChange(editing,async()=>{
      const slot = editing.locator('[data-field="routes.1.id"] input');
      await slot.fill('new-accept');
      await slot.press('Tab');
    },'Rename the connected declaration');
    same(last.draft.definition.edges,beforeRename.draft.definition.edges.map((edge)=>edge.id===first.added.id
      ? {...edge,from:{...edge.from,port:'new-accept'}} : edge),'Rename updated only the declaration’s owned edge');
    const beforeRemoval = last;
    const drop = await openDialog('subject','decision');
    const requestRemove = drop.getByRole('button',{name:'Remove routes 2',exact:true});
    const review = drop.getByRole('region',{name:'Remove connected route?',exact:true});
    await unchanged(id,last,async()=>{
      await requestRemove.click();
      await review.waitFor(wait);
      check((await review.innerText()).includes(first.added.id),'Confirmation names exact edge at risk');
      await drop.getByRole('button',{name:'Cancel change',exact:true}).click();
      await review.waitFor({state:'hidden',...wait});
    },'Cancelling consequence confirmation');
    await requestRemove.click();
    last = await subjectChange(drop,()=>drop.getByRole('button',{name:'Confirm change',exact:true}).click(),
      'Confirm removal of the connected declaration');
    same(config(last).routes.map(({id})=>id),['decline','defer'],'Only confirmed declaration was removed');
    same(last.draft.definition.edges,beforeRemoval.draft.definition.edges.filter(({id})=>id!==first.added.id),
      'Confirmation removed only the owned edge');
    last = await editAndRead(id,undo,last,'undo declaration and its owned edge together');
    same(last.draft.definition,beforeRemoval.draft.definition,'One undo restores declaration and edge atomically');
    await freshRead(id,graph.name,last);
  }
  async function loopIssues() {
    const popover = page.getByRole('dialog',{name:'Loop issues',exact:true});
    const trigger=page.locator('button[aria-haspopup="dialog"][data-severity]').filter({hasText:/\d+ (?:error|warning)/});
    same(await trigger.count(),1,'Distinct loop issues trigger');
    await trigger.click();
    await popover.waitFor(wait);
    return popover;
  }
  async function inspectRecovery(id, last, bad, expectedCode) {
    const validation = await api('POST',route(id)+'/validate',200,{definition:last.draft.definition});
    const diagnoses = validation.issues.filter(({edgeId})=>edgeId===bad.id);
    for (const code of expectedCode) {
      check(diagnoses.some((issue)=>issue.code === code),'Gateway did not diagnose '+code);
    }
    same(await line(bad.id).locator('.react-flow__edge-path').count(),0,'Stored bad edge must have no drawable path');
    const popover = await loopIssues();
    check((await popover.innerText()).includes(bad.id),'Existing issue popover names the bad edge');
    checkpoints.push({label:'stored but undrawable',bad,diagnoses,view:await popover.ariaSnapshot()});
    await page.screenshot({path:'207-'+mode+'-recovery-'+expectedCode.join('-')+'.png',animations:'disabled'});
    if (mode === 'before') {
      // Preserve the baseline missing action. Never use NodeConnections to fake recovery.
      const hidden = popover.getByRole('button',{name:'Remove edge '+bad.id,exact:true});
      same(await hidden.count(),0,'Baseline popover has no exact-edge Remove control');
      await page.keyboard.press('Escape');
      same(await get(id),last,'Baseline did not change stored topology');
      return;
    }
    const remove = popover.getByRole('button',{name:delivered.recoveryRemoveName(bad),exact:true});
    same(await remove.count(),1,'Exactly one recovery action for this stored edge');
    const healthy = last.draft.definition.edges.find((edge)=>edge.id === 'control');
    check(healthy,'Missing drawable control edge');
    same(await popover.getByRole('button',{name:delivered.recoveryRemoveName(healthy),exact:true}).count(),0,
      'A drawable edge has no issue-recovery Remove action');
    const recovered = await editAndRead(id,()=>remove.click(),last,'Remove an exact undrawable edge');
    same(delta(last,recovered),{gone:[bad],added:[]},'Recovery changed only the undrawable edge');
    check(await page.evaluate(()=>document.activeElement && document.activeElement!==document.body),
      'Recovery preserves a real focus target');
    const restored = await editAndRead(id,undo,recovered,'Undo exact recovery');
    same(restored.draft.definition,last.draft.definition,'One undo restores the full invalid topology');
    const redone = await editAndRead(id,redo,restored,'Redo exact recovery');
    same(redone.draft.definition,recovered.draft.definition,'Redo removes that same edge');
    await freshRead(id,redone.draft.definition.name,redone);
  }
  async function exerciseRecovery() {
    const graph = familyGraph('missing target',families.trigger);
    // Both missing target and stale origin port diagnose the same edge. One recovery action.
    const bad = {...edge('orphaned','subject','gone','missing'),ui:{route:[495,302,590]}};
    graph.edges.push(bad);
    const first = await create(graph);
    await open(first,graph.name);
    const baseline = await get(first);
    await inspectRecovery(first,baseline,baseline.draft.definition.edges.find(({id})=>id === bad.id),
      ['EDGE_TO_MISSING','EDGE_PORT_MISSING']);

    const scriptGraph = familyGraph('stale Script port',families.script);
    const id = await create(scriptGraph);
    await open(id,scriptGraph.name);
    const connected = await addEdge(id,await get(id),'subject','retry','done');
    const dialog = await openDialog('subject','script');
    const disclosure = dialog.getByRole('button',{name:/^Advanced\b/});
    if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
    const last = await editAndRead(id,async()=>{
      await dialog.getByRole('button',{name:'Remove exit code routes 7',exact:true}).click();
      await closeDialog(dialog);
    },connected.next,'Remove one label without rewriting stored Script edges');
    const parsed = last.draft.definition.nodes.find(({id})=>id==='subject').config;
    same(parsed.exitCodeRoutes,{0:'out',23:'report'},'Authored Script mapping removed only one label');
    same(last.draft.definition.edges,connected.next.draft.definition.edges,'Stale labelled edge is still stored');
    await portContract('subject',true,['out','report']);
    await inspectRecovery(id,last,connected.added,['EDGE_PORT_MISSING']);
  }
  async function exerciseCoarseRemove() {
    const coarse = await page.evaluate(()=>matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0);
    same(coarse,true,'Requires a touch-enabled coarse Edge context');
    const graph = familyGraph('coarse removal',families.expression);
    const coarseEdge = edge('coarse-edge','subject','accept','done');
    graph.edges.push(coarseEdge);
    const id = await create(graph);
    await open(id,graph.name);
    const last = await get(id);
    const path = line(coarseEdge.id).locator('.react-flow__edge-path');
    await path.waitFor(wait);
    const point = await path.evaluate((svg)=>{
      const hit = svg.parentElement.querySelector('.react-flow__edge-interaction');
      const transform = svg.getScreenCTM();
      for (const fraction of [0.15,0.3,0.5,0.7,0.85]) {
        const point = svg.getPointAtLength(svg.getTotalLength()*fraction).matrixTransform(transform);
        const at = document.elementFromPoint(point.x,point.y);
        if (at === svg || at === hit) return {x:point.x,y:point.y};
      }
      throw new Error('No natural touch hit on the displayed SVG edge');
    });
    await page.touchscreen.tap(point.x,point.y);
    const button = page.getByRole('button',{name:delivered.removeName,exact:true});
    const measure = await center(button);
    check(measure.width>=44 && measure.height>=44,'Visible coarse Remove is below 44×44 CSS pixels');
    await page.screenshot({path:'207-'+mode+'-coarse-remove.png',animations:'disabled'});
    const next = await editAndRead(id,()=>page.touchscreen.tap(measure.x,measure.y),last,'Touch visible selected-edge Remove');
    const expected = last.draft.definition.edges.find(({id})=>id === coarseEdge.id);
    same(delta(last,next),{gone:[expected],added:[]},'One coarse tap removed only the selected edge');
    checkpoints.push({label:'coarse pointer hit and button target',point,measure});
    await freshRead(id,graph.name,next);
  }
  async function exerciseProtectedChat() {
    const {items} = await api('GET','/loops',200);
    const chat = items.find((loop)=>loop.system?.audience?.kind === 'gateway');
    check(chat,'Disposable built gateway did not seed system Chat');
    let last = await get(chat.id);
    const originalRelease = last.current;
    check(originalRelease?.status === 'published','Missing untouched published system Chat');
    check(last.draft?.definition.nodes.some(({id})=>id==='chat-normalize'),
      'Use a fresh disposable gateway and stage voice with the domain helper/public conditional PUT');
    const protectedEdges = last.draft.definition.edges.filter((edge)=>
      edge.from.node==='chat-input' || edge.from.node==='chat-normalize' ||
      (edge.from.node==='chat-normalize-check' && edge.from.port==='invalid'));
    same(protectedEdges.length,3,'Three guarded voice edges');
    const valid = last.draft.definition.edges.find((edge)=>
      edge.from.node==='chat-normalize-check' && edge.from.port==='valid');
    check(valid,'Missing ordinary valid continuation');
    await open(chat.id,chat.name);
    for(const [nodeId,kind] of [['chat-normalize','script'],['chat-normalize-check','decision'],['chat-normalize-invalid','exit']]){
      const dialog=await openDialog(nodeId,kind);
      const idBox=dialog.getByLabel('Node id',{exact:true});
      check(await idBox.evaluate((control)=>control.readOnly),'Protected Chat ID must be readonly');
      check(await dialog.getByRole('button',{name:'Delete node',exact:true}).isDisabled(),'Protected Chat delete must stay unavailable');
      same(await dialog.getByRole('region',{name:'Connections',exact:true}).count(),0,'Protected Chat also has no Connections');
      await closeDialog(dialog);
    }
    // Give a real target input a safe hit point, without mutating the graph or faking a drop.
    await fit();
    for (const protectedEdge of protectedEdges) {
      await selectEdge(protectedEdge.id);
      await unchanged(chat.id,last,()=>page.keyboard.press('Delete'),'Protected keyboard delete '+protectedEdge.id);
      await edgeEvidence(protectedEdge.id);
      await refusal('Voice steps stay','Protected keyboard delete '+protectedEdge.id);
      if (mode !== 'before') {
        await selectEdge(protectedEdge.id);
        const button = page.getByRole('button',{name:delivered.removeName,exact:true});
        if (await button.count()) {
          same(await button.isEnabled(),false,'Protected edge is offered an actionable visible removal');
        }
      }
    }
    const initial = last;
    last = await removeEdge(chat.id,last,valid,mode === 'before' ? 'Backspace' : 'visible');
    const unconnected = last;
    await unchanged(chat.id,last,
      ()=>connect('chat-normalize-check','valid','chat-normalize-invalid'),
      'Vacant continuation attempted a protected direction');
    await refusal('Voice steps stay','drop into protected voice target');
    ({next:last} = await addEdge(chat.id,last,'chat-normalize-check','valid',valid.to.node));
    same(delta(initial,unconnected),{gone:[valid],added:[]},'Changing continuation preserved all guarded edges');
    same(delta(unconnected,last).added.map(({from,to})=>({from,to})),[{from:valid.from,to:valid.to}],
      'Redraw restored ordinary valid continuation without touching voice boundaries');
    same(last.current,originalRelease,'Chat draft topology write changed the published pointer');
    same(await api('GET',route(chat.id)+'/versions/'+originalRelease.id,200),originalRelease,
      'Immutable system Chat version stayed exact');
    await freshRead(chat.id,last.draft.definition.name,last);
  }
  async function exerciseKeyboard() {
    const graph=familyGraph('keyboard ownership',families.script);
    graph.edges.push(edge('keyboard-out','subject','out','done'),edge('keyboard-retry','subject','retry','other'));
    const id=await create(graph);
    await open(id,graph.name);
    let current=await get(id);
    const graphFirst=current.draft.definition;
    await selectEdge('keyboard-retry');
    await unchanged(id,current,async()=>{
      await page.getByRole('button',{name:/^Undo\b/}).focus();
      await page.keyboard.press('Delete');
      await page.keyboard.press('Backspace');
    },'Toolbar focus owns its keys');
    for(const [selected,key] of [['keyboard-retry','Backspace'],['keyboard-out','Delete']]){
      const chosen=current.draft.definition.edges.find(({id})=>id===selected);
      current=await removeEdge(id,current,chosen,key);
      checkpoints.push({label:key+' removed one edge',active:await page.evaluate(()=>document.activeElement?.tagName)});
      await unchanged(id,current,()=>page.keyboard.press(key),'Second key after selected edge removal');
    }
    current=await editAndRead(id,undo,current,'Undo restores exactly one previously deleted edge');
    current=await editAndRead(id,undo,current,'Second Undo restores the earlier keyboard removal');
    same(current.draft.definition,graphFirst,'Both discrete keyboard edits were restored');
    const dialog=await openDialog('subject','script');
    await closeDialog(dialog);
    check(await card('subject').evaluate((item)=>item.classList.contains('selected')),
      'A real node remained selected before edge removal');
    const chosen=current.draft.definition.edges.find(({id})=>id==='keyboard-out');
    current=await removeEdge(id,current,chosen,'visible');
    check(await page.evaluate(()=>document.activeElement?.getAttribute('data-history')==='undo'),
      'Visible Remove moves focus to its undo control');
    await unchanged(id,current,()=>page.keyboard.press('Backspace'),'Undo focus suppresses a stale removal');
    await freshRead(id,graph.name,current);
  }
  async function exerciseModalHistory() {
    const oldSource='/counters/nodeVisits/subject',newSource='/counters/nodeVisits/worker';
    const graph=familyGraph('held input and retained rename',{kind:'mutate',config:{operations:[
      {op:'coerce',source:oldSource,jsonSchema:{type:'integer'},target:'/vars/visits',repair:{enabled:false}},
    ]}});
    graph.variables={visits:{type:'integer'}};
    graph.edges.push(edge('configured-output','subject','out','done'));
    const id=await create(graph);
    await open(id,graph.name);
    const original=await get(id);
    const show=page.getByRole('button',{name:'Show loop settings',exact:true});
    if(await show.isVisible()) await show.click();
    const variables=page.locator('.cm-content').and(page.getByLabel('Variables value 1',{exact:true}));
    await variables.waitFor(wait);
    const beforeText=await variables.textContent();
    await unchanged(id,original,async()=>{
      await variables.click();
      await page.keyboard.press('Control+Home');
      await page.keyboard.insertText('[');
      same(await variables.textContent(),'['+beforeText,'Held text authored without accepting new variables');
    },'Held invalid Variables setup');
    const dialog=await openDialog('subject','mutate');
    same(await dialog.getByRole('region',{name:'Connections',exact:true}).count(),0,'Rename dialog has no Connections');
    const row=dialog.locator('[data-row-path="operations.0"]');
    const toggle=row.locator('button[aria-controls][aria-expanded]').first();
    if(await toggle.getAttribute('aria-expanded')!=='true') await toggle.click();
    const keepId=await row.getAttribute('data-row-id');
    const source=row.getByLabel('Source',{exact:true});
    same(await source.inputValue(),oldSource,'Before rename exact typed pointer');
    const expected=structuredClone(original.draft.definition);
    const subject=expected.nodes.find(({id})=>id==='subject');
    subject.id='worker';
    subject.config.operations[0].source=newSource;
    for(const link of expected.edges){
      if(link.from.node==='subject') link.from.node='worker';
      if(link.to.node==='subject') link.to.node='worker';
    }
    const renamed=await editAndRead(id,async()=>{
      await dialog.getByLabel('Node id',{exact:true}).fill('worker');
      await source.click();
    },original,'Rename complete graph while retaining unrelated held JSON');
    same(renamed.draft.definition,expected,'Rename repairs only typed reference, ID and edges');
    const result=page.getByRole('dialog',{name:'Edit mutate worker',exact:true});
    const currentRow=result.locator('[data-row-path="operations.0"]');
    const focused=currentRow.getByLabel('Source',{exact:true});
    same(await currentRow.getAttribute('data-row-id'),keepId,'Remounted disclosure row keeps identity');
    same(await focused.inputValue(),newSource,'Same disclosed control displays repaired pointer');
    check(await focused.evaluate((el)=>el===document.activeElement),'Native focus survives rename remount');
    await closeDialog(result);
    same(await variables.textContent(),'['+beforeText,'Unrelated held text survives dialog change');
    await unchanged(id,renamed,()=>page.getByRole('button',{name:'Discard the unparsed text',exact:true}).click(),
      'Discard only held text with no definition write');
    same(await variables.textContent(),beforeText,'Explicit discard restores only the previous accepted variable text');
    await freshRead(id,graph.name,renamed);
  }

  async function observePanEvents(edgeId) {
    await page.evaluate(({edgeId,removeName})=>{
      const trace=[], identities=new WeakMap(), fnKeys=new WeakMap();
      let fnSequence=0;
      let sequence=0, current='setup';
      function name(el) {
        if (!(el instanceof Element)) return el===window?'Window':el===document?'Document':null;
        if(!identities.has(el)) identities.set(el,++sequence);
        return { key:identities.get(el), tag:el.tagName, id:el.id||null,
          label:el.getAttribute('aria-label'), role:el.getAttribute('role'),
          className:el.getAttribute('class'), dataId:el.getAttribute('data-id'),
          attached:el.isConnected, disabled:'disabled' in el ? el.disabled : null,
          ariaDisabled:el.getAttribute('aria-disabled'), gesture:el.getAttribute('data-gesture'), expanded:el.getAttribute('aria-expanded'),
          inert:el.closest('[inert]')!==null };
      }
      function functionKey(value) {
        if(typeof value!=='function')return null;
        if(!fnKeys.has(value))fnKeys.set(value,++fnSequence);
        return fnKeys.get(value);
      }
      function listeners() {
        const raw=Array.isArray(window.__on)?window.__on:[];
        return raw.map(({type,name,options,value,listener})=>({type,name,
          capture:typeof options==='boolean'?options:options?.capture??false,
          passive:typeof options==='object'?options?.passive??null:null,
          valueKey:functionKey(value), wrappedKey:functionKey(listener),
          valueText:typeof value==='function'&&type==='click'&&name==='drag'?Function.prototype.toString.call(value):null}));
      }
      const getButton=()=>Array.from(document.querySelectorAll('button')).find(
        (e)=>e.getAttribute('aria-label')===removeName || e.textContent.trim()===removeName);
      const edge=()=>document.querySelector('.react-flow__edge[data-id='+JSON.stringify(edgeId)+']');
      function state(x,y) {
        const button=getButton(), root=edge();
        const r=button?.getBoundingClientRect();
        const buttons=typeof x==='number'&&typeof y==='number' ? document.elementsFromPoint(x,y).slice(0,6) : [];
        const save=document.querySelector('[data-testid="save-state"]');
        return { d3WindowListeners:listeners(), button:name(button), box:r ? {x:r.x,y:r.y,width:r.width,height:r.height}:null,
          render:button ? {pointerEvents:getComputedStyle(button).pointerEvents, visibility:getComputedStyle(button).visibility,
            opacity:getComputedStyle(button).opacity}:null, hits:buttons.map(name),
          reset:name(Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Reset route')),
          edge:name(root), selected:root?.classList.contains('selected')??false,
          toolbar:name(button?.closest('[role="toolbar"]')??button?.parentElement),
          pane:name(document.querySelector('.react-flow__pane')),
          active:name(document.activeElement), viewportStyle:document.querySelector('.react-flow__viewport')?.getAttribute('style'),
          dragging:Array.from(document.querySelectorAll('.dragging,.react-flow__pane.dragging')).map(name),
          save:save?.textContent??null };
      }
      window.__qaCanvasPan = { trace,state, mark(label,x,y) {
        current=label;
        trace.push({stage:current,type:'sample',time:performance.now(),x,y,state:state(x,y)});
      } };
      let traceAfterMove=false;
      new MutationObserver(()=>{
        const v=state();
        if(v.button?.ariaDisabled==='true')traceAfterMove=true;
        trace.push({stage:current,type:'availability',traceAfterMove,time:performance.now(),state:v});
      }).observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['aria-disabled','data-gesture']});
      const types=['wheel','keydown','keyup','pointerdown','mousedown','blur','focusout','focusin','pointerup','mouseup','click',
        'pointercancel','gotpointercapture','lostpointercapture','dragstart','dragend'];
      for(const type of types){
        window.addEventListener(type,event=>{
          const entry={stage:current,phase:'capture',type,time:performance.now(),eventTime:event.timeStamp,
            trusted:event.isTrusted, key:event.key, target:name(event.target),related:name(event.relatedTarget),
            path:event.composedPath().slice(0,8).map(name), x:event.clientX,y:event.clientY,
            button:event.button,buttons:event.buttons,detail:event.detail,pointerId:event.pointerId,
            captured:event.target instanceof Element && Number.isInteger(event.pointerId) ?
              event.target.hasPointerCapture(event.pointerId):null,
            defaultAtCapture:event.defaultPrevented,cancelable:event.cancelable,
            state:state(event.clientX,event.clientY)};
          trace.push(entry);
          queueMicrotask(()=>{entry.defaultAfterDispatch=event.defaultPrevented;entry.d3AfterMicrotask=listeners();});
          setTimeout(()=>{entry.defaultAfterDispatch=event.defaultPrevented;entry.d3AfterTask=listeners();},0);
        },{capture:true,passive:true});
        window.addEventListener(type,event=>{
          trace.push({stage:current,phase:'bubble',type,time:performance.now(),eventTime:event.timeStamp,
            trusted:event.isTrusted,target:name(event.target),defaultPrevented:event.defaultPrevented,
            buttons:event.buttons,detail:event.detail});
        },{passive:true});
      }
    },{edgeId,removeName:delivered.removeName});
  }
  async function markPan(label,point) {
    await page.evaluate(({label,point})=>window.__qaCanvasPan.mark(label,point?.x,point?.y),{label,point});
  }
  async function panTrace() { return page.evaluate(()=>window.__qaCanvasPan.trace); }
  async function selectPanEdge(id) {
    const point=await edgePointer(id);
    check(point,'LLM repeat edge has no hittable path segment');
    await page.mouse.click(point.x,point.y);
    await page.waitForFunction((edgeId)=>document.querySelector(
      '.react-flow__edge[data-id='+JSON.stringify(edgeId)+']')?.classList.contains('selected'),id,wait);
    return point;
  }
  async function settledZoom() {
    const zoom=page.locator('.react-flow__controls-zoomout');
    await zoom.click(wait);
    await zoom.click(wait);
    await page.locator('.react-flow__viewport').evaluate((el)=>new Promise((done,reject)=>{
      let unchanged=0,frames=0,last=el.getAttribute('style');
      function settled(){
        const now=el.getAttribute('style');
        unchanged=now===last ? unchanged+1:0; last=now;
        if(unchanged>8)done();
        else if(++frames>180)reject(new Error('Zoom did not settle'));
        else requestAnimationFrame(settled);
      }
      requestAnimationFrame(settled);
    }));
  }
  function requirePolicy() {
    check(policy?.frozen===true && policy.bundle===bundle,'Freeze the new correction policy before use');
    check(typeof policy.removeName==='string' && typeof policy.recoverySectionName==='string' &&
      typeof policy.recoveryActionPrefix==='string','Exact final accessible roles/copy are required');
  }
  const selectedRemove=()=>page.getByRole('button',{name:policy.removeName,exact:true});
  function listenerArmed(probe) {
    return probe?.d3WindowListeners?.some(item=>item.type==='click'&&item.name==='drag'&&item.capture);
  }
  async function nativePan(move,tag,whilePressed) {
    const at=await emptyPanePoint();
    await markPan(tag+' start',at);
    await page.mouse.move(at.x,at.y);
    await page.mouse.down();
    try {
      await page.mouse.move(at.x+move.x,at.y+move.y,{steps:8});
      await markPan(tag+' moved',{x:at.x+move.x,y:at.y+move.y});
      if(whilePressed)await whilePressed(at);
      await markPan(tag+' release next',{x:at.x+move.x,y:at.y+move.y});
    }finally{await page.mouse.up();}
    await markPan(tag+' release observed');
  }
  async function settleRemove(id){
    await page.waitForFunction(({id,name})=>{
      const candidate=Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===name);
      const edge=document.querySelector('.react-flow__edge[data-id='+JSON.stringify(id)+']');
      return candidate&&!candidate.disabled&&candidate.getAttribute('aria-disabled')!=='true'&&edge?.classList.contains('selected');
    },{id,name:policy.removeName},wait);
    const p=await center(selectedRemove());
    await markPan('first observed enabled control',p);
    return p;
  }
  async function verifyOneRemoval(id,before,edge,key){
    const step=key?'first enabled '+key:'first observed enabled pointer';
    const p=await settleRemove(edge.id);
    await markPan(step,p);
    const after=await editAndRead(id,async()=>{
      if(key){
        await selectedRemove().focus();
        check(await selectedRemove().evaluate(e=>document.activeElement===e),'Actual focus on enabled button');
        await page.keyboard.press(key);
      }else await page.mouse.click(p.x,p.y);
    },before,step+' removes exact edge once');
    same(delta(before,after),{gone:[edge],added:[]},'Removal preserves all unrelated full routes');
    const trace=await panTrace();
    const actionEvent=trace.find(e=>e.stage===step&&e.type==='click'&&e.phase==='capture'&&e.trusted);
    check(actionEvent,'Genuine click event reached the real visible action');
    check(actionEvent.path?.some(row=>row?.key===actionEvent.state?.button?.key),'Trusted click path includes enabled Remove');
    check(actionEvent.state.button.ariaDisabled!=='true','Ready control exposes no stale aria-disabled hold');
    same(listenerArmed(actionEvent.state),false,'First enabled action cannot overlap D3 capture');
    same(actionEvent.defaultAfterDispatch,false,'First enabled activation was not canceled');
    const restored=await editAndRead(id,undo,after,'one Undo restores exact removed edge');
    same(restored.draft.definition,before.draft.definition,'One Undo restores all graph/route bytes');
    checkpoints.push({label:step,trace,after,restored});
    return restored;
  }
  async function correctedPan() {
    requirePolicy();
    const graph=familyGraph('Corrected pan repeat',families.llm);
    const id=await create(graph);
    await open(id,graph.name);
    let last=await get(id),tracked,ordinary;
    for(const portId of families.llm.ports){
      const dest=portId==='decline'?'work':portId==='limit-reached'?'spent':'done';
      const outcome=await addEdge(id,last,'subject',portId,dest);
      last=outcome.next;
      if(portId==='decline')tracked=outcome.added;
      if(portId==='accept')ordinary=outcome.added;
    }
    check(tracked&&ordinary,'Exact Decision repeat and ordinary edges');
    last=await removeEdge(id,last,ordinary,'visible');
    ({next:last}=await addEdge(id,last,'subject','accept','other'));
    await observePanEvents(tracked.id);
    await markPan('select original LLM repeat edge');
    await selectPanEdge(tracked.id);
    const before=last;
    const deviceBefore=await device(id,before.draftToken);
    const count=writes.length;
    await nativePan({x:0,y:110},'first pan',async()=>{
      const target=selectedRemove();
      same(await target.getAttribute('data-gesture'),'panning','Actual move arms the gate');
      same(await target.getAttribute('aria-disabled'),'true','Button is announced unavailable');
      same(await target.evaluate(el=>el.disabled),false,'Ordinary target retains native hit area and focusability');
      await target.focus();
      check(await target.evaluate(el=>document.activeElement===el),'Unavailable target retains actual focus');
      await markPan('keyboard interaction while panning');
      await page.keyboard.press('Space');
      same(await line(tracked.id).count(),1,'Unavailable focused Space did not remove the edge');
    });
    const afterRelease=await panTrace();
    const actual=afterRelease.find(e=>e.stage==='first pan release next'&&e.type==='mouseup'&&e.phase==='capture');
    check(actual?.trusted&&actual.buttons===0,'Actual final mouse release completed');
    const dragClick=afterRelease.find(e=>e.stage==='first pan release next'&&e.type==='click'&&e.phase==='capture');
    check(dragClick?.trusted&&listenerArmed(dragClick.state)&&dragClick.defaultAfterDispatch,
      'Pan release generated and suppressed its own trusted click');
    const armed=afterRelease.filter(e=>listenerArmed(e.state)&&e.state.button&&!e.state.button.disabled);
    check(armed.length>0,'Observe the actual D3 suppression interval');
    for(const event of armed){
      same(event.state.button.ariaDisabled,'true','Retain aria-disabled target through D3 capture');
      check(['panning','settling'].includes(event.state.button.gesture),'Observe declared pan phase');
    }
    const blocked=afterRelease.find(e=>e.type==='click'&&e.phase==='capture'&&e.trusted&&
      e.stage==='keyboard interaction while panning');
    check(blocked&&blocked.state.button.ariaDisabled==='true','Genuine keyboard activation reached the unavailable target');
    const firstReady=afterRelease.find(e=>e.type==='availability'&&e.state.button?.ariaDisabled!=='true'&&
      e.traceAfterMove);
    if(firstReady)same(listenerArmed(firstReady.state),false,'Ready availability mutation follows suppression');
    same(writes.length,count,'Pan release did not actuate Remove');
    // The enabled action is issued before the control readback, avoiding an artificial response delay.
    last=await verifyOneRemoval(id,before,tracked);
    same(deviceBefore.definition,before.draft.definition,'Exact initial local graph');
    // Restore/reselect before each keyboard control, since Undo is a separate editor action.
    await settledZoom();
    for(const key of ['Enter','Space']){
      await markPan('select for '+key);
      await selectPanEdge(tracked.id);
      last=await verifyOneRemoval(id,last,tracked,key);
    }
    await selectPanEdge(tracked.id);
    const beforeOverlap=last;
    const overlapCount=writes.length;
    await nativePan({x:0,y:45},'repeated pan one');
    await nativePan({x:0,y:-32},'repeated pan two',async(at)=>{
      await page.mouse.wheel(0,75);
      await markPan('trusted wheel issued within second mouse gesture',at);
    });
    // This is a public Fit control. Trace records whether its movement was before or after readiness.
    await markPan('native Fit control interaction');
    await page.getByRole('button',{name:'Fit View',exact:true}).click(wait);
    const overlap=await panTrace();
    same(writes.length,overlapCount,'Repeated pan and wheel/Fit did not actuate Remove');
    const latestPan=overlap.find(e=>e.type==='sample'&&e.stage==='repeated pan two moved');
    same(latestPan?.state.button?.gesture,'panning','Latest mouse move cannot be released by earlier generation');
    const wheel=overlap.find(e=>e.type==='wheel'&&e.trusted&&e.phase==='capture');
    check(wheel,'Actual wheel input reached the viewport');
    checkpoints.push({label:'overlap timeline readback',overlap});
    await markPan('select continued exact edge');
    const already=await line(tracked.id).evaluate(e=>e.classList.contains('selected'));
    if(!already)await selectPanEdge(tracked.id);
    last=await verifyOneRemoval(id,beforeOverlap,tracked);
    await freshRead(id,graph.name,last);
  }

  async function correctedReset() {
    requirePolicy();
    const graph=publishWitness('reset-pan',true);
    const id=await create(graph);
    await open(id,graph.name);
    let last=await get(id);
    const added=await addEdge(id,last,'gate','again','work');
    last=added.next;
    await selectEdge(added.added.id);
    const lane=line(added.added.id).locator('.gg-route-handle-x').first();
    await lane.waitFor(wait);
    const manual=await editAndRead(id,()=>lane.press('ArrowRight'),last,'Setup genuine manual route');
    const edge=manual.draft.definition.edges.find(e=>e.id===added.added.id);
    check(edge?.ui?.route?.length,'Actual route nudge persists manual coordinates');
    await settledZoom();
    if(!(await line(edge.id).evaluate(e=>e.classList.contains('selected'))))await selectPanEdge(edge.id);
    await observePanEvents(edge.id);
    const reset=page.getByRole('button',{name:policy.resetName,exact:true});
    const before=writes.length;
    await nativePan({x:0,y:48},'pan with manual route',async()=>{
      same(await reset.getAttribute('aria-disabled'),'true','Reset aria-disabled while panning');
      same(await reset.evaluate(b=>b.disabled),false,'Reset preserves original hit/focus target');
      await reset.focus();
      await markPan('Reset Space while panning');
      await page.keyboard.press('Space');
      check(await reset.count(),'Unavailable Reset did not remove the manual route');
    });
    same(writes.length,before,'No draft edit from unavailable Reset/pan');
    await page.waitForFunction((name)=>[...document.querySelectorAll('button')].some(e=>
      e.textContent.trim()===name&&e.getAttribute('aria-disabled')!=='true'&&!e.disabled),policy.resetName,wait);
    const p=await center(reset);
    await markPan('first ready Reset',p);
    const after=await editAndRead(id,()=>page.mouse.click(p.x,p.y),manual,'First ready Reset changes geometry once');
    same(after.draft.definition,last.draft.definition,'Reset restores exact automatic geometry only');
    const events=await panTrace();
    const first=events.find(e=>e.stage==='first ready Reset'&&e.type==='click'&&e.phase==='capture'&&e.trusted);
    check(first&&first.path.some(p=>p?.key===first.state.reset?.key),'Actual ready Reset receives first click');
    same(listenerArmed(first.state),false,'Ready Reset follows actual D3 suppression');
    const reversed=await editAndRead(id,undo,after,'One Undo restores exact manual route');
    same(reversed.draft.definition,manual.draft.definition,'Reset Undo exact graph');
    checkpoints.push({label:'native manual Reset gate',events,edge});
  }

  async function observeNodeDragReachability() {
    const graph=familyGraph('node drag witness',families.expression);
    const id=await create(graph);
    await open(id,graph.name);
    const initial=await addEdge(id,await get(id),'subject','accept','done');
    let last=initial.next;
    await settledZoom();
    const tracked=initial.added;
    await observePanEvents(tracked.id);
    const header=card('other').getByText('Failure terminal',{exact:true});
    const cases=['ordinary','Shift','Control'];
    for(const how of cases){
      await selectPanEdge(tracked.id);
      const before=last, count=writes.length;
      const a=await center(header);
      if(how!=='ordinary')await page.keyboard.down(how);
      try{
        await markPan(how+' node drag',a);
        await page.mouse.move(a.x,a.y);
        await page.mouse.down();
        try{await page.mouse.move(a.x-36,a.y+46,{steps:7});}
        finally{await page.mouse.up();}
        await markPan(how+' after native node mouseup');
      } finally{if(how!=='ordinary')await page.keyboard.up(how);}
      const reach=await selectedRemove().count();
      const selection=await line(tracked.id).evaluate(el=>el.classList.contains('selected'));
      const result={label:'native '+how+' node-drag reachability',reach,selection};
      if(reach&&selection){
        const box=await selectedRemove().evaluate(b=>{
          const r=b.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
          const e=document.elementFromPoint(x,y);
          return {x,y,hittable:b===e||b.contains(e),enabled:!b.disabled&&b.getAttribute('aria-disabled')!=='true'};
        });
        Object.assign(result,{button:box});
        if(box.hittable&&box.enabled){
          await markPan(how+' immediate selected Remove',box);
          await page.mouse.click(box.x,box.y);
        }
      }
      await page.getByTestId('save-state').filter({hasText:'All changes saved'}).waitFor(wait);
      await page.waitForTimeout(850);
      const after=await get(id),local=await device(id,after.draftToken),trace=await panTrace();
      same(local.definition,after.draft.definition,'Observed drag and action exact synced graph');
      const old=before.draft.definition.nodes.find(n=>n.id==='other');
      const moved=after.draft.definition.nodes.find(n=>n.id==='other');
      check(canon(old.ui)!==canon(moved.ui),'Actual node position changed during the test');
      const movedGraph=structuredClone(before.draft.definition);
      movedGraph.nodes.find(n=>n.id==='other').ui=moved.ui;
      const removeEvent=trace.find(e=>e.stage===how+' immediate selected Remove'&&
        e.type==='click'&&e.phase==='capture'&&e.trusted);
      const w=writes.slice(count);
      Object.assign(result,{events:trace,writes:w,after,local,removeEvent});
      checkpoints.push(result);
      if(removeEvent&&listenerArmed(removeEvent.state)&&removeEvent.defaultAfterDispatch){
        same(after.draft.definition,movedGraph,'Lost click preserved entire graph except actual drag geometry');
        same(w.length,1,'Only drag wrote, trusted Remove sent zero PUTs');
        throw Error('Confirmed enabled Remove swallowed by node-drag callback');
      }
      if(removeEvent){
        check(after.draft.definition.edges.every(e=>e.id!==tracked.id),'First real node-drag follow-up Remove activated');
        const afterMove=await editAndRead(id,undo,after,'Undo selected-edge removal after node drag');
        same(afterMove.draft.definition,movedGraph,'One Undo restores only the pressed removal');
        last=afterMove;
      }else{
        same(after.draft.definition,movedGraph,'No reachable removal and all connections stayed exact');
        last=after;
      }
      const initialGeometry=await editAndRead(id,undo,last,'Undo exact node move');
      same(initialGeometry.draft.definition,before.draft.definition,'One node undo restores exact original graph');
      last=initialGeometry;
    }
  }

  function blankPortDefinition(draft,value) {
    const next=structuredClone(draft);
    next.nodes.find(e=>e.id==='subject').config.routes[2].id=value;
    return next;
  }
  async function ownedBlank(id,last,expected,edge,oldRow,draftPuts,label,owned=true) {
    await page.getByTestId('save-state').filter({hasText:'Saved on this device only'}).waitFor(wait);
    const local=await device(id,last.draftToken,false,{edgeId:edge.id,owned});
    same(local.definition,expected,label+' exact device-only graph');
    const row=local.decisionRoutes?.subject?.rows[2];
    check(row?.key!==undefined,label+' actual device owner row is present');
    same(row.id,'',label+' device owner tracks the same invalid authored value');
    if(oldRow)same(row.key,oldRow.key,label+' stable route owner key');
    const ownership=local.decisionRoutes?.subject?.rows[2]?.edgeIds;
    if(owned)same(ownership,[edge.id],label+' exact stored edge stays owned by this row');
    else same(ownership,[],label+' removed edge leaves no row ownership');
    same(await get(id),last,label+' server definition/token unchanged');
    same(writes.filter(e=>e.path===file(id)).length,draftPuts,label+' no invalid server PUT');
    same(await port('subject','source','route-3').count(),0,label+' no fabricated old source handle');
    same(await line(edge.id).count(),0,label+' no fabricated edge path');
    checkpoints.push({label,local,persisted:last,ownership});
    return local;
  }
  async function correctedBlankRecovery(remove) {
    requirePolicy();
    const config={...families.expression.config,routes:[...families.expression.config.routes,
      {id:'route-3',label:'7'}]};
    const graph=familyGraph(remove?'blank recovery':'blank repair',{...families.expression,config});
    const id=await create(graph);
    await open(id,graph.name);
    const connected=await addEdge(id,await get(id),'subject','route-3','other');
    let last=connected.next, retained=connected.added;
    if(remove){
      // Author a disposable public test case with an exact manual route after native connection.
      // It is setup, and the subsequent behavioral route/removal paths remain fully native.
      const fixture=structuredClone(last.draft.definition);
      fixture.edges.find(e=>e.id===retained.id).ui={route:[510]};
      const reply=await page.request.put(origin+file(id),{headers:{'if-match':'"'+last.draftToken+'"'},data:{definition:fixture}});
      same(reply.status(),200,'Manual route fixture staged under exact draft token');
      last=await get(id);
      retained=last.draft.definition.edges.find(e=>e.id===retained.id);
      same(retained.ui,{route:[510]},'Canonical explicit route available for exact recovery');
      await open(id,graph.name);
    }
    // The browser mirrors a strict device revision, including DecisionRoutes metadata.
    let dialog=await openDialog('subject','decision');
    const routeLabel=dialog.locator('[data-field="routes.2.label"] input');
    last=await editAndRead(id,()=>routeLabel.fill('7 checked'),last,'native canonical ownership witness');
    const synced=await device(id,last.draftToken);
    same(synced.definition,last.draft.definition,'Synced canonical graph is exact before blank');
    const blank=blankPortDefinition(last.draft.definition,'');
    const count=writes.filter(e=>e.path===file(id)).length;
    const field=()=>page.getByRole('dialog',{name:'Edit decision subject',exact:true})
      .locator('[data-field="routes.2.id"] input');
    await field().fill('');
    same(await field().getAttribute('aria-invalid'),'true','Blank ID visibly invalid');
    const initialBlank=await ownedBlank(id,last,blank,retained,undefined,count,'blank holds exact ownership');
    const owned=initialBlank.decisionRoutes.subject.rows[2];
    if(!remove){
      await page.reload();
      dialog=await openDialog('subject','decision');
      same(await field().inputValue(),'','Reload restores blank from actual device record');
      await ownedBlank(id,last,blank,retained,owned,count,'reload holds exact ownership');
      const repaired=await editAndRead(id,()=>field().fill('route-4'),last,'repair same logical route');
      const expected=blankPortDefinition(last.draft.definition,'route-4');
      expected.edges.find(e=>e.id===retained.id).from.port='route-4';
      same(repaired.draft.definition,expected,'Repair moves only the same edge from the old port');
      await port('subject','source','route-4').waitFor(wait);
      check((await edgeEvidence(retained.id)).accessibleName.includes('(route-4)'),'Same canvas id repairs visibly');
      const restored=await editAndRead(id,()=>field().fill('route-3'),repaired,'restore original valid port');
      same(restored.draft.definition,last.draft.definition,'Restoring original port restores exact graph');
      await closeDialog(dialog);
      await freshRead(id,graph.name,restored);
      return;
    }
    await closeDialog(dialog);
    const popover=await loopIssues();
    const section=popover.getByRole(policy.recoverySectionRole,{name:policy.recoverySectionName,exact:true});
    await section.waitFor(wait);
    const removeButton=section.getByRole('button',{name:policy.recoveryActionPrefix+retained.id,exact:true});
    same(await removeButton.count(),1,'Only one recovery action for this edge');
    const text=await section.innerText();
    for(const token of ['subject','route-3','other'])check(text.includes(token),'Recovery prints exact endpoint '+token);
    const beforeRecovery=await popover.ariaSnapshot();
    await removeButton.click();
    const deleted=structuredClone(blank);
    deleted.edges=deleted.edges.filter(e=>e.id!==retained.id);
    await ownedBlank(id,last,deleted,retained,owned,count,'remove one invalid-state stored edge',false);
    await undo();
    await ownedBlank(id,last,blank,retained,owned,count,'Undo restores exact blank-state graph and ownership');
    checkpoints.push({label:'public recovery popover and one Undo',beforeRecovery,retained});
  }

  let failure = null;
  try {
    check(/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(origin) && !/:474[78]$/.test(origin),'Refused owner or nonfixture origin');
    check(mode==='after' && mapping==='207-final-independent-native-v1','Require the clean postdeletion runtime binding');
    check(/^\/app\/assets\/index-[\w-]+\.js$/.test(bundle??''),'Require the current main bundle');
    const modeled = ['topology','shared','variants','script','decisions','repeat-publish','refusals','geometry',
      'declarations','recovery','coarse-remove','chat','keyboard','modal-history'];
    check(modeled.includes(action), 'Unsupported case; see fixture-readiness.md for cases awaiting implementation');
    check(mode === 'before' || delivered, 'Canvas-ready/after must be bound to the delivered UI first');
    check(action !== 'coarse-remove' || mode !== 'before','Visible coarse Remove requires the delivered canvas toolbar');
    check(/^[1-9][0-9]*$/.test(expectedGatewayPid ?? ''),'Pass the verified disposable gateway PID');
    const health = await page.request.get(origin+'/healthz',{timeout:5000});
    same(health.status(),200,'Disposable built gateway health');
    same(health.headers()['x-graphgoblin-pid'],expectedGatewayPid,'Refused a gateway from a different fixture');
    if (action !== 'topology') {
      requirePolicy();
      if (group === 'pan') await correctedPan();
      else if(group==='reset')await correctedReset();
      else if(group==='node-drag')await observeNodeDragReachability();
      else if(group === 'blank-ownership')await correctedBlankRecovery(false);
      else if(group === 'blank-recovery')await correctedBlankRecovery(true);
      else if(group === 'coarse')await exerciseCoarseRemove();
      else if(group === 'chat')await exerciseProtectedChat();
      else throw new Error('Independent correction group needs an explicit supported mapping');
      same(errors,[],'Unexpected browser page errors');
      check(loaded.includes(200),'Actual matching bundle loaded');
      return {suite:'207-corrected-canvas-delta-independent',mode,action,origin,loaded,checkpoints,writes,pageErrors:errors,failure,
        browser:await page.evaluate(()=>navigator.userAgent)};
    }
    const graph = fixture();
    const id = await create(graph);
    let from = await get(id);
    await open(id,graph.name);
    await modalGateCheck('gate','decision',true);
    same((await ports('start')).map(({direction,id})=>[direction,id]),[['source','out']],'Trigger has no input');
    for (const exit of ['done','alternate','limit']) {
      same((await ports(exit)).map(({direction,id})=>[direction,id]),[['target','in']],'Exit has no output');
    }
    same((await ports('gate')).filter((p)=>p.direction==='source').map((p)=>p.id),
      ['loop','finish','limit-reached'],'Conditional limit handle and stable declared IDs');
    const d = connect;
    const before = from;
    from = await editAndRead(id,()=>d('gate','loop','work'),from,'create cycle branch by pointer');
    const repeat = delta(before,from);
    same(repeat.gone,[],'Creating repeat touched no other edge');
    same(repeat.added.map(({from,to})=>[from,to]),[[{node:'gate',port:'loop'},{node:'work',port:'in'}]],'Created exact cycle endpoint');
    const priorFinish = from;
    from = await editAndRead(id,()=>d('gate','finish','done',true),from,'click-connect finish branch');
    const finish = delta(priorFinish,from);
    same(finish.gone,[],'Creating finish touched no other edge');
    const [old] = finish.added;
    same(finish.added.map(({from,to})=>[from,to]),[[{node:'gate',port:'finish'},{node:'done',port:'in'}]],'Created exact finish endpoint');
    const rendered = await edgeEvidence(old.id);
    check(rendered.accessibleName.includes('Keep result (finish)') && /^M/.test(rendered.d),'Path exposes stable ID and label');
    await unchanged(id,from,()=>d('gate','finish','alternate'),'Occupied-output drop');
    if (mode !== 'before') {
      await occupiedRefusal('Occupied drop');
    } else {
      checkpoints.push({ label: 'baseline occupied-output guidance',
        alerts: await page.getByRole('status').filter({hasText:'Connection refused:'}).allTextContents() });
    }
    const restore = from;
    from = await removeEdge(id,restore,old,'Delete');
    const without = from;
    from = await editAndRead(id,()=>d('gate','finish','alternate'),from,'draw new destination explicitly');
    const changed = delta(without,from);
    same(changed.gone,[],'Replacement changed no unaffected edge');
    same(changed.added.length,1,'One replacement created');
    same(changed.added[0].to,{node:'alternate',port:'in'},'Replacement changed exact target');
    check(!changed.added[0].ui?.route,'Replacement inherited deleted route geometry');
    const changedDefinition = from.draft.definition;
    from = await editAndRead(id,undo,from,'undo connection creation');
    same(from.draft.definition,without.draft.definition,'First Undo leaves old edge deleted');
    from = await editAndRead(id,undo,from,'undo edge removal');
    same(from.draft.definition,restore.draft.definition,'Second Undo restores original edge');
    from = await editAndRead(id,redo,from,'redo edge removal');
    same(from.draft.definition,without.draft.definition,'First Redo removes original');
    from = await editAndRead(id,redo,from,'redo new endpoint');
    same(from.draft.definition,changedDefinition,'Second Redo restores replacement');
    await open(id,graph.name);
    same((await get(id)).draft.definition,changedDefinition,'Reload retains exact topology');
    const replacement = await edgeEvidence(changed.added[0].id);
    check(replacement.accessibleName.includes('alternate'),'Reloaded edge reflects new target');
    checkpoints.push({ rendered, replacement });
    if (mode !== 'before') {
      const beforeVisibleRemove = await get(id);
      await removeEdge(id,beforeVisibleRemove,changed.added[0],'visible');
      check(await page.evaluate(()=>document.activeElement && document.activeElement !== document.body),
        'Focus remained on a usable surface after edge removal');
    }
    same(errors,[],'Unexpected browser page errors');
    check(loaded.includes(200),'Actual matching bundle loaded');
  } catch (error) {
    failure = { message:String(error),stack:error.stack };
    if (['before','canvas-ready','after'].includes(mode) && /^[a-z-]+$/.test(action ?? '')) {
      await page.screenshot({path:'first-canvas-' + mode + '-' + action + '.png',animations:'disabled'}).catch(()=>{});
    }
  }
  return { suite:'207-corrected-canvas-delta-independent',mode,action,origin,loaded,checkpoints,writes,pageErrors:errors,failure };
}
