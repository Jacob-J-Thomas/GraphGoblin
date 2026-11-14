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
  async function snapshotNotice(scope) {
    const banner = scope.getByRole('status').filter({hasText:'Renamed work to budget'});
    const report=await banner.count() ? await banner.innerText() : null;
    const actions=await banner.getByRole('button',{name:/NODE_REFERENCE_UNCERTAIN.*node audit/}).all();
    return {banner,report,actions};
  }

  async function preserveRows() {
    const oldId='work', nextId='workNext';
    const outer='operations.1';
    const exactField=outer+'.source';
    // The two adjacent append-message rows deliberately share content. Their open states differ.
    const untouched=template('Identical neighbour marker');
    const oldSource='/counters/nodeVisits/work';
    const newSource='/counters/nodeVisits/'+nextId;
    const fixture=graph('Rename row disclosure',node(oldId,'mutate','Mutate self counters',310,mutates({operations:[
      untouched,{op:'coerce',source:oldSource,jsonSchema:{type:'integer'},target:'/vars/visits',repair:{enabled:false}},untouched,
    ]})));
    fixture.variables={visits:{type:'integer'}};
    const before=await open(fixture);
    const original=clone(before.draft.definition);
    const expected=rewritten(original,oldId,nextId);
    targetNode(expected,nextId).config.operations[1].source=newSource;
    let dialog=await openMutate(oldId);
    await expand(dialog,1);
    await expand(dialog,2);
    const target=field(dialog,exactField).getByLabel('Source',{exact:true});
    const idBox=dialog.getByLabel('Node id',{exact:true});
    same(await target.inputValue(),oldSource,'Fixture has the exact understood self reference');
    const oldField=await target.elementHandle();
    const originalView = await view(dialog);
    const byPath=(state,path)=>state.rows.find((entry)=>entry.path===path);
    const disclosure=(state)=>[0,1,2].map((index)=>byPath(state,'operations.'+index)?.open);
    const identity=(state)=>state.rows.filter(({path})=>path.startsWith('operations.')).map(({id,path})=>[id,path]);
    same(disclosure(originalView),['false','true','true'],'Distinct disclosure ownership before rename');
    check(byPath(originalView,outer)?.id!=null,'Missing Coerce row identity');
    checkpoints.push({label:'before '+rowCommit+' rename',view:originalView,accepted:before});
    await caption('before');
    const accepted=await amend(before,expected,async()=>{
      await idBox.fill(nextId);
      // A real pointer focus transition is required. Clicking via DOM would bypass the bug.
      if(rowCommit==='pointer') await target.click();
      else await idBox.press('Enter');
    },rowCommit+' commits one complete self rename');
    dialog=page.getByRole('dialog',{name:'Edit mutate '+nextId,exact:true});
    await dialog.waitFor(wait);
    const after = await view(dialog);
    const remounted=await oldField.evaluate((el)=>!el.isConnected);
    await oldField.dispose();
    check(remounted,'The repaired form did not remount');
    checkpoints.push({label:rowCommit+' rename readback',view:after,remounted});
    await caption('after-rename');
    const retained=canonical(identity(after))===canonical(identity(originalView));
    const openKept=canonical(disclosure(after))===canonical(disclosure(originalView));
    const exactFocus=after.focused.displayed && (rowCommit==='pointer' ?
      after.focused.field===exactField && after.focused.row===outer && after.focused.value===newSource :
      after.focused.field==='id' && after.focused.value===nextId);
    if (phase==='before') {
      return {finding:!retained && !openKept?'ROW_DISCLOSURE_LOST':null,
        retained,openKept,exactFocus,after};
    }
    same(retained,true,'Self rename must retain operation and nested row identity');
    same(openKept,true,'Self rename must retain open and closed state by row');
    same(exactFocus,true,'Focus stays on the actual nested Source input or keyboard commit input');
    // CodeMirror owns text undo. Use the operation header, a real nontext keyboard target.
    await toggle(dialog,1).focus();
    const undone=await amend(accepted,original,()=>page.keyboard.press('Control+z'),'one graph undo');
    dialog=page.getByRole('dialog',{name:'Edit mutate '+oldId,exact:true});
    await dialog.waitFor(wait);
    const undoView=await view(dialog);
    same(identity(undoView),identity(originalView),'Undo restored the same row identities');
    same(disclosure(undoView),disclosure(originalView),'Undo kept each operation disclosure');
    check(undoView.focused.isToggle && undoView.focused.row===outer && undoView.focused.id===byPath(originalView,outer).id,
      'Undo must keep focus on the same operation header');
    await amend(undone,expected,()=>page.keyboard.press('Control+Shift+z'),'one graph redo');
    dialog=page.getByRole('dialog',{name:'Edit mutate '+nextId,exact:true});
    await dialog.waitFor(wait);
    const redoView=await view(dialog);
    same(identity(redoView),identity(originalView),'Redo restored the same row identities');
    same(disclosure(redoView),disclosure(originalView),'Redo kept each operation disclosure');
    check(redoView.focused.isToggle && redoView.focused.row===outer && redoView.focused.id===byPath(originalView,outer).id,
      'Redo must keep focus on the same operation header');
    same(await field(dialog,exactField).getByLabel('Source',{exact:true}).inputValue(),newSource,
      'Redo restored exact repaired typed pointer');
    equalLocation();
    return {retained,openKept,exactFocus,undoView,redoView};
  }
  function equalLocation() {same(page.url(),origin+'/app/loops/'+id+'/edit','Same editor route');}

  async function warningIdentity() {
    const dynamic='Review counters {{ counters.nodeVisits[vars.key] }}';
    const innocent='Unrelated third operation must never receive focus';
    const fixture=graph('Warning field identity',node('work','mutate','Rename target',300,mutates({operations:[template('Keep source operation')]})),
      node('audit','mutate','Warning owner',600,mutates({operations:[template('Remove preceding operation'),
        template(dynamic),template(innocent)]})));
    fixture.variables={key:{type:'string'}};
    const before=await open(fixture);
    const expected=rewritten(before.draft.definition,'work','budget');
    let editor=await openMutate('work');
    const renamed=await amend(before,expected,async()=>{
      const input=editor.getByLabel('Node id',{exact:true});
      await input.fill('budget');
      await input.press('Enter');
    },'rename while preserving ambiguous Liquid');
    await close(page.getByRole('dialog',{name:'Edit mutate budget',exact:true}));
    const initial=await snapshotNotice(page);
    check(initial.report?.includes('NODE_REFERENCE_UNCERTAIN'),'Fixture needs real ambiguous reference warning');
    same(initial.actions.length,1,'One actual source action before collection change');
    check((await initial.actions[0].innerText()).includes('config.operations.1.content'),'Actual warning initially points to old index one');
    let owner;
    await noWrite(async()=>{
      await initial.actions[0].click();
      owner=page.getByRole('dialog',{name:'Edit mutate audit',exact:true});
      await owner.waitFor(wait);
      await content(owner,'operations.1.content').waitFor(wait);
      const focus=(await view(owner)).focused;
      same(focus.field,'operations.1.content','Initially direct focus follows the expected field');
      same(focus.text,dynamic,'Initially the warning opens the exact ambiguous text');
    },renamed,'Original warning focus action');
    const previousRows=await view(owner);
    const afterDeletion=clone(expected);
    targetNode(afterDeletion,'audit').config.operations.shift();
    const changed=await amend(renamed,afterDeletion,()=>owner.getByRole('button',{name:'Remove operations 1',exact:true}).click(),
      'Remove operation preceding historical warning');
    const movedRows=await view(owner);
    const rowId=(state,path)=>state.rows.find((record)=>record.path===path)?.id;
    same(rowId(movedRows,'operations.0'),rowId(previousRows,'operations.1'),'The genuine collection move retained original row ID');
    same(rowId(movedRows,'operations.1'),rowId(previousRows,'operations.2'),'Old innocent row occupies the historical path');
    const stale=await snapshotNotice(owner);
    let focused;
    await noWrite(async()=>{
      if(stale.actions.length) {
        same(stale.actions.length,1,'Ambiguous warning has at most one navigation action');
        if(await stale.actions[0].isEnabled()) {
          await stale.actions[0].click();
          focused=(await view(owner)).focused;
        }
      }
      await caption('after-index-shift');
    },changed,'Renaming warning after collection edit');
    if (phase==='before') {
      return {finding:focused?.field==='operations.1.content' && focused?.text===innocent?'STALE_WARNING_FOCUSES_OTHER_ROW':null,
        notice:stale.report,focused,previousRows,movedRows};
    }
    if(focused) {
      same(focused.field,'operations.0.content','Live warning action follows the original field to its current path');
      same(focused.text,dynamic,'Live warning action may not focus innocent neighboring text');
    } else {
      check(stale.report?.includes('NODE_REFERENCE_UNCERTAIN'),'Do not silently lose the historical uncertainty');
      check(/revalidate|changed|review manually|no longer|check (?:the|current)|may have moved/i.test(stale.report),
        'An informational or disabled historical row must explain how to review current content safely');
    }
    equalLocation();
    return {route:focused?'tracked original row':'explicit historical guidance',notice:stale.report,focused,previousRows,movedRows};
  }

  async function preserveCoincidingJson() {
    const text='Held visits {{ counters.nodeVisits.work }}';
    const repairedText='Held visits {{ counters.nodeVisits.draft }}';
    const fixture=graph('Coincident JSON and atomic history',node('work','inference','Edit inference without running it',310,
      {prompt:{template:'Fixture never runs'},input:[template(text)]}));
    const original=await open(fixture);
    let dialog=await openNode('work','inference');
    await dialog.getByRole('tab',{name:/^Context\b/}).click();
    await dialog.getByRole('button',{name:'Edit as JSON: Input',exact:true}).click();
    const json=(scope)=>scope.getByRole('textbox',{name:'Input JSON',exact:true});
    const section=(scope)=>scope.locator('[data-json-section="input"]');
    const pending=(scope)=>section(scope).getByText('Choose Apply JSON or Cancel JSON to finish this edit.',{exact:true});
    const expected=rewritten(original.draft.definition,'work','draft');
    const parsed=targetNode(expected,'draft').config.input;
    parsed[0].content=repairedText;
    const unsavedText=JSON.stringify(parsed,null,4);
    await noWrite(async()=>{
      await json(dialog).click();
      await page.keyboard.press('Control+a');
      await page.keyboard.insertText(unsavedText);
      await pending(dialog).waitFor(wait);
      check(await section(dialog).getByRole('button',{name:'Apply JSON',exact:true}).isEnabled(),'Held candidate must be valid JSON');
    },original,'Author valid JSON without applying');
    const beforeText=await json(dialog).textContent();
    same(JSON.parse(beforeText),parsed,'Held valid JSON must coincide only with the future repaired config');
    await caption('held-json-before');
    const accepted=await amend(original,expected,async()=>{
      const input=dialog.getByLabel('Node id',{exact:true});
      await input.fill('draft');
      await input.press('Enter');
    },'Rename applies only accepted reference repair');
    dialog=page.getByRole('dialog',{name:'Edit inference draft',exact:true});
    await dialog.waitFor(wait);
    const after={
      pending:await pending(dialog).isVisible(),
      buffer:await json(dialog).isVisible() ? await json(dialog).textContent() : null,
      signifiers:await section(dialog).innerText(),
    };
    checkpoints.push({label:'After rename, before any explicit JSON action',after,sameBuffer:after.buffer===beforeText});
    await caption('held-json-after-rename');
    if (phase==='corrected') {
      same(after.pending,true,'Equality after an incidental remount cannot resolve held input');
      same(after.buffer,beforeText,'Exact held JSON bytes remain available after rename');
    }
    // A real button is a non-text undo target, so this exercises editor history, not CodeMirror.
    const historyKey = async (shortcut)=>{
      await dialog.getByRole('button',{name:'Done',exact:true}).focus();
      await page.keyboard.press(shortcut);
    };
    if (phase==='before') {
      const count=writes.length;
      await historyKey('Control+z');
      await sleep(1250);
      const afterFirstUndo=await detail();
      const stillRenamed=Boolean(targetNode(afterFirstUndo.draft.definition,'draft'));
      checkpoints.push({label:'One actual editor Undo from renamed state',
        stillRenamed,putCount:writes.length-count,afterFirstUndo});
      await caption('first-undo');
      return {finding:!after.pending && stillRenamed?'EQUALITY_CLEARS_HELD_JSON_AND_ADDS_HISTORY':null,
        after,afterFirstUndo,stillRenamed,putCount:writes.length-count};
    }
    const undone=await amend(accepted,original.draft.definition,()=>historyKey('Control+z'),'One Undo is the whole rename');
    dialog=page.getByRole('dialog',{name:'Edit inference work',exact:true});
    await dialog.waitFor(wait);
    await pending(dialog).waitFor(wait);
    same(await json(dialog).textContent(),beforeText,'Undo keeps separately authored valid JSON bytes');
    await amend(undone,expected,()=>historyKey('Control+Shift+z'),'One Redo restores the whole rename');
    dialog=page.getByRole('dialog',{name:'Edit inference draft',exact:true});
    await dialog.waitFor(wait);
    await pending(dialog).waitFor(wait);
    same(await json(dialog).textContent(),beforeText,'Redo keeps the same valid held JSON and its explicit Apply/Cancel state');
    await caption('held-json-after-redo');
    equalLocation();
    return {pending:after.pending,sameBuffer:true,noApplyOrCancel:true,atomicUndoRedo:true};
  }

  try {
    check(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) && !/:474[78]$/.test(origin),'Refused owner or nonfixture origin');
    check(['before','corrected'].includes(phase),'Specify exact admissible frozen phase');
    check(['rows','warning','held-json'].includes(scenario),'Specify one bounded scenario');
    check(['pointer','enter'].includes(rowCommit),'Select the native rename commitment method');
    check(/^\/app\/assets\/index-[\w-]+\.js$/.test(bundle??'') && /^[1-9]\d*$/.test(pid??''),
      'Pass the independently bound entry and owned gateway PID');
    const health=await page.request.get(origin+'/healthz',{timeout:5000});
    same(health.status(),200,'Disposable gateway readiness');
    same(health.headers()['x-graphgoblin-pid'],pid,'Refused foreign gateway');
    active=scenario;
    outcome=await ({rows:preserveRows,warning:warningIdentity,'held-json':preserveCoincidingJson}[scenario]());
    check(bundles.includes(200),'Renderer did not load the bound entry bundle');
    same(pageErrors,[],'Uncaught browser errors');
  } catch (error) {
    failure={active,message:String(error),stack:error.stack};
    if (['before','corrected'].includes(phase) && ['rows','warning','held-json'].includes(scenario)) {
      await caption('first-failure').catch(()=>{});
    }
  }
  return {origin,suite:'273-review-correction-native-prepared',phase,scenario,rowCommit,bundles,outcome,
    writes,checkpoints,pageErrors,failure};
}
