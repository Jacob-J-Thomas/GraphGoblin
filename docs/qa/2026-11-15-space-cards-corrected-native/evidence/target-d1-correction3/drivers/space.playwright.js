async (page) => {
  const start = new URL(page.url());
  const param = (key) => start.searchParams.get('qa-'+key);
  const origin = start.origin;
  const sink = param('sink');
  const group = param('case');
  const config = param('config');
  const coarse = config.startsWith('d2-');
  const theme = coarse ? 'dark' : 'light';
  const check = (condition, message, kind = 'product') => {
    if (!condition) throw Object.assign(new Error(message),{kind});
  };
  // begin pure fixture contract
  function graph(name, {coordinates = 'omitted', single = false, routed = false, invalid = false} = {}) {
    const card = (id, kind, label, config) => ({id, kind, label, config, ...(coordinates === 'zero' ? {ui:{x:0,y:0}} : {})});
    const link = (id, from, to, port = 'out') => ({id, from:{node:from,port}, to:{node:to,port:'in'}});
    const nodes = [
      card('start','trigger','Manual entry',{type:'manual',exposeTo:['ui','api','mcp']}),
      card('router','decision','Which branch?',{kind:'expression',jsonata:'"alpha"',routes:[{id:'alpha',label:'Alpha route'},{id:'beta',label:'Beta route'}]}),
      card('tall','mutate','Record the chosen branch',{operations:[{op:'append-message',role:'note',content:'Retain this literal & authored template.'}]}),
      card('peer','exit','Alternate completion',{outcome:'success',returns:'"alternate"'}),
      card('done','exit','Final completion',{outcome:'success',returns:'"finished"'}),
      card('island','script','Disconnected authored command',{command:'never-execute-disposable-space-probe',cwd:'workspace',stdin:'thread',stdout:'last-output'}),
    ];
    const edges = [link('entry','start','router'),link('route-alpha','router','tall','alpha'),
      link('route-beta','router','peer','beta'),link('finish','tall','done')];
    if (invalid) edges.push(link('bad-pair','router','missing','stale'),link('bad-pair','tall','peer','stale'));
    if (routed) edges[0].ui = {route:[230,124,300]};
    return {schemaVersion:4,name,description:'Explicit layout probe with authored content',nodes:single ? nodes.slice(0,1) : nodes,edges:single ? [] : edges};
  }
  function definition(record) {
    const value = record?.draft?.definition ?? record?.current?.definition;
    if (!value || typeof record.draftToken !== 'string') throw new Error('Missing public current/draft definition or token');
    return value;
  }
  function wireToCanonical(value) {
    return {...value,nodes:value.nodes.map(node => node.kind === 'script' ? {
      ...node,config:{cwd:'workspace',stdin:'thread',stdout:'last-output',...node.config},
    } : node)};
  }
  function exactShape(value) {
    if (value === undefined) return ['undefined'];
    if (typeof value === 'number' && Object.is(value,-0)) return ['negative-zero'];
    if (Array.isArray(value)) return ['array',value.length,Object.keys(value).map(key => [key,exactShape(value[key])])];
    if (value !== null && typeof value === 'object') return ['object',Object.keys(value).sort().map(key => [key,exactShape(value[key])])];
    return ['value',value];
  }
  function expectedSpace(prior, heights) {
    // Independent oracle for these six fixed cards. The invalid duplicate pair must not affect it.
    const top = (id, ports) => Math.max(92 + (ports ? 2 + 46 * ports : 0), heights[id]);
    const positions = {router:{x:272,y:0},tall:{x:544,y:0},peer:{x:544,y:top('tall',1)+44},
      done:{x:816,y:0},island:{x:0,y:top('start',1)+44}};
    return {...prior,nodes:prior.nodes.map((node,index) => index ? {...node,ui:positions[node.id]} : node)};
  }
  // end pure fixture contract

  const same = (a,b,message) => check(JSON.stringify(exactShape(a)) === JSON.stringify(exactShape(b)),message);
  const out = {suite:'208-space-corrected-native-v1',group,config,checks:[],limits:[],pageErrors:[],consoleErrors:[],failure:null};
  let loopId, serial=0, font=16, putHold, phase='setup';
  const requests=[], pending=[], map=new Map();
  const opts={timeout:9000};
  const offer=page.getByTestId('space-cards-offer');
  const result=page.getByTestId('space-cards-result');
  const autosaveMs=Number(param('autosave-ms'));
  const canvas=page.getByTestId('canvas');
  const save=page.getByTestId('save-state');
  const control=(name)=>offer.getByRole('button',{name,exact:true});
  const history=(dir)=>page.locator('[data-history="'+dir+'"]');
  const path=(id=loopId)=>'/loops/'+id;
  const writes=()=>requests.filter(record=>record.path===path()+'/draft' && record.method==='PUT');
  const quote=(token)=>'"'+token+'"';
  const pause=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));

  async function raw(name,data) {
    const safeName=name.replace(/[^A-Za-z0-9._-]+/g,'-');
    const file=String(++serial).padStart(4,'0')+'-'+safeName+'.json';
    const response=await fetch(sink+'/sink/'+file,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
    check(response.ok,'Evidence sink refused '+file,'fixture');
    return file;
  }
  async function until(read, title, timeout=11000) {
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline) {
      const value=await read();
      if(value) return value;
      await pause(22);
    }
    throw Object.assign(new Error('Timed out waiting for '+title),{kind:'unwitnessed'});
  }
  async function api(method,route,data,token) {
    const requestText=data===undefined ? null : JSON.stringify(data);
    const requestHeaders={...(requestText===null ? {} : {'content-type':'application/json'}),...(token ? {'if-match':quote(token)} : {})};
    const response=await page.request.fetch(origin+route,{method,timeout:10000,headers:requestHeaders,...(requestText===null ? {} : {data:requestText})});
    const responseText=await response.text();
    const result={method,route,requestText,requestHeaders,status:response.status(),headers:response.headers(),responseText};
    const file=await raw('api',result);
    return {...result,file,body:JSON.parse(responseText)};
  }
  async function get() {
    const result=await api('GET',path());
    check(result.status===200,'Public loop GET '+result.status,'fixture');
    return result.body;
  }
  function installProbe(themeName) {
    localStorage.setItem('graphgoblin-theme',themeName);
    const root=()=>document.querySelector('[data-editor-canvas]');
    const panel=()=>document.querySelector('[data-testid="space-cards-offer"]');
    const result=()=>document.querySelector('[data-testid="space-cards-result"]');
    const buttons=()=>[...(panel()?.querySelectorAll('button')??[])];
    const viewport=()=>document.querySelector('.react-flow__viewport');
    const css=(el)=>el ? getComputedStyle(el) : null;
    const box=(el)=>{if(!el)return null;const r=el.getBoundingClientRect();return [r.x,r.y,r.width,r.height];};
    const center=(el)=>{const r=box(el);return r && [r[0]+r[2]/2,r[1]+r[3]/2];};
    const ids=new WeakMap(),functions=new WeakMap();
    let next=0,nextFn=0;
    const identity=(el)=>{if(!ids.has(el)) ids.set(el,++next);return ids.get(el);};
    const fn=(el)=>{if(!functions.has(el)) functions.set(el,++nextFn);return functions.get(el);};
    const name=(el)=>{
      if(!(el instanceof Element))return null;
      if(el.closest('[data-testid="space-cards-result"]'))return 'space-result';
      const node=el.closest('.react-flow__node'),edge=el.closest('.react-flow__edge'),btn=el.closest('button');
      const route=el.closest('.gg-route-handle');
      if(route)return 'route:'+edge?.dataset.id+':'+route.getAttribute('data-segment');
      if(el.closest('.react-flow__handle'))return 'handle:'+el.closest('.react-flow__handle').getAttribute('data-nodeid');
      if(node)return 'node:'+node.dataset.id;
      if(edge)return 'edge:'+edge.dataset.id;
      if(btn)return btn.getAttribute('aria-label')??btn.textContent.trim();
      if(el===root())return 'canvas-root';
      if(el.closest('.react-flow__pane'))return 'pane';
      if(el.closest('dialog'))return 'dialog';
      return el.getAttribute('aria-label')??el.tagName;
    };
    const hit=(point)=>point ? document.elementFromPoint(...point) : null;
    const d3=()=>Array.isArray(window.__on) ? window.__on.filter(row=>row.type==='click' && row.name==='drag').map(row=>({
      capture: typeof row.options==='boolean' ? row.options : Boolean(row.options?.capture),
      value:typeof row.value==='function' ? fn(row.value) : null,
      wrapper:typeof row.listener==='function' ? fn(row.listener) : null,
    })) : [];
    function sample(point) {
      const view=viewport();
      const matrix=view ? new DOMMatrixReadOnly(css(view).transform) : null;
      const announcer=root()?.querySelector('[aria-live="polite"][aria-atomic="true"]');
      const zoomOut=document.querySelector('.react-flow__controls-zoomout');
      const section=result();
      const resultStyle=css(section);
      return {t:performance.now(),epoch:performance.timeOrigin,viewport:matrix ? [matrix.e,matrix.f,matrix.a] : null,
        viewportStyle:view?.getAttribute('style'),focus:name(document.activeElement),modal:Boolean(document.querySelector('dialog:modal')),
        selected:[...document.querySelectorAll('.react-flow__node.selected,.react-flow__edge.selected')].map(name),
        buttons:buttons().map(btn=>{
          const pt=center(btn), h=hit(pt), computed=css(btn);
          return {name:name(btn),id:identity(btn),box:box(btn),point:pt,hit:name(h),ownsHit:btn.contains(h),attached:btn.isConnected,
            unavailable:btn.getAttribute('aria-disabled')==='true',gesture:btn.getAttribute('data-gesture'),disabled:btn.disabled,
            pointerEvents:computed.pointerEvents,focusVisible:btn.matches(':focus-visible'),outline:computed.outlineStyle,outlineWidth:computed.outlineWidth,
            shadow:computed.boxShadow};
        }),
        live:announcer ? {role:announcer.getAttribute('role'),mode:announcer.getAttribute('aria-live'),
          atomic:announcer.getAttribute('aria-atomic'),text:announcer.textContent.trim()} : null,
        result:section ? {box:box(section),text:section.textContent.trim(),identity:identity(section),
          visible:resultStyle.visibility==='visible'&&resultStyle.display!=='none',pointerEvents:resultStyle.pointerEvents,
          selectable:resultStyle.userSelect!=='none',focusable:section.matches('[tabindex],button,a[href],input')||
            Boolean(section.querySelector('button,a[href],input,select,textarea,[tabindex],[contenteditable="true"]')),
          live:Boolean(section.closest('[role="status"],[aria-live]')),
          afterOffer:!panel(),beforeFlow:Boolean(section.compareDocumentPosition(document.querySelector('.react-flow'))&Node.DOCUMENT_POSITION_FOLLOWING),
          overflow:[section.scrollWidth-section.clientWidth,section.scrollHeight-section.clientHeight]}:null,
        selectionBox:Boolean(document.querySelector('.react-flow__selection')),
        routeHandles:[...document.querySelectorAll('.gg-route-handle')].map(name),
        connectionPreview:Boolean(document.querySelector('.react-flow__connection-path')),
        routePaths:[...document.querySelectorAll('.react-flow__edge')].map(edge=>[edge.dataset.id,edge.querySelector('.react-flow__edge-path')?.getAttribute('d')]),
        stack:point?document.elementsFromPoint(...point).slice(0,12).map(name):[],
        hit:name(hit(point)),zoomOut:zoomOut ? {disabled:zoomOut.disabled,ownsPoint:zoomOut.contains(hit(point)),box:box(zoomOut)} : null,
        d3:d3(),d3Observable:Array.isArray(window.__on),
        history:[...document.querySelectorAll('[data-history]')].map(el=>[el.dataset.history,el.getAttribute('aria-disabled'),el.disabled,el.title]),
        affordance:{panel:box(panel()),canvas:box(root()),flow:box(document.querySelector('.react-flow')),toolbar:box(document.querySelector('[data-testid="history-actions"]')?.closest('header'))},
      };
    }
    let rows=[],overflow=false,stage='start',tracking=false,fixed=null,lastKey='';
    function store(type,event) {
      if (!tracking) return;
      if(rows.length>=3200){overflow=true;return;}
      const touch=event?.changedTouches?.[0];
      const point=event && event.clientX!==undefined ? [event.clientX,event.clientY] : touch?[touch.clientX,touch.clientY]:fixed;
      const entry={type,stage,...sample(point)};
      if(event) Object.assign(entry,{type,point,target:name(event.target),trusted:event.isTrusted,detail:event.detail,
        eventTime:event.timeStamp,key:event.key,repeat:event.repeat,pointerType:event.pointerType,mouseButtons:event.buttons,shiftKey:event.shiftKey,
        path:event.composedPath().slice(0,10).map(name),canceledAtCapture:event.defaultPrevented});
      rows.push(entry);
      if(event) setTimeout(()=>{entry.canceledAfterDispatch=event.defaultPrevented;},0);
    }
    for(const type of ['pointerdown','pointermove','mousedown','mouseup','pointerup','click','dblclick','touchstart','touchend','keydown','keyup','focusin','wheel']) {
      window.addEventListener(type,event=>store(type,event),{capture:true,passive:true});
    }
    new MutationObserver(()=>{
      if(!tracking)return;
      const stamp=JSON.stringify([result()?.textContent,buttons().map(btn=>[identity(btn),btn.getAttribute('aria-disabled'),btn.getAttribute('data-gesture')])]);
      if(stamp!==lastKey){lastKey=stamp;store('availability');}
    }).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-disabled','data-gesture']});
    function frame(){
      if(tracking){
        const stamp=JSON.stringify([viewport()?.getAttribute('style'),box(result()),result()?.textContent,
          buttons().map(btn=>[identity(btn),btn.getAttribute('aria-disabled')])]);
        if(stamp!==frame.last){frame.last=stamp;store('raf-change');}
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    window.__spaceQA={sample,name,box,hit,buttons,viewport,result,
      mark(label,point=null){tracking=true;stage=label;fixed=point;store('mark');},
      drain(){const value={rows,overflow};rows=[];overflow=false;tracking=false;return value;},
    };
  }
  const snap=(point=null)=>page.evaluate(pt=>window.__spaceQA.sample(pt),point);
  const mark=(label,point=null)=>page.evaluate(([label,point])=>window.__spaceQA.mark(label,point),[label,point]);
  async function trace(label){
    const data=await page.evaluate(()=>window.__spaceQA.drain());
    const file=await raw('frames-'+label,data);
    check(!data.overflow,'Frame trace exceeded capacity at '+label,'fixture');
    out.checks.push({label,file,samples:data.rows.length});
    return data.rows;
  }
  async function checkpoint(label,data){
    const file=await raw(label,data);
    out.checks.push({label,file});
  }
  async function stage(label,action) {
    phase=label;
    try{await action();}
    catch(error){
      out.failures??=[];
      out.failures.push({phase:label,kind:error.kind??'unclassified',error:String(error.stack??error)});
      if(group==='queued-fit-d1'){
        const first=await page.evaluate(()=>window.__queuedFitQA?.stop()).catch(()=>null);
        if(first)await checkpoint('fit-first-failure-'+label,{error:String(error.stack??error),trace:first,writes:writes()});
      }
      await checkpoint('failure-'+label,{failure:out.failures.at(-1),snapshot:await snap().catch(()=>null)});
      await trace('failure-'+label).catch(()=>{});
      await page.screenshot({path:'failure-'+label+'.png'}).catch(()=>{});
      throw error;
    } finally {
      putHold?.release?.();
      putHold=undefined;
    }
  }
  async function localDraft(forLoopId=loopId){
    return page.evaluate((id)=>new Promise((resolve,reject)=>{
      const open=indexedDB.open('graphgoblin');
      open.onupgradeneeded=()=>open.transaction.abort();
      open.onerror=()=>resolve(null);
      open.onsuccess=()=>{
        const db=open.result;
        if(!db.objectStoreNames.contains('drafts')){db.close();resolve(null);return;}
        const tx=db.transaction('drafts','readonly');
        const request=tx.objectStore('drafts').get(id);
        tx.oncomplete=()=>{db.close();resolve(request.result===undefined ? null : structuredClone(request.result));};
        tx.onerror=()=>{db.close();reject(tx.error);};
      };
    }),forLoopId);
  }
  async function ready(){
    await canvas.waitFor(opts);
    await page.waitForFunction(()=>document.querySelectorAll('.react-flow__node').length>0 &&
      [...document.querySelectorAll('.react-flow__node')].every(node=>node.offsetHeight>0 && getComputedStyle(node).visibility==='visible'),undefined,opts);
    await page.getByText('The editor is available. Checking the server and this device before saving changes.',{exact:true}).waitFor({state:'hidden',...opts});
    await settled('opening-fit');
    const settings=await page.evaluate(()=>({viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,coarse:matchMedia('(pointer:coarse)').matches,
      rootFont:parseFloat(getComputedStyle(document.documentElement).fontSize),theme:document.documentElement.dataset.theme,
      bundle:[...document.scripts].filter(el=>el.src).map(el=>new URL(el.src).pathname)}));
    await checkpoint('browser-settings',settings);
    const sizes={'d1-fine-light':[1440,900,1],'d2-coarse-dark':[1440,900,1],'n768-fine-light':[768,900,1],'r512-reflow200':[512,384,2]};
    same([...settings.viewport,settings.dpr],sizes[config],'Measured viewport/DPR');
    check(settings.coarse===coarse && settings.theme===theme && settings.rootFont===font && settings.bundle.includes(param('bundle')),
      'Browser effective font, pointer, theme or exact bundle mismatch','fixture');
  }
  async function settled(label){
    return page.evaluate((label)=>new Promise((resolve,reject)=>{
      let last=null, sameFrames=0, frames=0;
      function read(){
        const now=window.__spaceQA.viewport()?.getAttribute('style');
        sameFrames=now && now===last ? sameFrames+1 : 0;
        last=now;
        if(sameFrames>=9)resolve(window.__spaceQA.sample());
        else if(++frames>180)reject(new Error('Viewport never settled: '+label));
        else requestAnimationFrame(read);
      }
      requestAnimationFrame(read);
    }),label);
  }
  async function load(reload=false){
    if(reload)await page.reload({waitUntil:'domcontentloaded'});
    else await page.goto(origin+'/app'+path()+'/edit',{waitUntil:'domcontentloaded'});
    if(font!==16)await page.addStyleTag({content:'html { font-size: 24px !important; }'});
    await ready();
  }
  async function newFixture(label, flags={}){
    const {published=false,invalid=false,...shape}=flags;
    const name='QA space '+label+' '+crypto.randomUUID().slice(0,8);
    const payload=graph(name,shape);
    const created=await api('POST','/loops',{definition:payload});
    check(created.status===201 && created.body.loop?.id,'Loop fixture creation rejected','fixture');
    loopId=created.body.loop.id;
    let prior=await get();
    if(invalid){
      const response=await api('PUT',path()+'/draft',{definition:graph(name,{...shape,invalid:true})},prior.draftToken);
      if(response.status===200){
        prior=await get();
        same(definition(prior).edges.slice(-2),graph(name,{invalid:true}).edges.slice(-2),'Both invalid duplicate edge tuples persisted in order');
      }else{
        check(response.status>=400 && response.status<500,'Unexpected invalid-edge seed failure','fixture');
        out.limits.push({label:'invalid-draft-REST-refused',status:response.status,file:response.file,fallback:'ordinary fixture'});
      }
    }
    if(published){
      // Retained save/publish fixture: a valid executable topology, then a successful public publish
      // gives a current-only baseline for the next conditional browser edit.
      const valid=definition(prior);
      valid.nodes=valid.nodes.filter(node=>['start','tall','done'].includes(node.id));
      valid.edges=[{id:'entry',from:{node:'start',port:'out'},to:{node:'tall',port:'in'}},valid.edges.find(edge=>edge.id==='finish')];
      const seeded=await api('PUT',path()+'/draft',{definition:valid},prior.draftToken);
      check(seeded.status===200,'Valid publication control seeding rejected','fixture');
      const publication=await api('POST',path()+'/publish');
      check(publication.status===200,'Public fixture publication rejected','fixture');
      prior=await get();
      check(!Object.hasOwn(prior,'draft') && prior.current?.definition,'Expected actual omitted draft and current fallback','fixture');
    }
    await load();
    await checkpoint('loaded-baseline',{label,loopId,prior,device:exactShape(await localDraft()),snapshot:await snap()});
    return prior;
  }
  async function measure(){
    return page.evaluate(()=>{
      const view=window.__spaceQA.sample().viewport;
      return {zoom:view?.[2],...Object.fromEntries([...document.querySelectorAll('.react-flow__node')].map(el=>{
        const card=el.querySelector('[data-testid^="node-"]');
        const rect=window.__spaceQA.box(el);
        return [el.dataset.id,{flow:el.offsetHeight,inner:card?.offsetHeight,screen:rect,flowFromScreen:rect[3]/view[2],
          left:window.__spaceQA.box(card)?.[0],font:card ? getComputedStyle(card).fontSize : null}];
      }))};
    });
  }
  const heights=(measurements)=>Object.fromEntries(Object.entries(measurements).filter(([key])=>key!=='zoom').map(([key,row])=>[key,row.flow]));
  async function point(name){
    const controlState=(await snap()).buttons.find(row=>row.name===name);
    check(controlState?.ownsHit && !controlState.disabled,'Cannot hit '+name,'product');
    return controlState.point;
  }
  async function quiet(prior,count,device,label){
    // Observation window exceeds the source-declared 600 ms debounce. Gesture delivery uses rAF/DOM observations.
    await pause(autosaveMs+180);
    const server=await get();
    const current=await localDraft();
    await checkpoint('quiet-'+label,{count,writes:writes(),prior,server,device:exactShape(device),current:exactShape(current),snapshot:await snap()});
    same(writes().length,count,label+' browser draft PUT count');
    same([definition(server),server.draftToken],[definition(prior),prior.draftToken],label+' durable draft/token');
    same(current,device,label+' complete device record');
  }
  async function accepted(label,count,prior,expected){
    const put=await until(()=>writes().slice(count).find(row=>row.status===200 && row.responseText!==undefined),label+' acknowledged draft PUT',17000);
    await save.filter({hasText:'All changes saved'}).waitFor(opts);
    const server=await get();
    const device=await until(async()=>{
      const current=await localDraft();
      return current?.synced===true && current.baseToken===server.draftToken && current;
    },label+' synced real device row');
    await pause(autosaveMs+180);
    await checkpoint('saved-'+label,{put,all:writes(),server,device,deviceShape:exactShape(device),snapshot:await snap()});
    const response=JSON.parse(put.responseText);
    const wire=JSON.parse(put.requestText).definition;
    same(writes().slice(count).length,1,label+' exactly one browser PUT');
    same(put.requestHeaders['if-match'],quote(prior.draftToken),label+' exact If-Match');
    same(response.draftToken,server.draftToken,label+' acknowledgement/GET token');
    check(server.draftToken!==prior.draftToken,label+' token advanced');
    same(wire,device.definition,label+' exact device and wire');
    same(wireToCanonical(wire),definition(server),label+' exact canonical GET and wire');
    same(response.draft.definition,definition(server),label+' exact acknowledged/GET definition');
    if(expected) same(definition(server),expected,label+' full expected graph');
    return server;
  }
  async function verifyGeometry(label,expected,before){
    const after=await measure();
    await checkpoint('geometry-'+label,{before,after,expected:expected.nodes.map(node=>[node.id,node.ui])});
    check(after.zoom>=0.4999 && after.zoom<=2.001,label+' valid fit viewport');
    for(const node of expected.nodes){
      const height=after[node.id];
      check(height && Math.abs(height.flow-height.flowFromScreen)<=1.01,label+' flow/unzoomed height agreement '+node.id);
      const anchor=after.start.screen;
      check(Math.abs((height.screen[0]-anchor[0])/after.zoom-node.ui.x)<=0.05 &&
        Math.abs((height.screen[1]-anchor[1])/after.zoom-node.ui.y)<=0.05,label+' stored/DOM position '+node.id);
    }
    const cards=Object.values(after).filter(row=>row?.screen);
    for(let i=0;i<cards.length;i++)for(let j=i+1;j<cards.length;j++){
      const [x,y,w,h]=cards[i].screen,[u,v,z,k]=cards[j].screen;
      check(Math.min(x+w,u+z)-Math.max(x,u)<0.02 || Math.min(y+h,v+k)-Math.max(y,v)<0.02,label+' card overlap '+i+'/'+j);
    }
  }
  async function geometryAction(label,prior,{input,activation='pointer',requireQuietGesture=true}={}){
    await control('Space cards').waitFor(opts);
    const readings=await measure();
    const expected=expectedSpace(definition(prior),heights(readings));
    check(expected.nodes.every(node=>Number.isFinite(node.ui.x) && Number.isFinite(node.ui.y)),'Malformed fixture geometry oracle','fixture');
    const count=writes().length;
    const before=await snap();
    await checkpoint('before-'+label,{readings,expected,before,count,loopId});
    await mark(label);
    if(input)await input();
    else await page.mouse.click(...await point('Space cards'));
    const after=await settled(label);
    const next=await accepted(label,count,prior,expected);
    const rows=await trace(label);
    await verifyGeometry(label,expected,readings);
    await offer.waitFor({state:'detached',...opts});
    if(activation==='pointer')await stableResult(label,before,after,rows,'Spaced '+expected.nodes.length+' cards.');
    else {
      check(!after.result && !rows.some(row=>row.result),label+' keyboard activation leaves no result');
      check(rows.some(row=>row.type==='click'&&row.trusted&&row.target==='Space cards'&&row.detail===0),label+' trusted keyboard click detail 0');
    }
    check(after.focus==='canvas-root' && !after.modal,label+' focus stays on the mounted canvas and no editor opens');
    same(after.selected,before.selected,label+' selection ownership preserved');
    check(!rows.some(row=>row.modal || JSON.stringify(row.selected)!==JSON.stringify(before.selected)),label+' no transient editor or selection side effect');
    check(after.live?.mode==='polite' && after.live.atomic==='true' &&
      after.live.text==='Spaced '+expected.nodes.length+' cards. Undo puts them back.',label+' exact polite Undo announcement');
    check(after.history[0]?.[1]!=='true' && after.history[1]?.[1]==='true',label+' one new undoable edit');
    if(requireQuietGesture){
      const transforms=rows.filter(row=>row.viewport && (row.type==='raf-change' || row.type==='mark')).map(row=>row.viewport.join(','));
      check(new Set(transforms).size===2,label+' stable before and one observed transform after action');
    }
    return {next,before,after,rows,readings,expected};
  }
  async function snapshot(label){
    await checkpoint('accessibility-'+label,{offer:await offer.count() ? await offer.ariaSnapshot(opts) : null,canvas:await canvas.ariaSnapshot(),state:await snap()});
    await page.screenshot({path:'space-'+group+'-'+String(serial).padStart(4,'0')+'-'+label+'.png'});
  }
  async function tabTo(name){
    for(let i=0;i<85;i++){
      if((await snap()).focus===name)return;
      await page.keyboard.press('Tab');
    }
    check(false,'Keyboard traversal never reached '+name);
  }
  async function fixtureCardPoint(){
    const candidate=await page.evaluate(()=>{
      const probe=window.__spaceQA;
      for(const node of document.querySelectorAll('.react-flow__node')){
        const rect=node.getBoundingClientRect();
        for(const dy of [17,49,65,28])for(const dx of [48,85,115,22]){
          const x=rect.x+dx*rect.width/node.offsetWidth,y=rect.y+dy*rect.height/node.offsetHeight;
          const hit=probe.hit([x,y]);
          if(hit && node.contains(hit) && !hit.closest('button,.react-flow__handle'))return {id:node.dataset.id,x,y};
        }
      }
      return null;
    });
    check(candidate,'No real node body hit is visible','unwitnessed');
    return candidate;
  }
  async function panePoint(){
    const candidate=await page.evaluate(()=>{
      const probe=window.__spaceQA,pane=document.querySelector('.react-flow__pane');
      const r=pane.getBoundingClientRect();
      for(const dy of [.75,.6,.85,.5,.35])for(const dx of [.25,.65,.43,.1,.88]){
        const point=[Math.round(r.x+r.width*dx),Math.round(r.y+r.height*dy)];
        if(probe.hit(point)===pane)return point;
      }
      return null;
    });
    check(candidate,'No visible safe pane coordinate','unwitnessed');
    return candidate;
  }
  async function editLabel(prior,label){
    const card=await fixtureCardPoint();
    const updated=structuredClone(definition(prior));
    const node=updated.nodes.find(row=>row.id===card.id);
    node.label+=' QA label edit';
    const count=writes().length;
    await page.mouse.click(card.x,card.y);
    const dialog=page.getByRole('dialog');
    await dialog.getByLabel('Label',{exact:true}).fill(node.label,opts);
    await dialog.getByRole('button',{name:'Done',exact:true}).click(opts);
    return accepted(label,count,prior,updated);
  }
  async function historyMove(direction,prior,expected,label){
    const count=writes().length, before=await snap();
    await history(direction).click(opts);
    const next=await accepted(label,count,prior,expected);
    same((await settled(label)).viewport,before.viewport,label+' no viewport fit');
    return next;
  }

  async function applyGroup(){
    await stage('open-dismiss-label',async()=>{
      const prior=await newFixture('omitted');
      const device=await localDraft(), originalCount=writes().length;
      await offer.waitFor(opts);
      const open=await snap();
      check(definition(prior).nodes.every(node=>Object.hasOwn(node,'ui')&&node.ui.x===0&&node.ui.y===0),'API defaults omitted positions to origin','fixture');
      await snapshot('eligible-pile');
      await quiet(prior,originalCount,device,'plain-open');
      await load(true);
      await offer.waitFor(opts);
      await quiet(prior,originalCount,device,'fresh-load');
      await page.mouse.click(...await point('Dismiss suggestion'));
      await offer.waitFor({state:'detached',...opts});
      const dismissed=await snap();
      await stableResult('pointer-dismiss',open,dismissed,[],'Suggestion dismissed.');
      for(const key of ['canvas','flow','toolbar'])same(dismissed.affordance[key],open.affordance[key],key+' stationary with overlay dismissed');
      check(dismissed.focus==='canvas-root' && dismissed.live?.text==='Suggestion dismissed.','Dismiss claims canvas focus and announces');
      same(dismissed.history,open.history,'Dismiss creates no history');
      await quiet(prior,originalCount,device,'dismiss');
      const edited=await editLabel(prior,'ordinary-label-on-pile');
      check(!(await offer.count()),'Dismiss persists through ordinary changes for this editor load');
      await load(true);
      await offer.waitFor(opts);
      const fresh=await localDraft();
      await quiet(edited,originalCount+1,fresh,'edited-reload');
      const twin=await newFixture('explicit',{coordinates:'zero'});
      same({...definition(twin),name:definition(prior).name},definition(prior),'Omitted/explicit zero public GET twins');
      const applied=await geometryAction('pointer-space',twin);
      await snapshot('spaced');
      const pan=await panePoint();
      await page.mouse.move(...pan);
      await page.mouse.down();
      try{await page.mouse.move(pan[0]+31,pan[1]+41,{steps:5});}finally{await page.mouse.up();}
      await page.locator('.react-flow__controls-zoomin').click(opts);
      const deliberate=await settled('deliberate-reference');
      await checkpoint('deliberate-reference',{before:applied.after,after:deliberate});
      check(deliberate.viewport[2]!==applied.after.viewport[2] && deliberate.viewport[0]!==applied.after.viewport[0],'Deliberate pan/zoom established fresh reference');
      const undone=await historyMove('undo',applied.next,definition(twin),'undo-exact-pile');
      await offer.waitFor(opts);
      same((await snap()).history[0][1],'true','One Undo exhausts the Space history');
      const redone=await historyMove('redo',undone,applied.expected,'redo-exact-space');
      await offer.waitFor({state:'detached',...opts});
      const editedAfterSpacing=await editLabel(redone,'ordinary-label-after-space');
      same((await settled('label-no-fit')).viewport,deliberate.viewport,'Ordinary label edit after spacing leaves deliberate viewport unchanged');
      await load(true);
      await offer.waitFor({state:'detached',...opts});
      await quiet(editedAfterSpacing,4,await localDraft(),'spaced-reload');
    });
    await stage('durable-invalid-edge-fidelity',async()=>{
      const prior=await newFixture('duplicate-stale',{invalid:true});
      await geometryAction('invalid-fidelity-space',prior);
    });
    await stage('published-current-open',async()=>{
      const prior=await newFixture('published',{published:true});
      await offer.waitFor(opts);
      await quiet(prior,0,await localDraft(),'published-current');
    });
  }
  async function keyGroup(key){
    const label=key==='Enter'?'enter':'space';
    return stage('key-'+label,async()=>{
      const prior=await newFixture('held-'+label);
      await tabTo('Space cards');
      const focused=await snap();
      await snapshot('key-'+label+'-before');
      const button=focused.buttons.find(row=>row.name==='Space cards');
      check(focused.focus==='Space cards' && button.focusVisible &&
        ((button.outline!=='none' && parseFloat(button.outlineWidth)>0)||button.shadow!=='none'),'Keyboard traversal and visible focus indicator');
      const applied=await geometryAction('held-'+label,prior,{activation:'keyboard',input:async()=>{
        await page.keyboard.down(key);
        try{for(let i=0;i<4;i++)await page.keyboard.down(key);}finally{await page.keyboard.up(key);}
      }});
      const events=applied.rows.filter(row=>row.trusted && row.key===(key==='Space'?' ':key));
      await checkpoint('held-events-'+label,events);
      check(events.some(row=>row.type==='keydown' && row.target==='Space cards' && !row.repeat) &&
        events.some(row=>row.type==='keydown'&&row.repeat) && events.some(row=>row.type==='keyup'),'Native held-key down/repeat/up witness');
      check(!events.some(row=>row.modal || row.history?.[1]?.[1]!=='true'),'Repeat never opens a node or reverses history');
      check(new Set(applied.rows.filter(row=>row.type==='raf-change' && row.viewport).map(row=>row.viewport.join(','))).size<=2,'Held key does not cause extra pan or fit');
    });
  }
  async function keysOnSelection(){
    await stage('delete-backspace-on-offer',async()=>{
      const prior=await newFixture('delete-selection');
      const {id}=await fixtureCardPoint();
      await page.locator('.react-flow__node[data-id="'+id+'"]').focus(opts);
      await page.keyboard.press('Space');
      const selection=(await snap()).selected;
      check(selection.includes('node:'+id),'Selected real card through native Space','fixture');
      const before=await localDraft();
      for(const [name,key] of [['Space cards','Delete'],['Dismiss suggestion','Backspace']]){
        await control(name).focus(opts);
        await mark('selection-'+key.toLowerCase());
        await page.keyboard.press(key);
        const rows=await trace('selection-'+key.toLowerCase());
        const now=await snap();
        check(rows.some(row=>row.type==='keydown' && row.trusted && row.key===key && row.target===name),key+' reaches focused offer control');
        same(now.selected,selection,key+' keeps card selection');
        check(now.focus===name && !now.modal,key+' retains offer focus');
      }
      await quiet(prior,0,before,'keys-owned-by-offer');
    });
  }
  function sameBox(actual,expected,label){
    check(actual?.length===4 && expected?.length===4 && actual.every((value,index)=>Math.abs(value-expected[index])<=0.05),
      label+' expected box '+JSON.stringify(expected)+' but saw '+JSON.stringify(actual));
  }
  async function stableResult(label,before,after,rows,message){
    check(!before.result && before.affordance.panel,label+' live offer before pointer action','fixture');
    check(after.result,label+' visible result absent');
    const samples=[...rows.filter(row=>row.result),after,await snap()];
    for(const row of samples){
      const shown=row.result;
      check(shown?.visible && shown.pointerEvents!=='none' && shown.afterOffer && shown.beforeFlow,
        label+' result must replace the offer and own canvas hit testing');
      sameBox(shown.box,before.affordance.panel,label+' offer/result bounds');
      check(shown.text===message && !shown.selectable && !shown.focusable && !shown.live,
        label+' result must be readable, noninteractive and not an extra live region');
      check(shown.overflow.every(pixels=>pixels<=1),label+' visible result overflow');
      check(shown.identity===after.result.identity,label+' same result across fit and save');
    }
    same([after.affordance.canvas,after.affordance.flow,after.affordance.toolbar],
      [before.affordance.canvas,before.affordance.flow,before.affordance.toolbar],label+' canvas and toolbar boxes unchanged');
    await checkpoint('stable-result-'+label,{before:before.affordance.panel,after:after.result,samples:samples.length});
  }

  function viewSequence(rows) {
    return rows.filter(row=>row.viewport)
      .map(row=>row.viewport.join(',')).filter((value,index,values)=>index===0||values[index-1]!==value);
  }
  async function pressCount(at,count){
    await page.mouse.move(...at);
    await page.mouse.down({clickCount:count});
    await page.mouse.up({clickCount:count});
  }
  async function selectForProbe(kind){
    const id=kind==='node'?(await fixtureCardPoint()).id:'entry';
    await page.locator('.react-flow__'+kind+'[data-id="'+id+'"]').focus(opts);
    await page.keyboard.press(kind==='node'?'Space':'Enter');
    const before=await snap();
    check(before.selected.includes(kind+':'+id),'Real '+kind+' selected before probe','unwitnessed');
    check(!before.modal,'Selection probe opened a dialog','unwitnessed');
  }
  async function repeatedSpace(label,{mode='double',fixed=false,selected,shift=false}={}){
    const prior=await newFixture(fixed?'double-r512':'repeat-'+label);
    if(selected){await selectForProbe(selected);await settled('selected-fixture-stable');}
    const readings=await measure(),expected=expectedSpace(definition(prior),heights(readings));
    const coord=fixed?[93,290]:await point('Space cards');
    const before=await snap(coord);
    const live=before.buttons.find(button=>button.name==='Space cards');
    check(before.hit==='Space cards' && live?.ownsHit,label+' real first Space target','unwitnessed');
    if(fixed){
      const [x,y,w,h]=before.zoomOut?.box??[];
      check(x<=coord[0]&&coord[0]<x+w&&y<=coord[1]&&coord[1]<y+h&&!before.zoomOut.disabled,
        label+' exact (93,290) overlaps enabled Zoom Out', 'unwitnessed');
    }
    await checkpoint('before-'+label,{coord,before,prior,expected});
    await mark(label,coord);
    if(shift)await page.keyboard.down('Shift');
    try{
      if(mode==='double')await page.mouse.dblclick(...coord);
      else if(mode==='triple')await page.mouse.click(...coord,{clickCount:3});
      else{
        await page.mouse.click(...coord);
        if(mode==='delayed') { await pause(200);await pressCount(coord,2); }
        else if(mode==='separate')await page.mouse.click(...coord);
        else if(mode==='drag') {
          const held=await snap(coord);
          check(held.hit==='space-result',label+' second press starts on result');
          await page.mouse.move(...coord);
          await page.mouse.down({clickCount:2});
          try{await page.mouse.move(coord[0]+30,coord[1],{steps:6});}
          finally{await page.mouse.up({clickCount:2});}
        }
      }
    }finally{if(shift)await page.keyboard.up('Shift');}
    await settled(label);
    const next=await accepted(label,0,prior,expected);
    const after=await snap(coord);
    const rows=await trace(label);
    await verifyGeometry(label,expected,readings);
    await stableResult(label,before,after,rows,'Spaced '+expected.nodes.length+' cards.');
    const pointers=rows.filter(row=>row.type==='pointerdown'&&row.trusted);
    const clicks=rows.filter(row=>row.type==='click'&&row.trusted);
    const doubles=rows.filter(row=>row.type==='dblclick'&&row.trusted);
    const count=mode==='triple'?3:2;
    check(pointers.length===count&&pointers[0].target==='Space cards',label+' trusted native down count','unwitnessed');
    check(pointers.slice(1).every(row=>row.point.join()===coord.join()&&row.target==='space-result'&&row.hit==='space-result'),
      label+' repeated trusted down landed outside result');
    check(clicks[0]?.target==='Space cards'&&clicks[0].detail===1,label+' first trusted click detail 1','unwitnessed');
    check(clicks.slice(1).every(row=>row.target==='space-result')&&doubles.every(row=>row.target==='space-result'),
      label+' later click reached underlying target');
    if(mode==='double'||mode==='delayed')check(clicks.some(row=>row.detail===2&&row.target==='space-result'),
      label+' second trusted click detail 2','unwitnessed');
    if(mode==='double')check(doubles.length===1,label+' browser dblclick witness','unwitnessed');
    if(mode==='separate')same(clicks.map(row=>row.detail),[1,1],label+' independently numbered clicks');
    if(mode==='triple')same(clicks.map(row=>row.detail),[1,2,3],label+' native triple click');
    if(shift)check(pointers.every(row=>row.shiftKey),label+' Shift held for every press','unwitnessed');
    if(mode==='drag')check(rows.some(row=>row.type==='pointermove'&&row.mouseButtons===1&&
      Math.abs(row.point[0]-coord[0])>=29),label+' 30px repeated drag witnessed','unwitnessed');
    check(after.focus==='canvas-root'&&!after.modal&&after.hit==='space-result',label+' result and canvas focus retained');
    check(rows.every(row=>!row.modal&&!row.selectionBox&&!row.connectionPreview&&JSON.stringify(row.selected)===JSON.stringify(before.selected)),
      label+' transient canvas gesture, modal or selection change');
    const sequence=viewSequence(rows);
    same(sequence,[before.viewport.join(','),after.viewport.join(',')],label+' exactly one observed viewport transition');
    same(after.live?.text,'Spaced '+expected.nodes.length+' cards. Undo puts them back.',label+' exact announcement');
    same(after.history.map(row=>row[1]),[null,'true'],label+' only Undo is available');
    await checkpoint('repeated-verdict-'+label,{coord,pointers,clicks,doubles,sequence,result:after.result,selected:before.selected});
    return {prior,next,expected,before,after,coord,sequence};
  }
  async function unlockZoom(applied){
    const before=await snap(applied.coord);
    check(before.result&&before.hit==='space-result','Result still covers the failure point');
    const outside=await panePoint();
    await mark('outside-before-zoom',outside);
    await page.mouse.click(...outside);
    await result.waitFor({state:'detached',...opts});
    const outsideRows=await trace('outside-before-zoom');
    check(outsideRows.some(row=>row.type==='pointerdown'&&row.trusted&&row.target==='pane'&&row.result),
      'Outside press itself lands on pane before result leaves');
    const exposed=await snap(applied.coord);
    check(exposed.hit==='Zoom Out'&&exposed.zoomOut.ownsPoint&&!exposed.zoomOut.disabled,'Original (93,290) exposes real enabled Zoom Out');
    await mark('deliberate-zoom-out',applied.coord);
    await page.mouse.click(...applied.coord);
    await settled('deliberate-zoom-out');
    const zoom=await snap(applied.coord);
    const rows=await trace('deliberate-zoom-out');
    check(rows.some(row=>row.type==='click'&&row.trusted&&row.detail===1&&row.target==='Zoom Out'&&!row.canceledAfterDispatch),
      'A deliberate count-1 click reaches Zoom Out');
    check(Math.abs(zoom.viewport[2]-exposed.viewport[2]/1.2)<0.00002,'Deliberate Zoom Out reduces scale by 1.2');
    await quiet(applied.next,1,await localDraft(),'ordinary-zoom-remains-viewport-only');
  }
  async function dismissedDouble(){
    const prior=await newFixture('double-dismiss');
    const device=await localDraft();
    const coord=await point('Dismiss suggestion'),before=await snap(coord);
    await mark('dismiss-double',coord);
    await page.mouse.dblclick(...coord);
    const after=await snap(coord);
    const rows=await trace('dismiss-double');
    await stableResult('dismiss-double',before,after,rows,'Suggestion dismissed.');
    check(rows.some(row=>row.type==='click'&&row.trusted&&row.detail===1&&row.target==='Dismiss suggestion') &&
      rows.some(row=>row.type==='click'&&row.trusted&&row.detail===2&&row.target==='space-result'),'Both trusted Dismiss clicks reach the right owner');
    same([after.viewport,after.history,after.selected],[before.viewport,before.history,before.selected],'Dismiss has no fit, history or selection effect');
    same(after.live?.text,'Suggestion dismissed.','Exact Dismiss announcement');
    await quiet(prior,0,device,'dismiss double click');
  }
  async function panGroup(name){
    const slug=name==='Space cards'?'space':'dismiss';
    await stage('pan-'+slug,async()=>{
      const prior=await newFixture('pan-'+slug);
      const priorDevice=await localDraft();
      const before=await snap(), readings=await measure(), press=await panePoint();
      const expected=expectedSpace(definition(prior),heights(readings));
      const originControl=before.buttons.find(row=>row.name===name);
      await mark('pan-press',press);
      await page.mouse.move(...press);
      await page.mouse.down();
      let whilePan, heldAfter;
      try{
        await page.mouse.move(press[0]+48,press[1]+35,{steps:7});
        whilePan=await snap(originControl.point);
        for(const button of whilePan.buttons){
          const original=before.buttons.find(row=>row.name===button.name);
          check(button.id===original.id && button.attached && button.unavailable && button.gesture==='panning' &&
            button.ownsHit && !button.disabled && button.pointerEvents!=='none','Both same controls remain attached and absorb hit while panning');
        }
        check(whilePan.buttons.length===2 && whilePan.viewport.join()!==before.viewport.join(),'True nonzero pan with both unavailable controls');
        await control(name).focus(opts);
        await mark('held-key-at-unavailable',originControl.point);
        await page.keyboard.down('Enter');
        await page.keyboard.up('Enter');
        heldAfter=await snap(originControl.point);
        check(heldAfter.focus===name && heldAfter.buttons.some(row=>row.id===originControl.id && row.unavailable) &&
          heldAfter.live?.text===before.live?.text && writes().length===0,'Active-pan key refused with focus and draft unchanged');
        same(heldAfter.selected,before.selected,'Pan/blocked input preserves selection');
        await mark('pan-release',originControl.point);
      }finally{await page.mouse.up();}
      const first=await page.evaluate(name=>new Promise((resolve,reject)=>{
        let frames=0;
        const probe=window.__spaceQA;
        function read(){
          const sample=probe.sample();
          const button=sample.buttons.find(row=>row.name===name);
          if(button?.attached && !button.unavailable && !button.disabled && button.ownsHit){
            probe.mark('first-enabled-observed',button.point);
            resolve({button,sample});
          }else if(++frames>180)reject(new Error('First naturally enabled control never appeared: '+name));
          else requestAnimationFrame(read);
        }
        read();
      }),name);
      await page.mouse.click(...first.button.point);
      const after=await settled('first-action-'+slug);
      const rows=await trace('first-action-'+slug);
      await checkpoint('pan-states-'+slug,{before,whilePan,heldAfter,first,after});
      const heldKey=rows.find(row=>row.stage==='held-key-at-unavailable'&&row.type==='keydown'&&row.trusted&&row.target===name);
      check(heldKey && rows.some(row=>row.stage===heldKey.stage && row.type==='keyup'&&row.trusted&&row.target===name),'Trusted unavailable attempt reaches real control');
      const firstEvents=rows.filter(row=>row.stage==='first-enabled-observed' && row.trusted);
      const clicks=firstEvents.filter(row=>row.type==='click');
      check(clicks.length===1 && clicks[0].path.includes(name) && clicks[0].target===name &&
        firstEvents.some(row=>row.type==='pointerdown'&&row.target===name) && firstEvents.some(row=>row.type==='pointerup'&&row.target===name),
        'Exactly one trusted first-enabled native down/up/click on '+name);
      check(clicks[0].t>=first.sample.t && !clicks[0].buttons.find(row=>row.name===name)?.unavailable &&
        clicks[0].canceledAfterDispatch===false,'First-enabled click reached action without cancellation');
      if(clicks[0].d3Observable)check(!clicks[0].d3.some(row=>row.capture),'No stale D3 click.drag during first-enabled press');
      else out.limits.push({label:'d3-bookkeeping-not-observable-'+slug});
      check(after.focus==='canvas-root'&&!after.modal&&after.buttons.length===0,'First-enabled '+name+' acts and restores canvas focus');
      same(after.selected,before.selected,'First-enabled '+name+' preserves selection');
      check(!heldAfter.result,'Gate refusal cannot show a result');
      await stableResult('first-enabled-'+slug,before,after,rows,slug==='space'?'Spaced '+expected.nodes.length+' cards.':'Suggestion dismissed.');
      if(slug==='space'){
        await accepted('first-enabled-space',0,prior,expected);
        await verifyGeometry('first-enabled-space',expected,readings);
        check(after.live?.text==='Spaced '+expected.nodes.length+' cards. Undo puts them back.','First enabled Space announces edit');
      }else{
        same(after.viewport,heldAfter.viewport,'First enabled Dismiss does not move viewport after pan');
        same(after.history,before.history,'First enabled Dismiss creates no history');
        await quiet(prior,0,priorDevice,'first-enabled-dismiss');
      }
      if(!rows.some(row=>row.buttons?.some(btn=>btn.gesture==='settling')))out.limits.push({label:'between-release-settling-frame-too-short-'+slug});
      out.limits.push({label:'no-synthetic-unavailable-pointer-click-'+slug,activeUnavailableInput:'trusted Enter while real mouse button held'});
    });
  }
  async function panelRead(label){
    const detail=await page.evaluate(()=>{
      const probe=window.__spaceQA,panel=document.querySelector('[data-testid="space-cards-offer"]');
      const pane=document.querySelector('.react-flow__pane');
      const help=panel.querySelector('button[aria-describedby]');
      const copy=document.getElementById(help.getAttribute('aria-describedby'));
      const range=document.createRange();
      range.selectNodeContents(copy);
      const lines=[...range.getClientRects()].map(r=>[r.x,r.y,r.width,r.height]);
      const [x,y,w,h]=probe.box(panel), [a,b,c,d]=probe.box(pane);
      const points=[[x-2,y+h/2],[x+w+2,y+h/2],[x+w/2,y+h+2]]
        .filter(([u,v])=>u>a&&u<a+c&&v>b&&v<b+d&&u<innerWidth&&v<innerHeight);
      return {panel:probe.box(panel),canvas:probe.box(pane),viewport:[innerWidth,innerHeight],lines,
        near:points.map(pt=>({pt,hit:probe.name(probe.hit(pt)),inFlow:!!probe.hit(pt)?.closest('.react-flow')})),
        helpFont:getComputedStyle(copy).fontSize, buttons:probe.sample().buttons,
        overflow:[copy.scrollWidth-copy.clientWidth,panel.scrollWidth-panel.clientWidth]};
    });
    await checkpoint('panel-'+label,detail);
    check(detail.lines.length>=2 && detail.lines.every(([x,,w])=>x>=0 && x+w<=detail.viewport[0]+.2) &&
      detail.overflow.every(delta=>delta<=1),'Readable wrapped panel without horizontal clipping');
    check(detail.near.length>=2 && detail.near.every(row=>row.inFlow),'Overlay leaves nearby visible canvas targets hittable');
    check(detail.buttons.every(row=>row.ownsHit),'Both panel buttons hittable');
    return detail;
  }
  async function sizingGroup(){
    await stage('same-dpr-root-pair',async()=>{
      const prior16=await newFixture('font16');
      const layout16=await panelRead('n768-16');
      await snapshot('n768-16');
      const normal=await geometryAction('font16-space',prior16);
      font=24; 
      const prior24=await newFixture('font24-controlled');
      const layout24=await panelRead('n768-24');
      await tabTo('Space cards');
      const focus=await snap();
      await checkpoint('controlled-root-focus',focus);
      check(focus.buttons[0]?.focusVisible,'Larger-text real keyboard focus is visible');
      await snapshot('n768-24-controlled-root');
      const enlarged=await geometryAction('font24-space',prior24);
      font=16;
      const y=(result)=>result.expected.nodes.find(node=>node.id==='peer').ui.y;
      await checkpoint('root-font-spacing-comparison',{normal:{layout:layout16,measurement:normal.readings,y:y(normal)},
        enlarged:{layout:layout24,measurement:enlarged.readings,y:y(enlarged)},method:'controlled CSS root 16/24px in same Edge, viewport and DPR'});
      check(enlarged.readings.tall.flow>normal.readings.tall.flow &&
        enlarged.readings.tall.flow>140 && y(enlarged)>y(normal),'A larger measured card increases required same-column gap');
      check(parseFloat(layout24.helpFont)>parseFloat(layout16.helpFont),'Controlled root override measurably enlarges panel text');
      out.limits.push({label:'sizing-method',applied:'150% CSS root-font override; disposable Edge preference equivalence is unverified'});
    });
    font=16;
  }
  async function protection(){
    await stage('one-card',async()=>{
      const prior=await newFixture('single',{single:true});
      check(!(await offer.count()),'A single origin card is ineligible');
      await quiet(prior,0,await localDraft(),'one-card-load');
    });
    await stage('manual-drag',async()=>{
      const prior=await newFixture('drag');
      await offer.waitFor(opts);
      const card=await fixtureCardPoint();
      const old=await snap();
      await mark('manual-node-drag',[card.x,card.y]);
      await page.mouse.move(card.x,card.y);
      await page.mouse.down();
      try{await page.mouse.move(card.x+89,card.y+54,{steps:10});}finally{await page.mouse.up();}
      const rows=await trace('manual-node-drag');
      check(rows.some(row=>row.type==='pointerdown'&&row.trusted&&row.target==='node:'+card.id) &&
        rows.some(row=>row.type==='pointerup'&&row.trusted),'Real native drag starts on exposed card and releases');
      const moved=await accepted('drag-manual-card',0,prior);
      const original=definition(prior), geometry=definition(moved);
      const target=geometry.nodes.find(node=>node.id===card.id);
      check(target.ui.x!==0||target.ui.y!==0,'Real card left origin');
      same({...geometry,nodes:geometry.nodes.map(node=>node.id===card.id?{...node,ui:original.nodes.find(row=>row.id===card.id).ui}:node)},original,
        'Only deliberate moved card position changes');
      await offer.waitFor({state:'detached',...opts});
      same((await snap()).viewport,old.viewport,'Node drag does not fit viewport');
      const undone=await historyMove('undo',moved,original,'undo-manual-geometry');
      await offer.waitFor(opts);
      const redone=await historyMove('redo',undone,geometry,'redo-manual-geometry');
      await offer.waitFor({state:'detached',...opts});
      const edited=await editLabel(redone,'manual-geometry-ordinary-label');
      const undoneLabel=await historyMove('undo',edited,geometry,'manual-label-undo');
      await historyMove('redo',undoneLabel,definition(edited),'manual-label-redo');
    });
    await stage('stored-manual-route',async()=>{
      const prior=await newFixture('routed',{routed:true});
      check(definition(prior).edges[0].ui?.route?.length===3 && !(await offer.count()),'All-origin persisted manual route prevents offer');
      const edited=await editLabel(prior,'routed-ordinary-label');
      const undone=await historyMove('undo',edited,definition(prior),'routed-label-undo');
      const redone=await historyMove('redo',undone,definition(edited),'routed-label-redo');
      const count=writes().length;
      await page.getByRole('button',{name:'Add Script node',exact:true}).first().click(opts);
      const added=await accepted('routed-add',count,redone);
      const original=definition(redone), actual=definition(added);
      const additions=actual.nodes.filter(node=>!original.nodes.some(old=>old.id===node.id));
      check(additions.length===1&&additions[0].kind==='script','Ordinary Add adds one script');
      same({...actual,nodes:actual.nodes.filter(node=>node.id!==additions[0].id)},original,'Ordinary Add preserves all existing nodes, edges and stored route');
      await load(true);
      check(!(await offer.count()),'Fresh load preserves manual route ineligibility');
      await quiet(added,count+1,await localDraft(),'route-reload');
    });
  }
  async function deviceGroup(){
    await stage('failed-put-reload-and-acknowledge',async()=>{
      const prior=await newFixture('fault');
      const readings=await measure(), expected=expectedSpace(definition(prior),heights(readings));
      await mark('scoped-failed-put');
      putHold={mode:'fail-once',id:loopId,used:false};
      await page.mouse.click(...await point('Space cards'));
      await save.filter({hasText:'Save failed'}).waitFor(opts);
      const failed=await until(()=>writes().find(row=>row.status===500&&row.responseText!==undefined),'scoped failure with raw response');
      const device=await until(async()=>{
        const row=await localDraft();return row?.synced===false && row;
      },'pending device mirror');
      const server=await get();
      await checkpoint('failed-draft-device',{failed,device,deviceShape:exactShape(device),server,expected});
      same(writes().length,1,'One scoped failed browser save');
      same(JSON.parse(failed.requestText).definition,device.definition,'Exact failed wire/device authored definition');
      same(wireToCanonical(device.definition),expected,'Pending device geometry exact');
      same(failed.requestHeaders['if-match'],quote(prior.draftToken),'Failed request conditions on original server');
      same(device.baseToken,prior.draftToken,'Pending device owns original base');
      same([definition(server),server.draftToken],[definition(prior),prior.draftToken],'Failed save leaves original durable server bytes/token');
      await trace('failed-put');
      let resume;
      const blocked=new Promise(resolve=>{resume=resolve;});
      putHold={mode:'hold-once',id:loopId,used:false,wait:blocked,release:resume};
      await load(true);
      const restored=page.getByText('Restored unsaved changes from this device.',{exact:true});
      await restored.waitFor(opts);
      await offer.waitFor({state:'detached',...opts});
      const recovered=await localDraft();
      await checkpoint('restored-before-acknowledgement',{device:recovered,shape:exactShape(recovered),view:await snap()});
      same(recovered.definition,device.definition,'Reload restores exactly the authored pending device definition');
      await verifyGeometry('restored-device-space',expected,readings);
      resume();
      await accepted('restored-acknowledgement',1,prior,expected);
    });
    await stage('real-conditional-conflict-owner-reload',async()=>{
      const prior=await newFixture('conflict');
      const readings=await measure(), expected=expectedSpace(definition(prior),heights(readings));
      const newer={...definition(prior),description:'Other editor updated this disposable loop'};
      const intervening=await api('PUT',path()+'/draft',{definition:newer},prior.draftToken);
      check(intervening.status===200 && intervening.body.draftToken!==prior.draftToken,'Public competing draft advanced revision','fixture');
      await page.mouse.click(...await point('Space cards'));
      const reload=page.getByRole('button',{name:'Reload server draft',exact:true});
      await reload.waitFor(opts);
      const refusal=await until(()=>writes().find(row=>row.status===409&&row.responseText!==undefined),'actual 409 conflict with response');
      const pending=await localDraft(), server=await get();
      await checkpoint('conflict-ownership',{prior,intervening,refusal,pending,pendingShape:exactShape(pending),server});
      same(writes().length,1,'One refused conditional browser PUT');
      same(refusal.requestHeaders['if-match'],quote(prior.draftToken),'Browser submits stale original token');
      const problem=JSON.parse(refusal.responseText);
      same([problem.code,problem.draftToken],['DRAFT_CONFLICT',intervening.body.draftToken],'Server identifies actual competing owner token');
      same([definition(server),server.draftToken],[newer,intervening.body.draftToken],'No unintended server write during conflict');
      check(pending?.synced===false && pending.baseToken===prior.draftToken,'Unsent device copy retains original token ownership');
      same(JSON.parse(refusal.requestText).definition,pending.definition,'Refused full wire/device definitions match');
      same(wireToCanonical(pending.definition),expected,'Pending geometry remains exact through conflict');
      await reload.click(opts);
      await offer.waitFor(opts);
      await reload.waitFor({state:'detached',...opts});
      const loaded=await snap(), device=await localDraft();
      await checkpoint('conflict-reload',{loaded,device,deviceShape:exactShape(device),server:await get()});
      same([device?.synced,device?.baseToken,device?.definition],[true,server.draftToken,definition(server)],'Confirmed owner reload synchronizes exact authoritative device copy');
      await quiet(server,1,device,'owner-server-reload');
      check(!loaded.modal && loaded.history.every(row=>row[1]==='true'),'Reload server draft clears abandoned geometry history');
    });
  }


  async function delayedAndShift(){
    await stage('delayed-centre-selected-node',()=>repeatedSpace('slow-node',{mode:'delayed',selected:'node'}));
    await stage('shift-centre-selected-edge',()=>repeatedSpace('shift-edge',{selected:'edge',shift:true}));
  }

  async function repeatAtFailurePoint(){
    await stage('original-r512-failure-point',async()=>{
      const applied=await repeatedSpace('r512-count-two',{fixed:true});
      same(applied.after.viewport,[1,29,.5],'Original fixture uses one qualified R512 fit');
      await unlockZoom(applied);
      const undone=await historyMove('undo',applied.next,definition(applied.prior),'r512-one-undo');
      check(undone.draftToken!==applied.next.draftToken&&(await snap()).history[0][1]==='true','One Undo exhausts the Space history');
      await offer.waitFor(opts);
    });
    await stage('r512-count-one',()=>repeatedSpace('r512-count-one',{mode:'separate',fixed:true}));
    await stage('r512-count-three',()=>repeatedSpace('r512-count-three',{mode:'triple',fixed:true}));
    await stage('r512-delayed-selected-edge',()=>repeatedSpace('r512-delay',{mode:'delayed',fixed:true,selected:'edge'}));
    await stage('r512-shift-repeat-drag',()=>repeatedSpace('r512-shift-drag',{mode:'drag',fixed:true,selected:'node',shift:true}));
    await stage('r512-dismiss-repeat',dismissedDouble);
  }

  async function touchRepeat(){
    await stage('touch-repeat-and-outside',async()=>{
      const prior=await newFixture('coarse-repeat');
      const panel=await panelRead('coarse-repeat');
      check(panel.buttons.every(button=>button.box[2]>=44&&button.box[3]>=44),'Coarse native targets are at least 44 CSS px');
      const coord=(await point('Space cards')).map(Math.round),before=await snap(coord);
      const applied=await geometryAction('coarse-first-tap',prior,{input:()=>page.touchscreen.tap(...coord)});
      check(applied.rows.some(row=>row.type==='pointerdown'&&row.trusted&&row.pointerType==='touch'&&row.target==='Space cards'),
        'Native emulated first touch reached the Space button');
      const offset=[coord[0]+10,coord[1]];
      check((await snap(offset)).hit==='space-result','Offset touch point is inside the persistent result');
      await mark('coarse-repeats',coord);
      await page.touchscreen.tap(...coord);
      await page.touchscreen.tap(...offset);
      await settled('coarse-repeats');
      const after=await snap(coord),rows=await trace('coarse-repeats');
      await stableResult('coarse-repeats',before,after,rows,'Spaced '+applied.expected.nodes.length+' cards.');
      const down=rows.filter(row=>row.type==='pointerdown'&&row.trusted&&row.pointerType==='touch');
      same(down.map(row=>[row.point,row.target]),[[coord,'space-result'],[offset,'space-result']],'Trusted same and +10 px touch hits');
      same(viewSequence(rows),[applied.after.viewport.join(',')],'No second touch zoom or pan');
      same(after.selected,applied.after.selected,'Repeats preserve selection');
      await quiet(applied.next,1,await localDraft(),'coarse repeat preserves graph and device');
      await selectForProbe('node');
      const outside=await panePoint();
      await mark('coarse-outside',outside);
      await page.touchscreen.tap(...outside);
      await result.waitFor({state:'detached',...opts});
      const events=await trace('coarse-outside');
      check(events.some(row=>row.type==='pointerdown'&&row.trusted&&row.pointerType==='touch'&&row.target==='pane'&&row.result),
        'First native outside tap reaches the pane');
      same((await snap()).selected,[],'Outside tap clears the existing node selection');
      await quiet(applied.next,1,await localDraft(),'coarse outside tap remains selection only');
    });
    await stage('coarse-touch-dismiss',async()=>{
      const prior=await newFixture('coarse-dismiss');
      const device=await localDraft(),coord=await point('Dismiss suggestion'),before=await snap(coord);
      await mark('coarse-touch-dismiss',coord);
      await page.touchscreen.tap(...coord);
      await offer.waitFor({state:'detached',...opts});
      const after=await snap(coord),rows=await trace('coarse-touch-dismiss');
      await stableResult('coarse-dismiss',before,after,rows,'Suggestion dismissed.');
      check(rows.some(row=>row.type==='pointerdown'&&row.trusted&&row.pointerType==='touch'&&row.target==='Dismiss suggestion'),
        'Trusted coarse touchscreen tap dismisses');
      same(after.viewport,before.viewport,'Coarse Dismiss does not fit');
      await quiet(prior,0,device,'coarse-dismiss');
    });
  }

  async function plainDrag(start,end,{shift=false,during}={}){
    if(shift)await page.keyboard.down('Shift');
    await page.mouse.move(...start);
    await page.mouse.down();
    try{
      await page.mouse.move(...end,{steps:7});
      if(during)await during();
    }finally{
      await page.mouse.up();
      if(shift)await page.keyboard.up('Shift');
    }
  }
  async function witnessedOutside(label,at,action,target){
    const before=await snap(at);
    check(before.result&&before.hit===target,label+' initial positive hit outside the result','unwitnessed');
    await mark(label,at);
    await action();
    await result.waitFor({state:'detached',...opts});
    await settled(label);
    const rows=await trace(label);
    check(rows.some(row=>row.type==='pointerdown'&&row.trusted&&row.target===target&&row.result),
      label+' delivers first outside down to same native target');
    await checkpoint('outside-'+label,{before,after:await snap(),trusted:rows.filter(row=>row.trusted)});
    return {before,after:await snap(),rows};
  }
  async function locatorHit(locator){
    return locator.evaluate(el=>{
      const probe=window.__spaceQA;
      const [x,y,w,h]=probe.box(el),coord=[x+w/2,y+h/2];
      return el.contains(probe.hit(coord))?{coord,target:probe.name(probe.hit(coord))}:null;
    },undefined,opts);
  }

  async function outsideControls(){
    await stage('outside-pane-click',async()=>{
      const prior=await newFixture('outside-pane');
      const applied=await geometryAction('outside-pane-space',prior);
      await selectForProbe('node');
      const pane=await panePoint();
      const seen=await witnessedOutside('pane',pane,()=>page.mouse.click(...pane),'pane');
      same(seen.after.selected,[],'First outside pane click clears selection');
      await quiet(applied.next,1,await localDraft(),'outside pane click stays save-free');
    });
    await stage('outside-shift-selection',async()=>{
      const prior=await newFixture('outside-shift');
      const applied=await geometryAction('outside-shift-space',prior);
      const pane=await panePoint();
      let described;
      await witnessedOutside('shift-select',pane,()=>plainDrag(pane,[pane[0]+34,pane[1]+33],{
        shift:true,during:async()=>{described=await snap();},
      }),'pane');
      check(described?.selectionBox,'First outside Shift-drag creates the real selection box');
      await quiet(applied.next,1,await localDraft(),'outside Shift selection stays save-free');
    });
    await stage('outside-pan',async()=>{
      const prior=await newFixture('outside-pan');
      const applied=await geometryAction('outside-pan-space',prior);
      const pane=await panePoint();
      const seen=await witnessedOutside('pan',pane,()=>plainDrag(pane,[pane[0]+42,pane[1]+36]),'pane');
      check(seen.after.viewport.join()!==seen.before.viewport.join(),'First outside pane pan moves the viewport');
      await quiet(applied.next,1,await localDraft(),'outside pan stays save-free');
    });
    await stage('outside-route-handle',async()=>{
      const prior=await newFixture('outside-route');
      const applied=await geometryAction('outside-route-space',prior);
      await selectForProbe('edge');
      const handle=page.locator('.react-flow__edge[data-id="entry"] .gg-route-handle[data-segment="1"]');
      await handle.waitFor(opts);
      const hit=await locatorHit(handle);
      check(hit?.target==='route:entry:1','Visible real route handle outside the result','unwitnessed');
      const {coord,target}=hit;
      await witnessedOutside('route-handle',coord,()=>plainDrag(coord,[coord[0],coord[1]+100]),target);
      const routed=await accepted('outside route handle saves once',1,applied.next);
      const before=definition(applied.next),after=definition(routed);
      check(after.edges.find(edge=>edge.id==='entry').ui?.route?.length===3,'Real outside drag writes a durable route');
      same({...after,edges:after.edges.map(edge=>edge.id==='entry'?before.edges.find(item=>item.id==='entry'):edge)},before,
        'Route drag only changes the selected edge');
      check((await snap()).live?.text==='Route changed.','Exact public route confirmation');
    });
    await stage('outside-node-drag',async()=>{
      const prior=await newFixture('outside-node');
      const applied=await geometryAction('outside-node-space',prior);
      const card=await fixtureCardPoint(),coord=[card.x,card.y];
      await witnessedOutside('node-drag',coord,()=>plainDrag(coord,[coord[0]+70,coord[1]+53]),'node:'+card.id);
      const moved=await accepted('outside node drag saves once',1,applied.next);
      const before=definition(applied.next),after=definition(moved);
      const oldNode=before.nodes.find(node=>node.id===card.id),newNode=after.nodes.find(node=>node.id===card.id);
      check(newNode.ui.x!==oldNode.ui.x||newNode.ui.y!==oldNode.ui.y,'First outside native node drag changes position');
      same({...after,nodes:after.nodes.map(node=>node.id===card.id?{...node,ui:oldNode.ui}:node)},before,'Node drag preserves all other values');
    });
    await stage('outside-connect',async()=>{
      const prior=await newFixture('outside-connect');
      const applied=await geometryAction('outside-connect-space',prior);
      const from=await locatorHit(page.locator('.react-flow__handle[data-nodeid="island"][data-handleid="out"]'));
      const to=await locatorHit(page.locator('.react-flow__handle[data-nodeid="peer"][data-handleid="in"]'));
      check(from?.target==='handle:island'&&to?.target==='handle:peer','Hittable public connection handles outside the result','unwitnessed');
      await witnessedOutside('connection',from.coord,()=>plainDrag(from.coord,to.coord),'handle:island');
      const connected=await accepted('outside connection saves once',1,applied.next);
      const before=definition(applied.next),after=definition(connected);
      const added=after.edges.filter(edge=>!before.edges.some(old=>old.id===edge.id));
      check(added.length===1,'First outside connection adds one edge');
      same([added[0].from.node,added[0].from.port,added[0].to.node,added[0].to.port],['island','out','peer','in'],'Exact native pointer connection');
      same({...after,edges:after.edges.filter(edge=>edge.id!==added[0].id)},before,'Connection preserves prior data and route order');
    });
  }

  async function resultLifecycle(){
    await stage('keyboard-history-with-result',async()=>{
      const prior=await newFixture('result-keyboard-undo');
      const applied=await geometryAction('keyboard-undo-space',prior);
      const coord=await result.evaluate(el=>{
        const [x,y,w,h]=window.__spaceQA.box(el);return [x+w/2,y+h/2];
      },undefined,opts);
      await page.mouse.move(...coord);
      await page.mouse.wheel(0,15);
      await page.keyboard.down('Shift');
      await page.keyboard.up('Shift');
      check((await snap(coord)).hit==='space-result','Wheel and non-action keys retain the result');
      await page.keyboard.press('Control+z');
      const undone=await accepted('keyboard Undo leaves live offer',1,applied.next,definition(prior));
      await offer.waitFor(opts);
      check(!(await result.count())&&(await snap()).history[0][1]==='true','One keyboard Undo restores the live pile and retires the result');
      same((await settled('keyboard-UnDo')).viewport,applied.after.viewport,'Keyboard Undo does not re-fit');
      await page.keyboard.press('Control+Shift+z');
      await accepted('keyboard Redo remains result-free',2,undone,applied.expected);
      check(!(await result.count())&&!(await offer.count()),'Redo does not recreate a pointer result');
    });
    await stage('toolbar-history-with-result',async()=>{
      const prior=await newFixture('outside-toolbar-undo');
      const applied=await geometryAction('toolbar-undo-space',prior);
      check(await result.isVisible(),'Toolbar Undo begins with a visible result');
      await historyMove('undo',applied.next,definition(prior),'outside Toolbar Undo');
      await offer.waitFor(opts);
      check(!(await result.count())&&(await snap()).history[0][1]==='true','First outside Toolbar press performs exactly one Undo');
    });
    await stage('dismiss-reload-without-press',async()=>{
      const prior=await newFixture('dismiss-then-reload');
      const coord=await point('Dismiss suggestion');
      await page.mouse.click(...coord);
      check(await result.isVisible(),'Dismiss result visible before new load');
      await load(true);
      await offer.waitFor(opts);
      check(!(await result.count()),'New load retires prior result without an outside press');
      await quiet(prior,0,await localDraft(),'dismiss/reload leaves exact graph');
      await page.mouse.click(...await point('Dismiss suggestion'));
      check(await result.isVisible(),'Dismiss result visible before route leaves');
      const loops=page.getByRole('navigation',{name:'Main'}).getByRole('link',{name:'Loops',exact:true});
      await loops.focus(opts);
      await page.keyboard.press('Enter');
      await page.waitForURL(origin+'/app/loops',opts);
      await result.waitFor({state:'detached',...opts});
      await load();
      await offer.waitFor(opts);
      check(!(await result.count()),'Keyboard route unmount and re-entry leave no prior result');
      await quiet(prior,0,await localDraft(),'native route unmount leaves exact graph');
    });
  }

  function installQueuedFitTrace() {
    const ids=new WeakMap(), watched=new WeakSet();
    const parser=document.createElement('div');
    const viewport=()=>document.querySelector('.react-flow__viewport');
    let id=0, active=false, rows=[], overflow=false, lastCommit='';
    const identity=el=>{if(!ids.has(el))ids.set(el,++id);return ids.get(el);};
    function transform(style) {
      parser.style.cssText=style??'';
      if(!parser.style.transform)return null;
      const m=new DOMMatrixReadOnly(parser.style.transform);
      return [m.e,m.f,m.a];
    }
    function sample() {
      const view=viewport(), flow=document.querySelector('.react-flow');
      const cards=[...(flow?.querySelectorAll('.react-flow__node')??[])].map(el=>{
        const m=el.style.transform?new DOMMatrixReadOnly(el.style.transform):new DOMMatrixReadOnly();
        return {id:el.dataset.id,position:[m.e,m.f],size:[el.offsetWidth,el.offsetHeight]};
      });
      return {viewportId:view?identity(view):null,viewport:transform(view?.getAttribute('style')),
        pane:flow?[flow.clientWidth,flow.clientHeight]:null,cards,
        route:location.pathname,focus:document.activeElement?.getAttribute('data-testid')??document.activeElement?.tagName,
        offer:!!document.querySelector('[data-testid="space-cards-offer"]'),
        result:document.querySelector('[data-testid="space-cards-result"]')?.textContent.trim()??null,
        history:[...document.querySelectorAll('[data-history]')].map(el=>[el.dataset.history,el.title,el.getAttribute('aria-disabled'),el.disabled])};
    }
    function record(type,details={}) {
      if(!active)return;
      if(rows.length>=900){overflow=true;return;}
      rows.push({type,t:performance.now(),...sample(),...details});
    }
    function watch() {
      const view=viewport();
      if(!view||watched.has(view))return;
      watched.add(view);
      new MutationObserver(changes=>{
        for (const [i,change] of changes.entries()) {
          const to=i+1<changes.length?changes[i+1].oldValue:view.getAttribute('style');
          const from=transform(change.oldValue), next=transform(to);
          if(JSON.stringify(from)!==JSON.stringify(next))
            record('viewport-style',{styleViewportId:identity(view),connected:view.isConnected,from,to:next});
        }
      }).observe(view,{attributes:true,attributeFilter:['style'],attributeOldValue:true});
    }
    for(const type of ['pointerdown','click','keydown']) document.addEventListener(type,event=>{
      const element=event.target instanceof Element?event.target:null;
      const action=element?.closest('button,a,[data-editor-canvas]');
      record(type,{trusted:event.isTrusted,key:event.key,ctrl:event.ctrlKey,detail:event.detail,
        eventTime:event.timeStamp,action:action?.getAttribute('aria-label')??action?.textContent.trim().slice(0,80)??null,
        href:action instanceof HTMLAnchorElement?new URL(action.href).pathname:null,targetCanvas:action?.hasAttribute('data-editor-canvas')??false});
    },{capture:true,passive:true});
    new MutationObserver(()=>{
      watch();
      if(!active)return;
      const state=sample();
      const key=JSON.stringify([state.viewportId,state.cards,state.offer,state.result,state.history]);
      if(key!==lastCommit){lastCommit=key;record('dom-adopted');}
    }).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['style','title','aria-disabled']});
    function frame() {
      if(active)record('frame');
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    window.__queuedFitQA={sample,
      start(){watch();rows=[];overflow=false;lastCommit='';active=true;record('mark');},
      stop(){const wasActive=active;record('end');active=false;return {rows,overflow,last:sample(),wasActive};}};
  }
  const fitSample=()=>page.evaluate(()=>window.__queuedFitQA.sample());
  const fitStart=()=>page.evaluate(()=>window.__queuedFitQA.start());
  const fitSettle=async label=>{await settled(label);return fitSample();};
  async function fitTrace(label,extra={}) {
    const evidence=await page.evaluate(()=>window.__queuedFitQA.stop());
    await checkpoint('fit-trace-'+label,{...evidence,...extra});
    check(!evidence.overflow,'Queued-fit trace overflow at '+label,'fixture');
    return evidence;
  }
  function fitNear(a,b) {
    return Array.isArray(a)&&Array.isArray(b)&&a.length===3&&b.length===3&&
      a.every((x,i)=>Number.isFinite(x)&&Math.abs(x-b[i])<=(i===2?0.00002:0.02));
  }
  function fitHeld(evidence,input,id,expected,label) {
    check(input?.trusted&&input.viewportId===id,'Missing trusted input on the retained canvas for '+label,'unwitnessed');
    check(fitNear(input.viewport,expected),label+' viewport before input differs');
    const after=evidence.rows.filter(row=>row.t>=input.t);
    check(after.every(row=>row.viewportId!==id||fitNear(row.viewport,expected)),label+' viewport changed across authorized input');
    check(!after.some(row=>row.type==='viewport-style'&&row.styleViewportId===id),
      label+' retained viewport wrote a transient or late transform');
  }
  const fitCoords=sample=>sample.cards.map(card=>[card.id,card.position]);
  const fitOpening=[246,279.5,2], fitZoomed=[276.667,298.5,1.66667], fitSpaced=[72,303.5,1.57895];
  async function seedFit(suffix,wide=false) {
    const name='Space probe '+suffix;
    const payload={schemaVersion:4,name,nodes:[
      {id:'start',kind:'trigger',label:'Manual entry',config:{type:'manual',exposeTo:['ui','api','mcp']}},
      {id:'finish',kind:'exit',label:'Completion',config:{outcome:'success'},...(wide?{ui:{x:3600,y:0}}:{})},
    ],edges:[{id:'entry',from:{node:'start',port:'out'},to:{node:'finish',port:'in'}}]};
    const created=await api('POST','/loops',{definition:payload});
    check(created.status===201&&created.body.loop?.id,'Rejected queued-fit fixture','fixture');
    const id=created.body.loop.id;
    const detail=await api('GET',path(id));
    check(detail.status===200,'Missing queued-fit fixture GET','fixture');
    return {id,name,prior:detail.body};
  }
  function fitGraph(prior) {
    const graph=structuredClone(definition(prior));
    graph.nodes.find(node=>node.id==='finish').ui={x:272,y:0};
    return graph;
  }
  async function startFit(suffix) {
    const {id,prior}=await seedFit(suffix);
    loopId=id;
    await load();
    const opened=await fitSample(), device=await localDraft();
    await checkpoint('fit-open-'+suffix,{id,opened,prior,device,writes:writes()});
    check(opened.offer&&opened.viewportId&&opened.cards.length===2&&opened.cards.every(card=>card.position.every(v=>v===0)),'Expected eligible origin pile','fixture');
    same(opened.pane,[860,787],'Original D1 reference pane size');
    same(opened.cards.map(card=>[card.id,card.size]),[['start',[184,114]],['finish',[184,92]]],
      'Original measured D1 two-card fixture');
    check(fitNear(opened.viewport,fitOpening),'Ordinary opening fit differs from the baseline geometry');
    const zoom=page.locator('.react-flow__controls-zoomout');
    check(await zoom.isEnabled(),'Reference Zoom Out unavailable','fixture');
    await zoom.click(opts);
    const before=await fitSettle('fit-reference-'+suffix);
    await checkpoint('fit-reference-'+suffix,{before,opened,writes:writes(),device:await localDraft(),server:await get()});
    check(fitNear(before.viewport,fitZoomed),'Deliberate reference zoom differs from the established D1 fixture','fixture');
    check(writes().length===0,'Opening/Zoom Out wrote a draft');
    return {prior,before,expected:fitGraph(prior)};
  }
  async function clickFitSpace() {
    const at=await point('Space cards');
    await page.mouse.click(...at);
  }
  async function queuedFitGroup() {
    let positive;
    await stage('fit-uninterrupted-measured',async()=>{
      const {prior,before,expected}=await startFit('aaaa');
      const count=writes().length;
      await fitStart();
      await clickFitSpace();
      const after=await fitSettle('fit-positive');
      const trace=await fitTrace('positive',{before,after,expected,writes:writes(),device:await localDraft()});
      check(trace.rows.some(row=>row.type==='click'&&row.trusted&&row.action==='Space cards'),
        'Missing trusted Space button click','unwitnessed');
      same(fitCoords(after),[['start',[0,0]],['finish',[272,0]]],'Exact measured card positions');
      const mutations=trace.rows.filter(row=>row.type==='viewport-style'&&row.styleViewportId===before.viewportId);
      check(after.viewportId===before.viewportId&&mutations.length===1&&fitNear(mutations[0].from,fitZoomed)&&fitNear(mutations[0].to,fitSpaced)&&
        fitNear(after.viewport,fitSpaced),'Exactly one actual Space fit to the established measured viewport');
      check(after.result==='Spaced 2 cards.'&&after.focus==='canvas'&&after.history.some(([dir,title,ariaDisabled])=>
        dir==='undo'&&title==='Undo space cards'&&ariaDisabled!=='true'),'Space preserves result, canvas focus and one named history step');
      const saved=await accepted('fit-positive-space',count,prior,expected);
      positive={id:loopId,saved,after};
    });
    await stage('fit-trusted-edit',async()=>{
      check(loopId===positive.id&&(await fitSample()).viewportId===positive.after.viewportId,
        'Label edit must use the canvas which applied Space','fixture');
      const zoom=page.getByRole('button',{name:'Zoom Out',exact:true});
      const box=await zoom.boundingBox(opts);
      check(box&&await zoom.isEnabled(),'Independent Zoom Out has no available native hit target','fixture');
      const point=[box.x+box.width/2,box.y+box.height/2];
      const zoomOrigin=await fitSample(), atZoom=await snap(point), count=writes().length, device=await localDraft();
      await checkpoint('fit-first-outside-zoom-preinput',{zoomOrigin,atZoom,point,device,writes:writes()});
      check(zoomOrigin.result&&atZoom.hit==='Zoom Out'&&!atZoom.zoomOut?.disabled&&atZoom.zoomOut?.ownsPoint,
        'First outside input must reach the enabled native Zoom Out while the result is attached','fixture');
      await fitStart();
      await page.mouse.click(...point);
      const before=await fitSettle('fit-edit-reference');
      await quiet(positive.saved,count,device,'fit-first-outside-zoom');
      const zoomTrace=await fitTrace('first-outside-zoom',{zoomOrigin,before,point,device,writes:writes()});
      const zoomClick=zoomTrace.rows.find(row=>row.type==='click'&&row.trusted&&row.action==='Zoom Out');
      const zoomDown=zoomTrace.rows.find(row=>row.type==='pointerdown'&&row.trusted&&row.action==='Zoom Out');
      const moves=zoomTrace.rows.filter(row=>row.type==='viewport-style'&&row.styleViewportId===before.viewportId);
      check(zoomDown?.result&&zoomClick&&moves.length===1&&fitNear(moves[0].from,zoomOrigin.viewport)&&
        fitNear(moves[0].to,before.viewport)&&Math.abs(before.viewport[2]-zoomOrigin.viewport[2]/1.2)<=.00002&&!before.result,
        'First outside Zoom Out must act exactly once and keep its transform');
      const card=await fixtureCardPoint(), expected=structuredClone(definition(positive.saved));
      const node=expected.nodes.find(item=>item.id===card.id);
      node.label+=' revised';
      await fitStart();
      await page.mouse.click(card.x,card.y);
      const dialog=page.getByRole('dialog');
      await dialog.getByLabel('Label',{exact:true}).fill(node.label,opts);
      await dialog.getByRole('button',{name:'Done',exact:true}).click(opts);
      await dialog.waitFor({state:'detached',...opts});
      const after=await fitSettle('fit-edit');
      const saved=await accepted('fit-label-edit',count,positive.saved,expected);
      const trace=await fitTrace('edit',{before,after,expected,saved,writes:writes(),device:await localDraft()});
      const input=trace.rows.find(row=>row.type==='click'&&row.action==='Done'&&row.trusted);
      fitHeld(trace,input,before.viewportId,before.viewport,'Ordinary label edit');
      check(trace.rows.every(row=>row.viewportId!==before.viewportId||fitNear(row.viewport,before.viewport)),
        'Opening or committing the label editor refit the viewport');
      positive={id:loopId,saved,after};
    });
    await stage('fit-unmount-and-independent-fit-controls',async()=>{
      const oldId=positive.id, old=await fitSample(), oldDevice=await localDraft(), count=writes().length;
      const destination=await seedFit('dddd',true);
      await fitStart();
      const loops=page.getByRole('navigation',{name:'Main'}).getByRole('link',{name:'Loops',exact:true});
      await loops.click(opts);
      await page.waitForURL(origin+'/app/loops',opts);
      await canvas.waitFor({state:'detached',...opts});
      await page.getByRole('link',{name:'Edit '+destination.name,exact:true}).click(opts);
      loopId=destination.id;
      await page.waitForURL(origin+'/app'+path()+'/edit',opts);
      await ready();
      const mounted=await fitSample();
      const trace=await fitTrace('unmount',{old,mounted,oldId,destination,requests,oldDevice});
      const leave=trace.rows.find(row=>row.type==='click'&&row.trusted&&row.href==='/app/loops');
      const enter=trace.rows.find(row=>row.type==='click'&&row.trusted&&row.href==='/app'+path()+'/edit');
      check(leave?.viewportId===old.viewportId&&enter&&trace.rows.some(row=>row.viewportId===null)&&
        mounted.viewportId!==old.viewportId,'Trusted navigation must detach the old viewport and mount a distinct one','unwitnessed');
      fitHeld(trace,leave,old.viewportId,old.viewport,'Unmount');
      check(!trace.rows.some(row=>row.type==='viewport-style'&&row.styleViewportId===old.viewportId),
        'Detached prior Space viewport was mutated');
      const left=await api('GET',path(oldId)), leftDevice=await localDraft(oldId);
      same([definition(left.body),left.body.draftToken,leftDevice,requests.filter(row=>row.path===path(oldId)+'/draft').length],
        [definition(positive.saved),positive.saved.draftToken,oldDevice,count],'Unmount leaves original saved graph, token and device');
      check(!mounted.offer&&!mounted.result&&Math.abs(mounted.viewport[2]-.5)<=.00002,
        'Wide positioned replacement has only the ordinary readable opening fit');
      same(fitCoords(mounted),[['start',[0,0]],['finish',[3600,0]]],'Replacement coordinates were loaded unchanged');
      const cold=await get(), device=await localDraft();
      same([definition(cold),cold.draftToken],[definition(destination.prior),destination.prior.draftToken],
        'Replacement opening is authoritative and quiet');
      await quiet(cold,0,device,'fit-opening');
      await load(true);
      const cleanOpening=await fitSample();
      await checkpoint('fit-independent-opening',{mounted,cleanOpening,device:await localDraft(),server:await get(),writes:writes()});
      check(fitNear(cleanOpening.viewport,mounted.viewport),'Replacement opening equals the clean isolated opening of its same graph');
      same(fitCoords(cleanOpening),fitCoords(mounted),'Independent opening preserves replacement geometry');
      await fitStart();
      await page.getByRole('button',{name:'Fit View',exact:true}).click(opts);
      const fitted=await fitSettle('fit-manual');
      const manual=await fitTrace('manual',{cleanOpening,fitted,device,writes:writes()});
      const click=manual.rows.find(row=>row.type==='click'&&row.trusted&&row.action==='Fit View');
      const dx=manual.rows.filter(row=>row.type==='viewport-style'&&row.styleViewportId===cleanOpening.viewportId);
      const wide=fitted.cards.find(card=>card.id==='finish'), first=fitted.cards.find(card=>card.id==='start');
      const [w,h]=fitted.pane, width=wide.position[0]+wide.size[0];
      const height=Math.max(first.size[1],wide.size[1]);
      const targetZoom=(w-72-Math.floor(w*.08))/width;
      check(click?.viewportId===cleanOpening.viewportId&&targetZoom>.1&&targetZoom<.5,'Wide manual Fit control can distinguish zoom floors','fixture');
      const expected=[72,(h-height*targetZoom)/2,targetZoom];
      check(dx.length===1&&fitNear(dx[0].from,cleanOpening.viewport)&&fitNear(dx[0].to,expected)&&fitNear(fitted.viewport,expected),
        'Trusted manual Fit preserves its measured lower zoom and exact padding');
      await quiet(cold,0,device,'fit-manual');
    });
    await stage('fit-trusted-rapid-undo',async()=>{
      const {prior,before,expected}=await startFit('bbbb');
      await fitStart();
      await clickFitSpace();
      await page.getByRole('button',{name:'Undo space cards',exact:true}).waitFor(opts);
      await page.keyboard.press('Control+z');
      await page.getByRole('button',{name:'Redo space cards',exact:true}).waitFor(opts);
      const after=await fitSettle('fit-undo');
      await pause(autosaveMs+180);
      const trace=await fitTrace('undo',{before,after,expected,writes:writes(),device:await localDraft()});
      const input=trace.rows.find(row=>row.type==='keydown'&&row.key?.toLowerCase()==='z'&&row.ctrl&&row.trusted);
      check(input?.targetCanvas&&input.history.some(([dir,title])=>dir==='undo'&&title==='Undo space cards'),
        'Ctrl+Z must own the applied Space edit through the actual canvas','unwitnessed');
      check(fitNear(input.viewport,fitZoomed)||fitNear(input.viewport,fitSpaced),'Undo landed at an unqualified viewport','unwitnessed');
      fitHeld(trace,input,before.viewportId,input.viewport,'Undo');
      same(fitCoords(after),[['start',[0,0]],['finish',[0,0]]],'Undo restores the original pile');
      check(after.offer&&!after.result&&after.history.some(([d,t,ariaDisabled])=>d==='redo'&&t==='Redo space cards'&&ariaDisabled!=='true'),
        'One Undo restores offer and named Redo');
      check(after.history.some(([d,,ariaDisabled])=>d==='undo'&&ariaDisabled==='true'),'No remaining Undo step');
      const wire=await until(()=>{
        const rows=writes();
        return rows.every(row=>row.responseText!==undefined)&&{rows};
      },'rapid Undo browser PUT receipts');
      const server=await get(), device=await localDraft();
      await checkpoint('fit-undo-durable',{prior,server,device,writes:wire.rows,after});
      same(definition(server),definition(prior),'Rapid Undo leaves original durable graph');
      const payloads=wire.rows.map(row=>wireToCanonical(JSON.parse(row.requestText).definition));
      if(payloads.length===2)same(payloads,[expected,definition(prior)],'Both rapid Undo revisions were preserved in order');
      else if(payloads.length===1)same(payloads,[definition(prior)],'Coalesced rapid Undo writes only the restored graph');
      else check(payloads.length===0,'Unexpected extra rapid Undo writes');
      let token=prior.draftToken;
      for(const row of wire.rows) {
        check(row.status===200&&row.requestHeaders['if-match']===quote(token),'Rapid Undo uses an accepted conditional save');
        const reply=JSON.parse(row.responseText);
        same(reply.draft.definition,wireToCanonical(JSON.parse(row.requestText).definition),'Rapid Undo acknowledged graph');
        token=reply.draftToken;
      }
      same(server.draftToken,token,'Rapid Undo exact terminal server token');
      if(wire.rows.length||device)
        same([device?.synced,device?.baseToken,wireToCanonical(device?.definition??{nodes:[]})],
          [true,token,definition(prior)],'Rapid Undo device ownership and graph');
    });
    await stage('fit-authoritative-conflict-reload',async()=>{
      const {prior,before,expected}=await startFit('eeee');
      const newer={...definition(prior),description:'Other editor updated this disposable fit fixture'};
      const intervening=await api('PUT',path()+'/draft',{definition:newer},prior.draftToken);
      check(intervening.status===200&&intervening.body.draftToken!==prior.draftToken,'Real competing revision required','fixture');
      await fitStart();
      await clickFitSpace();
      const reload=page.getByRole('button',{name:'Reload server draft',exact:true});
      await reload.waitFor(opts);
      const refusal=await until(()=>writes().find(row=>row.status===409&&row.responseText!==undefined),'actual draft conflict');
      const conflict=await fitSettle('fit-before-reload'), pendingDraft=await localDraft(), server=await get();
      const apply=await fitTrace('conflict-space',{prior,before,expected,intervening,refusal,conflict,pendingDraft,server,writes:writes()});
      check(apply.rows.some(row=>row.type==='click'&&row.trusted&&row.action==='Space cards'),
        'Missing trusted apply before server reload','unwitnessed');
      check(fitNear(conflict.viewport,fitSpaced)&&conflict.viewportId===before.viewportId,'Conflict still owns the completed Space viewport');
      const problem=JSON.parse(refusal.responseText);
      same([writes().length,refusal.requestHeaders['if-match'],problem.code,problem.draftToken],
        [1,quote(prior.draftToken),'DRAFT_CONFLICT',intervening.body.draftToken],'Exact one real conditional conflict');
      same([pendingDraft?.synced,pendingDraft?.baseToken,wireToCanonical(pendingDraft?.definition??{nodes:[]})],
        [false,prior.draftToken,expected],'Conflict retains exact unsynced Space geometry on this device');
      same([definition(server),server.draftToken],[newer,intervening.body.draftToken],'Competing authoritative graph and token');
      await fitStart();
      await reload.click(opts);
      await reload.waitFor({state:'detached',...opts});
      await offer.waitFor(opts);
      const after=await fitSettle('fit-in-place-reload'), device=await localDraft();
      await quiet(server,1,device,'fit-in-place-reload');
      const trace=await fitTrace('in-place-reload',{conflict,after,device,writes:writes()});
      const input=trace.rows.find(row=>row.type==='click'&&row.action==='Reload server draft'&&row.trusted);
      fitHeld(trace,input,conflict.viewportId,conflict.viewport,'Authoritative in-place reload');
      check(after.viewportId===conflict.viewportId&&after.history.every(([,,ariaDisabled])=>ariaDisabled==='true')&&!after.result,
        'Actual in-place load retains viewport identity and retires abandoned history/result');
      same(fitCoords(after),[['start',[0,0]],['finish',[0,0]]],'Authoritative reload restores server positions');
      same([device?.synced,device?.baseToken,wireToCanonical(device?.definition??{nodes:[]})],
        [true,server.draftToken,newer],'Authoritative reload preserves exact synced server device ownership');
    });
  }

  page.on('pageerror',error=>out.pageErrors.push(String(error)));
  page.on('console',msg=>{if(msg.type()==='error')out.consoleErrors.push(msg.text());});
  page.on('request',request=>{
    const url=new URL(request.url());
    if(url.origin!==origin || !/^\/loops\/[^/]+\/draft$/.test(url.pathname) || request.method()!=='PUT')return;
    const row={method:request.method(),path:url.pathname,url:request.url(),phase,at:Date.now(),
      requestText:request.postData(),requestHeaders:request.headers(),requestSequence:requests.length+1};
    requests.push(row);
    map.set(request,row);
    pending.push(raw('browser-draft-request',row));
  });
  page.on('response',response=>{
    const row=map.get(response.request());
    if(!row)return;
    row.status=response.status();
    pending.push((async()=>{
      try{row.responseText=await response.text();}catch(error){row.responseReadFailure=String(error);}
      row.responseHeaders=response.headers();
      row.responseAt=Date.now();
      await raw('browser-draft-response',row);
    })());
  });
  page.on('requestfailed',request=>{
    const row=map.get(request);
    if(row){
      row.error=request.failure()?.errorText;
      pending.push(raw('browser-draft-failure',row));
    }
  });
  try{
    const local=/^http:\/\/127\.0\.0\.1:\d+$/;
    check(local.test(origin)&&local.test(sink)&&!/:474[78]$/.test(origin)&&!/:474[78]$/.test(sink),'Disposable loopback only','fixture');
    check(Number.isInteger(autosaveMs)&&autosaveMs>0,'Source-bound autosave debounce required','fixture');
    const health=await page.request.get(origin+'/healthz');
    await checkpoint('gateway-health',{status:health.status(),headers:health.headers(),body:await health.text()});
    check(health.ok()&&health.headers()['x-graphgoblin-pid']===param('pid'),'Browser is bound to isolated gateway PID','fixture');
    await page.addInitScript(installProbe,theme);
    if(group==='queued-fit-d1'){
      await page.addInitScript(installQueuedFitTrace);
      await page.route(url=>url.origin!==origin,route=>route.abort());
    }
    await page.route(url=>url.origin===origin && /^\/loops\/[^/]+\/draft$/.test(url.pathname),async route=>{
      const request=route.request();
      const hold=putHold;
      if(hold && !hold.used && request.method()==='PUT' && new URL(request.url()).pathname===path(hold.id)+'/draft'){
        hold.used=true;
        if(hold.mode==='fail-once')return route.fulfill({status:500,contentType:'application/problem+json',
          body:JSON.stringify({type:'about:blank',title:'Disposable test scope',status:500,code:'QA_SCOPED_PUT_FAILURE'})});
        await hold.wait;
      }
      return route.continue();
    });
    if(group==='queued-fit-d1'){await queuedFitGroup();}
    else if(group==='apply-d1'){await applyGroup();await resultLifecycle();}
    else if(group==='gestures-d1'){
      await keyGroup('Enter');
      await keyGroup('Space');
      await keysOnSelection();
      await delayedAndShift();
      await panGroup('Space cards');
      await panGroup('Dismiss suggestion');
    }else if(group==='n768'){
      await sizingGroup();
      await protection();
    }else if(group==='double-r512'){
      await repeatAtFailurePoint();
      await stage('r512-reflow',async()=>{
        const prior=await newFixture('r512-wrap');
        await panelRead('r512-reflow');
        const coord=await point('Dismiss suggestion'),before=await snap(coord);
        await page.mouse.click(...coord);
        await stableResult('r512-reflow-dismiss',before,await snap(coord),[],'Suggestion dismissed.');
        await quiet(prior,0,await localDraft(),'R512 dismissal no side effect');
      });
      await stage('r512-centre-double',()=>repeatedSpace('centre-r512'));
    }else if(group==='touch-d2'){await touchRepeat();}
    else if(group==='outside-d1'){await outsideControls();}
    else if(group==='device-d1'){await deviceGroup();}
    else check(false,'Unexpected bounded matrix group','fixture');
    if(group==='queued-fit-d1')
      check(out.consoleErrors.every(line=>/server responded with a status of 409\b/i.test(line)),'Unexpected browser console error during corrected fit QA');
  }catch(error){
    out.failures??=[];
    if(out.failures.length===0)out.failures.push({phase,kind:error.kind??'unclassified',error:String(error.stack??error)});
  }finally{
    putHold?.release?.();
    const evidence=await Promise.allSettled(pending);
    if(evidence.some(result=>result.status==='rejected')){
      out.failures??=[];
      out.failures.push({phase:'raw-transport',kind:'fixture',errors:evidence.filter(r=>r.status==='rejected').map(r=>String(r.reason))});
    }
    out.failure=out.failures?.[0]??null;
    out.summary={checks:out.checks.length,failed:out.failures?.length??0,writes:requests.length,limits:out.limits};
    await raw('full-result',{...out,requests});
  }
  return JSON.stringify({...out,checks:undefined});
}

