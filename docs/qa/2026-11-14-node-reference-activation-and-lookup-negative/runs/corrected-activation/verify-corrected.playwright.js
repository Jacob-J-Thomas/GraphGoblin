async (page) => {
  const start = new URL(page.url());
  const origin = start.origin;
  const phase = start.searchParams.get('qa-phase');
  const scenario = start.searchParams.get('qa-scenario');
  const bundle = start.searchParams.get('qa-bundle');
  const pid = start.searchParams.get('qa-pid');
  const rowCommit = start.searchParams.get('qa-commit') ?? 'pointer';
  const wait = {timeout:8000};
  const writes = [], checkpoints = [], bundles = [], pageErrors = [];
  let active = 'initialize', failure = null, outcome = null, id;
  const canonical = (value)=>JSON.stringify(value,(_,item)=>item && typeof item==='object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key)=>[key,item[key]])) : item);
  const check = (value,message)=>{if(!value) throw new Error(message);};
  const same = (a,b,message)=>check(canonical(a)===canonical(b),message+'\nExpected '+canonical(b)+'\nObserved '+canonical(a));
  const clone = (value)=>JSON.parse(JSON.stringify(value));
  const sleep = (ms)=>new Promise((done)=>setTimeout(done,ms));
  const targetNode = (definition,id)=>definition.nodes.find((item)=>item.id===id);
  const row = (dialog,path)=>dialog.locator('[data-row-path='+JSON.stringify(path)+']');
  const field = (dialog,path)=>dialog.locator('[data-field='+JSON.stringify(path)+']');
  const content = (dialog,path)=>field(dialog,path).locator('.cm-content');
  const mutates = (node)=>({operations:node.operations});

  page.on('pageerror',(error)=>pageErrors.push(String(error)));
  page.on('response',(response)=>{
    const resource = new URL(response.url()).pathname;
    if (resource === bundle) bundles.push(response.status());
  });
  page.on('request',(request)=>{
    if (request.method()!=='PUT' || new URL(request.url()).pathname!=='/loops/'+id+'/draft') return;
    writes.push({body:request.postDataJSON(),ifMatch:request.headers()['if-match']??null,at:Date.now()});
  });
  async function api(method,path,expected,body) {
    const response = await page.request.fetch(origin+path,{method,timeout:10000,
      ...(body===undefined ? {} : {data:body})});
    const data = await response.json();
    same(response.status(),expected,method+' '+path+' '+canonical(data));
    return data;
  }
  const detail = ()=>api('GET','/loops/'+id,200);
  const draftPath = ()=>'/loops/'+id+'/draft';
  async function device(token) {
    const match = await page.waitForFunction(async ({id,token})=>{
      const value = await new Promise((done)=>{
        const opened=indexedDB.open('graphgoblin');
        opened.onupgradeneeded=()=>opened.transaction.abort();
        opened.onerror=()=>done(null);
        opened.onsuccess=()=>{
          const database=opened.result;
          try {
            const get=database.transaction('drafts').objectStore('drafts').get(id);
            get.onerror=()=>{database.close();done(null);};
            get.onsuccess=()=>{database.close();done(get.result??null);};
          } catch {database.close();done(null);}
        };
      });
      return value?.synced && value.baseToken===token && value;
    },{id,token},wait);
    const value=await match.jsonValue();
    await match.dispose();
    return value;
  }
  async function amend(previous,expected,work,label) {
    const startCount=writes.length;
    const [reply]=await Promise.all([
      page.waitForResponse((candidate)=>candidate.request().method()==='PUT' &&
        new URL(candidate.url()).pathname===draftPath(),wait),
      Promise.resolve().then(work),
    ]);
    const payload = await reply.json();
    same(reply.status(),200,label+' saved');
    same(writes.length-startCount,1,label+' sent one complete PUT');
    same(writes.at(-1).ifMatch,'"'+previous.draftToken+'"',label+' used exact starting token');
    same(writes.at(-1).body.definition,expected,label+' submitted exact whole graph');
    const stored=await detail();
    same(stored.draft,payload.draft,label+' returned exact persisted version');
    same(stored.draft.definition,expected,label+' stored exact graph');
    same(stored.draftToken,payload.draftToken,label+' preserved response revision');
    const local=await device(stored.draftToken);
    same(local.definition,expected,label+' stored exact device graph');
    checkpoints.push({label,stored,local});
    return stored;
  }
  async function noWrite(work,expected,label) {
    const at=writes.length;
    await work();
    await sleep(850);
    same(writes.length,at,label+' wrote a draft');
    same(await detail(),expected,label+' changed the server version or token');
    if (at>0) same((await device(expected.draftToken)).definition,expected.draft.definition,label+' changed local graph');
  }
  async function open(definition) {
    id=(await api('POST','/loops',201,{definition})).loop.id;
    await page.goto(origin+'/app/loops/'+id+'/edit');
    await page.getByRole('heading',{name:definition.name,exact:true}).waitFor(wait);
    await page.getByText('The editor is available. Checking the server and this device before saving changes.',{exact:true})
      .waitFor({state:'hidden',...wait});
    return detail();
  }
  async function openNode(node,kind) {
    const card=page.locator('.react-flow__node[data-id='+JSON.stringify(node)+']');
    await card.press('Enter');
    const dialog=page.getByRole('dialog',{name:'Edit '+kind+' '+node,exact:true});
    await dialog.waitFor(wait);
    return dialog;
  }
  const openMutate = (id)=>openNode(id,'mutate');
  async function close(dialog) {
    await dialog.getByRole('button',{name:'Done',exact:true}).click();
    await dialog.waitFor({state:'hidden',...wait});
  }
  const toggle = (dialog,index)=>row(dialog,'operations.'+index).locator('button[aria-controls][aria-expanded]').first();
  async function expand(dialog,index) {
    const button=toggle(dialog,index);
    if (await button.getAttribute('aria-expanded')!=='true') await button.click();
    same(await button.getAttribute('aria-expanded'),'true','Expanded exact operation '+index);
  }
  const caption = (label)=>page.screenshot({path:phase+'-'+scenario+'-'+label+'.png',animations:'disabled'});
  async function view(dialog) {
    return dialog.evaluate((root)=>{
      const active=document.activeElement;
      const rows=[...root.querySelectorAll('[data-row-path]')].map((element)=>{
        const toggle=[...element.querySelectorAll('button[aria-expanded][aria-controls]')]
          .find((item)=>item.closest('[data-row-path]')===element);
        return {id:element.getAttribute('data-row-id'),path:element.getAttribute('data-row-path'),
          open:toggle?.getAttribute('aria-expanded')??null};
      });
      return {name:root.getAttribute('aria-labelledby')??null,rows,
        focused:{field:active?.closest('[data-field]')?.getAttribute('data-field')??null,
          row:active?.closest('[data-row-path]')?.getAttribute('data-row-path')??null,
          id:active?.closest('[data-row-id]')?.getAttribute('data-row-id')??null,
          label:active?.getAttribute('aria-label')??null,
          type:active?.getAttribute('role')??active?.tagName??null,
          value:active instanceof HTMLInputElement ? active.value : null,
          text:active?.matches('.cm-content') ? active.textContent : null,
          isToggle:active?.matches('button[aria-expanded][aria-controls]')??false,
          displayed:Boolean(active?.getClientRects().length)}};
    });
  }
  const node = (id,kind,label,x,config)=>({id,kind,label,ui:{x,y:120},config});
  const wire = (id,from,to)=>({id,from:{node:from,port:'out'},to:{node:to,port:'in'}});
  const template = (text)=>({op:'append-message',role:'note',content:text});
  function graph(name,subject,extra) {
    const nodes=[node('start','trigger','Start',0,{type:'manual'}),subject,...(extra ? [extra] : []),
      node('end','exit','End',extra ? 920 : 600,{})];
    return {schemaVersion:4,name:name+' '+crypto.randomUUID().slice(0,7),nodes,
      edges:extra ? [wire('entry','start',subject.id),wire('next',subject.id,extra.id),wire('out',extra.id,'end')]
        : [wire('entry','start',subject.id),wire('out',subject.id,'end')]};
  }
  function rewritten(definition,oldId,newId) {
    const expected=clone(definition);
    targetNode(expected,oldId).id=newId;
    for(const edge of expected.edges) {
      if(edge.from.node===oldId) edge.from.node=newId;
      if(edge.to.node===oldId) edge.to.node=newId;
    }
    return expected;
  }
  async function readDevice() {
    return page.evaluate((loopId)=>new Promise((done)=>{
      const opened=indexedDB.open('graphgoblin');
      opened.onerror=()=>done(null);
      opened.onupgradeneeded=()=>opened.transaction.abort();
      opened.onsuccess=()=>{
        const db=opened.result;
        const get=db.transaction('drafts').objectStore('drafts').get(loopId);
        get.onsuccess=()=>{db.close();done(get.result??null)};
        get.onerror=()=>{db.close();done(null)};
      };
    }),id);
  }
  async function activation() {
    const results=[];
    for(const name of ['add','remove']) {
      for(const strategy of ['steady','pending']) {
        active=name+' '+strategy;
        const fixture=graph('Form activation '+active,node('work','mutate','Self pointer repair',310,mutates({operations:[
          {op:'coerce',source:'/counters/nodeVisits/work',jsonSchema:{type:'integer'},target:'/vars/visits',repair:{enabled:false}},
          template('Ordinary removable row versus repaired Coerce row'),
        ]})));
        fixture.variables={visits:{type:'integer'}};
        const accepted=await open(fixture);
        let dialog=await openMutate('work');
        const label=name==='add'?'Add operations':'Remove operations 2';
        const button=dialog.getByRole('button',{name:label,exact:true});
        const idBox=dialog.getByLabel('Node id',{exact:true});
        if(strategy==='pending') await idBox.fill('worker'); else await idBox.focus();
        const expectedId=strategy==='pending'?'worker':'work';
        same(await idBox.inputValue(),expectedId,'Exact focused ID before gesture');
        await button.scrollIntoViewIfNeeded(wait);
        const oldButton=await button.elementHandle();
        const point=await oldButton.evaluate((control)=>{
          const box=control.getBoundingClientRect();
          const x=box.x+box.width/2,y=box.y+box.height/2;
          const hit=document.elementFromPoint(x,y);
          return {x,y,hittable:hit===control||control.contains(hit),label:control.getAttribute('aria-label')||control.textContent};
        });
        check(point.hittable && await button.isEnabled(),'Real pointer target must be enabled and hittable');
        check(await idBox.evaluate((el)=>el===document.activeElement),'ID retains exact focus until the gesture');
        await page.evaluate(()=>{
          window.activationEvents=[];
          for(const type of ['pointerdown','pointerup','mousedown','mouseup','click','focusout','focusin']){
            document.addEventListener(type,(event)=>{
              const elm=event.target;
              window.activationEvents.push({type,tag:elm.tagName,role:elm.getAttribute?.('role'),
                aria:elm.getAttribute?.('aria-label'),text:elm.closest?.('button')?.textContent?.trim()??null,
                id:elm.id||null,trusted:event.isTrusted});
            },true);
          }
        });
        const began=writes.length;
        await caption(name+'-'+strategy+'-before');
        await page.mouse.move(point.x,point.y);
        await page.mouse.down();
        const connectedAfterDown=await oldButton.evaluate((el)=>el.isConnected);
        await page.mouse.up();
        await sleep(1050);
        const events=await page.evaluate(()=>window.activationEvents);
        dialog=page.getByRole('dialog',{name:'Edit mutate '+expectedId,exact:true});
        await dialog.waitFor(wait);
        const ui=await view(dialog),durable=await detail(),local=await readDevice(),sent=writes.slice(began);
        const expected=strategy==='pending'?rewritten(accepted.draft.definition,'work','worker'):clone(accepted.draft.definition);
        const expectedSubject=targetNode(expected,expectedId);
        if(strategy==='pending')expectedSubject.config.operations[0].source='/counters/nodeVisits/worker';
        const stored=targetNode(durable.draft.definition,expectedId);
        check(stored,'The pending ID should be accepted before attributing target activation');
        same(stored.config.operations[0].source,expectedSubject.config.operations[0].source,'Exact self-reference repair');
        same(connectedAfterDown,strategy==='steady','The pending gesture commits rename and remounts before mouseup');
        const size=(state)=>state.rows.filter(({path})=>/^operations\.\d+$/.test(path)).length;
        const wanted=name==='add'?3:1;
        const activated=size(ui)===wanted;
        const observation={name,strategy,point,connectedAfterDown,activated,ui,events,sent,before:accepted,durable,local};
        results.push(observation);
        checkpoints.push({label:active,...observation});
        await caption(name+'-'+strategy+'-after');
        if(strategy==='steady')check(activated,'Steady-ID pointer control must activate');
        if(!activated || name==='remove') {
          if(activated) expectedSubject.config.operations.splice(1,1);
          same(durable.draft.definition,expected,'Exact graph after the valid gesture');
          same(local.definition,expected,'Exact synced device graph');
          same(local.baseToken,durable.draftToken,'Device uses the exact saved token');
          same(local.synced,true,'Expected a synced copy after the accepted action');
          same(sent.length,1,'One debounced terminal graph save');
          same(sent[0].ifMatch,'"'+accepted.draftToken+'"','Save started on the original token');
        } else {
          const owner=await readDevice();
          const deviceSubject=targetNode(owner?.definition??{nodes:[]},expectedId);
          check(deviceSubject?.config.operations.length===3,'Browser Add is represented by the actual device graph');
          same(owner.synced,false,'Blank required path on new default operation is held on the device');
          same(deviceSubject.config.operations.slice(0,2),expectedSubject.config.operations,'Original device operations remain exact');
        }
        await oldButton.dispose();
        if(strategy==='pending' && !activated){
          const beforeSecond=await detail();
          await dialog.getByRole('button',{name:label,exact:true}).click();
          await sleep(950);
          const uiSecond=await view(dialog);
          same(size(uiSecond),wanted,'Same action works once rename has settled');
          observation.secondClick={before:beforeSecond,after:await detail(),ui:uiSecond,local:await readDevice()};
          await caption(name+'-pending-after-second');
        }
      }
    }
    return results;
  }
  try {
    check(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) && !/:474[78]$/.test(origin),'Refused owner or nonfixture origin');
    check(phase==='corrected','Candidate assertions require the corrected frozen phase');
    check(scenario==='activation','Specify the bounded pointer activation scenario');
    check(['pointer','enter'].includes(rowCommit),'Select the native rename commitment method');
    check(/^\/app\/assets\/index-[\w-]+\.js$/.test(bundle??'') && /^[1-9]\d*$/.test(pid??''),
      'Pass the independently bound entry and owned gateway PID');
    const health=await page.request.get(origin+'/healthz',{timeout:5000});
    same(health.status(),200,'Disposable gateway readiness');
    same(health.headers()['x-graphgoblin-pid'],pid,'Refused foreign gateway');
    active=scenario;
    outcome=await activation();
    check(bundles.includes(200),'Renderer did not load the bound entry bundle');
    same(pageErrors,[],'Uncaught browser errors');
  } catch (error) {
    failure={active,message:String(error),stack:error.stack};
    if (phase==='corrected' && scenario==='activation') {
      await caption('first-failure').catch(()=>{});
    }
  }
  return {origin,suite:'273-pointer-activation-independent',phase,scenario,rowCommit,bundles,outcome,
    writes,checkpoints,pageErrors,failure};
}
