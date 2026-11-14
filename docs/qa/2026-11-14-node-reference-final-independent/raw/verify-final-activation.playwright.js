async (page) => {
  const start = new URL(page.url());
  const origin = start.origin;
  const phase = start.searchParams.get('qa-phase');
  const scenario = start.searchParams.get('qa-scenario');
  const bundle = start.searchParams.get('qa-bundle');
  const pid = start.searchParams.get('qa-pid');
  const rowCommit = start.searchParams.get('qa-commit') ?? 'pointer';
  const policy=JSON.parse(start.searchParams.get('qa-policy')??'null');
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
  function activationFixture(name) {
    const fixture=graph('Final activation '+name,node('work','mutate','Self pointer repair',310,mutates({operations:[
      {op:'coerce',source:'/counters/nodeVisits/work',jsonSchema:{type:'integer'},target:'/vars/visits',repair:{enabled:false}},
      template('Ordinary removable row versus repaired Coerce row'),
    ]})));
    fixture.variables={visits:{type:'integer'}};
    return fixture;
  }
  const pendingSource='/counters/nodeVisits/worker';
  const defaultRow={op:'set',path:'',value:{kind:'literal',value:null}};
  function expectedRename(original) {
    const next=rewritten(original,'work','worker');
    targetNode(next,'worker').config.operations[0].source=pendingSource;
    return next;
  }
  function expectedEdit(original,nodeId,action) {
    const next=clone(original);
    const operations=targetNode(next,nodeId).config.operations;
    if(action==='add')operations.push(clone(defaultRow));
    else if(action==='remove')operations.splice(1,1);
    else if(action==='boolean')operations[0].repair.enabled=true;
    else throw Error('Unknown allowed fixture action '+action);
    return next;
  }
  const controlLabel=action=>action==='add'?'Add operations':action==='remove'?'Remove operations 2':null;
  const controlFor=(dialog,action)=>action==='boolean'
    ? dialog.locator('[data-field='+JSON.stringify(policy.booleanFieldPath)+']').getByRole('switch')
    : dialog.getByRole('button',{name:controlLabel(action),exact:true});
  async function displayed(dialog,nodeId,expectedOriginalRow,operationCount) {
    const shown=await view(dialog);
    const operationRows=shown.rows.filter(({path})=>/^operations\.\d+$/.test(path));
    same(operationRows.length,operationCount,'Visible operation count');
    same(operationRows[0].id,expectedOriginalRow,'Surviving Coerce row retains identity');
    same(operationRows[0].open,'true','Surviving Coerce row retains disclosure');
    const input=row(dialog,'operations.0').getByLabel('Source',{exact:true});
    same(await input.inputValue(),'/counters/nodeVisits/'+nodeId,'Displayed authoritative Source');
    return shown;
  }
  async function readyFixture(caseName) {
    let state=await open(activationFixture(caseName));
    const dialog=await openMutate('work');
    const next=clone(state.draft.definition);
    targetNode(next,'work').label='Synced native fixture';
    await expand(dialog,0);
    const label=dialog.locator('[data-field-scope="node"]').getByLabel('Label',{exact:true});
    // A public UI edit creates a settled IndexedDB row even on a newly API-created draft.
    state=await amend(state,next,()=>label.fill('Synced native fixture'),'Witness initial server/device identity');
    await page.getByTestId('save-state').filter({hasText:'All changes saved'}).waitFor(wait);
    const originalRow=await row(dialog,'operations.0').getAttribute('data-row-id');
    check(originalRow,'Expected stable Coerce row identity');
    await displayed(dialog,'work',originalRow,2);
    return {state,dialog,originalRow};
  }
  async function point(locator) {
    await locator.scrollIntoViewIfNeeded(wait);
    return locator.evaluate((el)=>{
      const box=el.getBoundingClientRect();
      const x=box.x+box.width/2,y=box.y+box.height/2;
      const hit=document.elementFromPoint(x,y);
      return {x,y,hittable:el===hit||el.contains(hit),text:el.closest('button')?.textContent.trim()??el.textContent.trim(),
        name:el.getAttribute('aria-label'),tag:el.tagName};
    });
  }
  async function observe() {
    await page.evaluate(({title})=>{
      const log=[],keys=new WeakMap();let serial=0;
      function item(el){
        if(!(el instanceof Element))return null;
        if(!keys.has(el))keys.set(el,++serial);
        const rect=el.getBoundingClientRect();
        return {key:keys.get(el),tag:el.tagName,attached:el.isConnected,role:el.getAttribute('role'),id:el.id||null,
          box:{left:rect.left,top:rect.top,width:rect.width,height:rect.height},
          name:el.getAttribute('aria-label'), text:el.closest('button')?.textContent.trim()??null,
          row:el.closest('[data-row-id]')?.getAttribute('data-row-id')??null};
      }
      function geometry(e){
        const dialog=document.querySelector('dialog:modal');
        const noticeTitles=Array.from(document.querySelectorAll('[role="status"] > p')).filter(
          element=>element.textContent===title);
        const isVisible=element=>element?.getClientRects().length>0;
        const source=dialog?.querySelector('[data-field="operations.0.source"] input');
        return {modal:Boolean(dialog),dialogReport:noticeTitles.some(element=>dialog?.contains(element)&&isVisible(element)),
          pageReport:noticeTitles.some(element=>!dialog?.contains(element)&&isVisible(element)),
          dialogId:dialog?.querySelector('#node-id')?.value??null,source:source?.value??null,
          control:item(e.target instanceof Element?e.target.closest('button'):null)};
      }
      window.ggQaActivation={log,item};
      for(const type of ['pointerdown','mousedown','focusout','focusin','pointerup','mouseup','click','pointercancel','keydown','keyup']){
        document.addEventListener(type,event=>{
          const {clientX:x,clientY:y}=event;
          const entry={type,at:performance.now(),x,y,trust:event.isTrusted,key:event.key,buttons:event.buttons,
            pointerType:event.pointerType,target:item(event.target),related:item(event.relatedTarget),
            path:event.composedPath().slice(0,8).map(item),focus:item(document.activeElement),geometry:geometry(event),
            hit:typeof x==='number'&&typeof y==='number'?item(document.elementFromPoint(x,y)):null,
            defaultAtCapture:event.defaultPrevented};
          log.push(entry);
          setTimeout(()=>{entry.defaultAfterDispatch=event.defaultPrevented;},0);
        },{capture:true,passive:true});
      }
      window.addEventListener('click',event=>{
        log.push({type:'bubble-click',at:performance.now(),trust:event.isTrusted,
          target:item(event.target),geometry:geometry(event)});
      },{passive:true});
    },{title:policy.noticeTitle});
  }
  async function events() {return page.evaluate(()=>window.ggQaActivation.log);}
  function actionClicks(observed,label){
    return observed.filter(e=>e.type==='click'&&e.trust&&e.path.some(p=>
      p?.tag==='BUTTON'&&(p.name===label||p.text===label)));
  }
  async function mouseGesture(control,end){
    const at=await point(control);
    check(at.hittable&&await control.isEnabled(),'Actual enabled control is hit-tested');
    const handle=await control.elementHandle();
    const held={original:await handle.evaluate(el=>window.ggQaActivation.item(el))};
    await page.mouse.move(at.x,at.y);
    await page.mouse.down();
    try {
      if(end){
        check(end.hittable,'Actual outside-up point must be hittable');
        await page.mouse.move(end.x,end.y,{steps:4});
      }
    }finally{await page.mouse.up();}
    held.afterUp=await handle.evaluate(el=>window.ggQaActivation.item(el));
    await handle.dispose();
    return {at,end,held};
  }
  async function saveSingle(before,expected,begin,label) {
    const settled=await page.waitForResponse(response=>
      new URL(response.url()).pathname===draftPath()&&response.request().method()==='PUT',wait);
    same(settled.status(),200,label+' response status');
    const body=await settled.json();
    await page.getByTestId('save-state').filter({hasText:'All changes saved'}).waitFor(wait);
    await sleep(750);
    const stored=await detail();
    const local=await device(stored.draftToken);
    const sent=writes.slice(begin);
    checkpoints.push({label,stored,local,sent,response:body});
    same(sent.length,1,label+' one fast-gesture conditional draft save');
    same(sent[0].ifMatch,'"'+before.draftToken+'"',label+' original acknowledged token');
    same(sent[0].body.definition,expected,label+' exact public mutation');
    same(stored.draft,body.draft,label+' exact HTTP response/GET graph');
    same(stored.draft.definition,expected,label+' complete accepted graph');
    same(stored.draftToken,body.draftToken,label+' exact response/GET revision');
    same(local.definition,expected,label+' exact synced device graph');
    return stored;
  }
  async function history(state,steps) {
    for(const step of steps){
      state=await amend(state,step.definition,async()=>{
        const visible=page.getByRole('dialog');
        if(await visible.count()){
          await visible.getByRole('button',{name:'Done',exact:true}).focus();
        }else await page.getByRole('button',{name:/^Undo\b/}).focus();
        await page.keyboard.press(step.key);
      },step.name);
    }
  }
  async function one(action,kind) {
    active=kind+' '+action;
    const {state:before,dialog,originalRow}=await readyFixture(active);
    const idBox=dialog.getByLabel('Node id',{exact:true});
    const button=controlFor(dialog,action);
    await button.scrollIntoViewIfNeeded(wait);
    if(kind==='pending')await idBox.fill('worker');else await idBox.focus();
    check(await idBox.evaluate(el=>el===document.activeElement),'Node ID holds actual focus');
    const nodeId=kind==='pending'?'worker':'work';
    const renamed=kind==='pending'?expectedRename(before.draft.definition):before.draft.definition;
    const changed=expectedEdit(renamed,nodeId,action);
    await observe();
    const saved=saveSingle(before,changed,writes.length,active+' result').then(value=>({value}),error=>({error}));
    const interaction=await mouseGesture(button);
    const actionTrace=await events();
    checkpoints.push({label:active+' initial native down/up',interaction,events:actionTrace});
    const acknowledgement=await saved;
    if(acknowledgement.error)throw acknowledgement.error;
    // Product semantics are graph and one action, not attachment of the old node.
    const current=page.getByRole('dialog',{name:'Edit mutate '+nodeId,exact:true});
    const ui=await displayed(current,nodeId,originalRow,action==='add'?3:action==='remove'?1:2);
    checkpoints.push({label:active+' settled UI',ui,events:await events()});
    const identity=interaction.held.original.key;
    const trustedClicks=actionTrace.filter(e=>e.type==='click'&&e.trust&&e.path.some(p=>p?.key===identity));
    same(trustedClicks.length,1,'The first native browser gesture delivered one trusted target click');
    const fired=trustedClicks[0];
    if(kind==='pending'){
      const down=actionTrace.find(e=>e.type==='pointerdown'&&e.trust&&e.geometry.control?.key===identity);
      const up=actionTrace.find(e=>e.type==='pointerup'&&e.trust&&e.geometry.control?.key===identity);
      check(down&&up&&down.buttons===1&&up.buttons===0,'First physical sequence completed on same live selected control');
      same([down.geometry.dialogReport,up.geometry.dialogReport,fired.geometry.dialogReport],
        [false,false,false],'Dialog notice stayed held through actual click capture');
      check(fired.geometry.modal,'Notice observation is scoped to the browser modal top layer');
      same(fired.geometry.source,pendingSource,'Repaired Source already authoritative at click dispatch');
      for(const key of ['left','top','width','height']){
        check(Math.abs(fired.geometry.control.box[key]-down.geometry.control.box[key])<=1,
          'In-place notification kept initial control geometry '+key);
      }
      await current.getByText(policy.noticeTitle,{exact:true}).waitFor(wait);
    }
    if(action==='boolean') same(await controlFor(current,action).getAttribute('aria-checked'),'true','One switch change');
    await caption(active.replaceAll(' ','-'));
    if(kind==='pending'){
      await history(acknowledgement.value,[
        {key:'Control+z',definition:renamed,name:active+' first Undo reverses only form action'},
        {key:'Control+z',definition:before.draft.definition,name:active+' second Undo restores entire rename'},
        {key:'Control+Shift+z',definition:renamed,name:active+' first Redo repeats only rename'},
        {key:'Control+Shift+z',definition:changed,name:active+' second Redo repeats only form action'},
      ]);
    }
    return {action,kind,ui};
  }
  async function noExtraWrite(before,beforeDevice,count,label) {
    await sleep(950);
    const latest=await detail(),local=await readDevice();
    checkpoints.push({label,latest,local,sent:writes.slice(count),events:await events()});
    same(writes.length,count,label+' no draft write');
    same(latest,before,label+' exact public readback');
    same(local,beforeDevice,label+' exact synced device revision');
  }
  async function canceled() {
    active='outside-up cancels Add';
    const {state:before,dialog,originalRow}=await readyFixture(active);
    const idBox=dialog.getByLabel('Node id',{exact:true});
    const target=dialog.getByRole('heading').first();
    await controlFor(dialog,'add').scrollIntoViewIfNeeded(wait);
    await idBox.fill('worker');
    const outside=await point(target);
    await observe();
    const count=writes.length, beforeDevice=await readDevice();
    const interaction=await mouseGesture(controlFor(dialog,'add'),outside);
    const trace=await events();
    checkpoints.push({label:active,interaction,events:trace});
    const down=trace.find(e=>e.type==='pointerdown'&&e.trust);
    const up=trace.find(e=>e.type==='pointerup'&&e.trust);
    check(down?.path.some(p=>p?.key===interaction.held.original.key) && up && up.buttons===0 &&
      !up.path.some(p=>p?.key===interaction.held.original.key),'Trusted outside-up actually ends over a different target');
    same(actionClicks(trace,controlLabel('add')).length,0,'Outside-up dispatched no Add activation');
    await sleep(975);
    const current=await detail(),local=await readDevice();
    const renamed=policy.outsideUpRename==='committed';
    const expected=renamed?expectedRename(before.draft.definition):before.draft.definition;
    same(current.draft.definition,expected,'Outside-up preserves exact config and valid ID boundary');
    same(local.definition,expected,'Outside-up exact synced device graph');
    same(local.baseToken,current.draftToken,'Outside-up device uses acknowledged token');
    same(writes.length-count,renamed?1:0,'Outside-up sends only the documented rename write');
    if(renamed){
      same(writes.at(-1).body.definition,expected,'Outside-up sends rename only');
      same(writes.at(-1).ifMatch,'"'+before.draftToken+'"','Outside-up rename token');
    }else{
      same(current,before,'Pending-only ID keeps exact public draft');
      same(local,beforeDevice,'Pending-only ID keeps exact device snapshot');
    }
    const visible=page.getByRole('dialog',{name:'Edit mutate '+(renamed?'worker':'work'),exact:true});
    await displayed(visible,renamed?'worker':'work',originalRow,2);
    if(renamed)await visible.getByText(policy.noticeTitle,{exact:true}).waitFor(wait);
    checkpoints.push({label:'outside-up resulting state',current,local,expected,events:await events()});
    return {action:'add',kind:'outside-up'};
  }
  async function invalid() {
    active='duplicate Node ID';
    const {state:before,dialog,originalRow}=await readyFixture(active);
    const idBox=dialog.getByLabel('Node id',{exact:true});
    await idBox.fill('start');
    await observe();
    const count=writes.length,beforeDevice=await readDevice();
    const gesture=await mouseGesture(controlFor(dialog,'add'));
    await page.getByText(policy.duplicateIdMessage,{exact:true}).waitFor(wait);
    const click=await events();
    const added=policy.duplicateIdAdd==='independent';
    if(!added) await noExtraWrite(before,beforeDevice,count,active+' refused action');
    else{
      await sleep(975);
      const expected=expectedEdit(before.draft.definition,'work','add');
      const current=await detail(),local=await device(current.draftToken);
      same(current.draft.definition,expected,'Duplicate ID did not alter the old Source or edge endpoints');
      same(local.definition,expected,'Duplicate refusal exact synced graph');
      same(writes.slice(count).length,1,'A legitimate independent Add ran once');
      same(writes.at(-1).ifMatch,'"'+before.draftToken+'"','Duplicate action used original token');
      same(writes.at(-1).body.definition,expected,'Duplicate action sent only the exact valid Add');
    }
    await displayed(dialog,'work',originalRow,added?3:2);
    checkpoints.push({label:active+' result',gesture,events:click,after:await detail(),local:await readDevice()});
    return {action:'add',kind:'duplicate-id'};
  }
  async function keyboardActivation() {
    active='keyboard Add after rename focus';
    const {state:before,dialog,originalRow}=await readyFixture(active);
    const input=dialog.getByLabel('Node id',{exact:true});
    await observe();
    const renamed=expectedRename(before.draft.definition);
    const durable=await amend(before,renamed,async()=>{
      await input.fill('worker');
      // Use actual keyboard navigation to commit ID; no synthetic DOM click or store injection.
      await page.keyboard.press('Tab');
    },'Keyboard blur commits exact rename before later activation');
    const current=page.getByRole('dialog',{name:'Edit mutate worker',exact:true});
    await displayed(current,'worker',originalRow,2);
    await current.getByText(policy.noticeTitle,{exact:true}).waitFor(wait);
    const control=controlFor(current,'add');
    await control.focus();
    check(await control.evaluate(el=>el===document.activeElement),'Keyboard target has actual focus');
    const changed=expectedEdit(renamed,'worker','add');
    await amend(durable,changed,()=>page.keyboard.press('Space'),'Space activates live Add exactly once');
    const trace=await events();
    same(actionClicks(trace,controlLabel('add')).length,1,'Trusted keyboard activation clicked Add once');
    const ui=await displayed(current,'worker',originalRow,3);
    checkpoints.push({label:active,ui,events:trace});
    return {action:'add',kind:'keyboard'};
  }
  async function activation() {
    const results=[];
    for(const action of ['add','remove']){
      for(const kind of ['steady','pending']) results.push(await one(action,kind));
    }
    results.push(await one('boolean','pending'),await canceled(),await invalid(),await keyboardActivation());
    return results;
  }
  try {
    check(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) && !/:474[78]$/.test(origin),'Refused owner or nonfixture origin');
    check(phase==='corrected','Candidate assertions require the corrected frozen phase');
    check(scenario==='activation','Specify the bounded pointer activation scenario');
    check(policy?.frozen === true && policy?.bundle === bundle, 'Bind final product policy before activation');
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
  return {origin,suite:'273-final-pointer-activation-independent',phase,scenario,rowCommit,bundles,outcome,
    writes,checkpoints,pageErrors,failure};
}
