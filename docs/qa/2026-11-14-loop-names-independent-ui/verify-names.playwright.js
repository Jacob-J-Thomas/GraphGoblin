async (page) => {
  const origin = new URL(page.url()).origin;
  const outcomes = [], writes = [], pageErrors = [];
  const suffix = crypto.randomUUID().slice(0, 6);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const canonical = (value) => JSON.stringify(value, (_, item) =>
    item && typeof item==='object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key,item[key]]))
      : item);
  const equal = (a,b,message) => assert(canonical(a)===canonical(b),
    message + ' expected ' + canonical(b) + ', actual ' + canonical(a));
  const normal = (value) => value.trim().replace(/\s+/gu,' ').toLowerCase();
  const alternativeCase = (name) => ' ' + name.toUpperCase().replaceAll(' ','\u00a0  ') + ' ';
  const graph = ({name,...definition}) => definition;
  const pathFor = (id) => '/loops/'+id;
  const listing = '/app/loops';
  const bind = (target, who) => {
    target.on('pageerror', (error) => pageErrors.push({who,error:String(error)}));
    target.on('request', (request) => {
      const url=new URL(request.url());
      if (['POST','PUT'].includes(request.method()) &&
          /^\/(?:loops(?:$|\/import$|\/[^/]+\/draft$)|templates\/[^/]+\/draft$)/.test(url.pathname))
        writes.push({who,method:request.method(),path:url.pathname,query:url.search,body:request.postDataJSON(),
          ifMatch:request.headers()['if-match']??null});
    });
  };
  bind(page,'primary');
  let active='setup', second;
  const focus = async (el) => {
    await el.waitFor();
    const id = await el.getAttribute('id');
    if(id) await page.waitForFunction((expected)=>document.activeElement?.id===expected,id);
    else assert(await el.evaluate(e=>document.activeElement===e),'Control not focused');
  };
  async function api(method,path,data,expected=200,headers={}) {
    const reply=await page.request.fetch(origin+path,{method,headers,...(data===undefined?{}:{data})});
    const raw=await reply.text();
    assert(reply.status()===expected,method+' '+path+' returned '+reply.status()+' '+raw);
    return JSON.parse(raw);
  }
  const loops=async()=> (await api('GET','/loops')).items;
  const detail=(id)=>api('GET',pathFor(id));
  const ids=async()=> (await loops()).map(x=>x.id).sort();
  const awaitResponse=(target,method,path)=>target.waitForResponse(reply=>
    reply.request().method()===method&&new URL(reply.url()).pathname===path);
  async function reply(promise,status,code){
    const response=await promise;
    const body=await response.json();
    equal(response.status(),status,'Expected response status');
    if(code) equal(body.code,code,'Expected response code');
    return {body, data:response.request().postDataJSON(),headers:response.request().headers(),
      query:Object.fromEntries(new URL(response.url()).searchParams.entries()),status};
  }
  function definition(name,description='Original QA description') {
    return {schemaVersion:4,name,description,
      nodes:[{id:'begin',kind:'trigger',label:'Begin',config:{type:'manual'}},
        {id:'exit',kind:'exit',label:'Exit',config:{returns:'"fixture"'}}],
      edges:[{id:'go',from:{node:'begin',port:'out'},to:{node:'exit'}}]};
  }
  async function deviceHasDraft(target, loopId, name, description) {
    return target.waitForFunction(async ({loopId,name,description})=>{
      const readback=await new Promise((done)=>{
        const opened=indexedDB.open('graphgoblin');
        opened.onupgradeneeded=()=>opened.transaction.abort();
        opened.onerror=()=>done(undefined);
        opened.onsuccess=()=>{
          const db=opened.result;
          try {
            const request=db.transaction('drafts').objectStore('drafts').get(loopId);
            request.onsuccess=()=>{db.close();done(request.result);};
            request.onerror=()=>{db.close();done(undefined);};
          } catch {db.close();done(undefined);}
        };
      });
      return readback?.definition?.name===name&&readback?.definition?.description===description;
    }, {loopId,name,description});
  }
  const create=(name,description)=>api('POST','/loops',{definition:definition(name,description)},201);
  const noOverflow=async()=>{
    const size=await page.evaluate(()=>({viewport:innerWidth,content:document.documentElement.scrollWidth}));
    assert(size.content<=size.viewport,'Horizontal overflow '+canonical(size));
    return size;
  };
  async function openEditor(target,id) {
    await target.bringToFront();
    await target.goto(origin+'/app/loops/'+id+'/edit');
    const notice=target.getByText('The editor is available. Checking the server and this device before saving changes.',{exact:true});
    await notice.waitFor({state:'hidden'});
    const reveal=target.getByRole('button',{name:'Show loop settings',exact:true});
    await target.getByRole('button',{name:/^(Show|Hide) loop settings$/}).waitFor();
    if(await reveal.isVisible()) await reveal.click();
    await target.getByRole('textbox',{name:'Name',exact:true}).waitFor();
    await notice.waitFor({state:'hidden'});
  }
  const nameNotice=(target)=>target.getByRole('status').filter({hasText:'Another loop already has this name'});
  const uiName=(target)=>target.getByRole('textbox',{name:'Name',exact:true});
  const uiDesc=(target)=>target.getByRole('textbox',{name:'Description',exact:true});
  try {
    assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)&&!/:474[78]$/.test(origin),'Unexpected origin');
    active='create collision and deliberate suggestion';
    const originalName='Écho board '+suffix;
    const {loop:original}=await create(originalName);
    const originalBefore=await detail(original.id);
    await page.goto(origin+listing);
    const name=page.getByRole('textbox',{name:'New loop name',exact:true});
    const createButton=page.getByRole('button',{name:'Create',exact:true});
    await name.fill(alternativeCase(original.name));
    const createDenied=awaitResponse(page,'POST','/loops');
    await createButton.click();
    const conflict=await reply(createDenied,409,'LOOP_NAME_CONFLICT');
    const advisory=page.getByRole('button',{name:'Use “'+conflict.body.suggestedName+'”',exact:true});
    await advisory.waitFor();
    const deniedCount=writes.length;
    await advisory.click();
    await focus(name);
    equal(writes.length,deniedCount,'Create suggestion must not send another POST');
    equal(await name.inputValue(),conflict.body.suggestedName,'Suggested create text');
    equal(await detail(original.id),originalBefore,'Original after create refusal');
    const newName=conflict.body.suggestedName+' chosen';
    await name.fill(newName);
    const createAccepted=awaitResponse(page,'POST','/loops');
    await name.press('Enter');
    const newOne=await reply(createAccepted,201);
    assert(newOne.body.loop.id!==original.id,'Create did not produce a distinct ID');
    equal((await detail(newOne.body.loop.id)).loop.name,newName,'Explicit create name');
    outcomes.push({active,conflict:conflict.body,selected:newName,originalId:original.id,newId:newOne.body.loop.id});

    active='import advisory race and unchanged retry bytes at narrow width';
    await page.setViewportSize({width:390,height:900});
    await page.goto(origin+listing);
    const exported=await api('GET',pathFor(original.id)+'/export?draft=true');
    const originalExport=canonical(exported);
    const picker=page.getByLabel('Import an exported loop (JSON)');
    const importPath='/loops/import';
    const importDenied=awaitResponse(page,'POST',importPath);
    const before=await ids();
    await picker.setInputFiles({name:'qa-retained.graphgoblin.json',mimeType:'application/json',
      buffer:Buffer.from(JSON.stringify(exported))});
    const refused=await reply(importDenied,409,'LOOP_NAME_CONFLICT');
    const panel=page.getByRole('region',{name:'Import under another name',exact:true});
    const importName=panel.getByRole('textbox',{name:'Name for the imported loop',exact:true});
    await focus(importName);
    equal(await importName.inputValue(),refused.body.suggestedName,'UI offered original import suggestion');
    equal(await ids(),before,'Import refusal did not create a loop');
    // Independent fixture API client claims the advisory name before the browser retries it.
    const occupied=(await create(refused.body.suggestedName)).loop;
    const stale=awaitResponse(page,'POST',importPath);
    await panel.getByRole('button',{name:'Import as new loop',exact:true}).click();
    const raced=await reply(stale,409,'LOOP_NAME_CONFLICT');
    equal(canonical(raced.data),originalExport,'Refused retry kept original export JSON');
    equal(raced.query,{name:refused.body.suggestedName},'Original retry name query');
    const updated=panel.getByRole('button',{name:'Use “'+raced.body.suggestedName+'”',exact:true});
    await updated.waitFor();
    assert((await panel.innerText()).includes('qa-retained.graphgoblin.json'),'Uploaded filename disappeared');
    const layout=await noOverflow();
    await updated.scrollIntoViewIfNeeded();
    await page.screenshot({path:'import-stale-advisory-narrow.png',animations:'disabled'});
    const beforeSuggestion=writes.length;
    await updated.click();
    await focus(importName);
    equal(writes.length,beforeSuggestion,'Suggestion alone must not import');
    const recovered=awaitResponse(page,'POST',importPath);
    await importName.press('Enter');
    const imported=await reply(recovered,201);
    equal(imported.query,{name:raced.body.suggestedName},'Refreshed retry name query');
    equal(canonical(imported.data),originalExport,'Successful retry kept original export JSON');
    equal(graph((await detail(imported.body.loop.id)).draft.definition),graph(exported.loop),'Imported graph parity');
    assert(imported.body.loop.id!==occupied.id&&imported.body.loop.id!==original.id,'Import IDs collided');
    equal(await detail(original.id),originalBefore,'Original after all import steps');
    outcomes.push({active,initial:refused.body.suggestedName,occupiedId:occupied.id,retry:raced,
      recovered:imported,layout});

    active='template cancellation and explicit named copy';
    const templatePath='/templates/starter/draft';
    const firstTemplate=await api('POST',templatePath,{},201);
    const templateBefore=await detail(firstTemplate.loop.id);
    const manifestBefore=await api('GET','/templates/starter');
    await page.goto(origin+listing);
    await page.getByRole('button',{name:'New from template',exact:true}).click();
    const card=page.getByRole('region',{name:'Starter assistant',exact:true});
    const use=card.getByRole('button',{name:'Use Starter assistant',exact:true});
    const firstIds=await ids();
    const deniedTemplate=awaitResponse(page,'POST',templatePath);
    await use.click();
    const noCopy=await reply(deniedTemplate,409,'LOOP_NAME_CONFLICT');
    const copyName=card.getByRole('textbox',{name:'Name for the new draft',exact:true});
    await focus(copyName);
    equal(await copyName.inputValue(),noCopy.body.suggestedName,'Template suggestion');
    await card.getByRole('button',{name:'Cancel',exact:true}).click();
    await use.waitFor();
    assert(await use.evaluate(el=>document.activeElement===el),'Template cancellation lost focus');
    equal(await ids(),firstIds,'Cancelled template created a loop');
    const deniedAgain=awaitResponse(page,'POST',templatePath);
    await use.press('Enter');
    await reply(deniedAgain,409,'LOOP_NAME_CONFLICT');
    const customName='Explicit starter '+suffix;
    await copyName.fill(customName);
    const copiedResp=awaitResponse(page,'POST',templatePath);
    await card.getByRole('button',{name:'Create draft',exact:true}).click();
    const copied=await reply(copiedResp,201);
    equal(copied.data,{name:customName},'Template explicit copy request');
    assert(copied.body.loop.id!==firstTemplate.loop.id,'Template reused original ID');
    equal(graph((await detail(copied.body.loop.id)).draft.definition),graph(templateBefore.draft.definition),'Template graph parity');
    equal(await detail(firstTemplate.loop.id),templateBefore,'Original template copy preserved');
    equal(await api('GET','/templates/starter'),manifestBefore,'Template catalog preserved');
    outcomes.push({active,firstTemplateId:firstTemplate.loop.id,copiedId:copied.body.loop.id,cancelKeptIds:true});

    active='rename refusal, companion edit and retry';
    await page.setViewportSize({width:1280,height:900});
    const target=(await create('Target rename '+suffix)).loop;
    const targetBefore=await detail(target.id);
    await openEditor(page,target.id);
    const draft=pathFor(target.id)+'/draft';
    const deniedRename=awaitResponse(page,'PUT',draft);
    await uiName(page).fill(alternativeCase(original.name));
    const nameCollision=await reply(deniedRename,409,'LOOP_NAME_CONFLICT');
    const notice=nameNotice(page);
    await notice.waitFor();
    equal(await page.getByTestId('save-state').innerText(),'Not saved: name in use','Name conflict status');
    const initialAttempts=writes.filter(x=>x.path===draft).length;
    const companion='Keep this unrelated local description '+suffix;
    await uiDesc(page).fill(companion);
    await notice.getByText(/kept on this device/).waitFor();
    await deviceHasDraft(page,target.id,alternativeCase(original.name),companion);
    equal(writes.filter(x=>x.path===draft).length,initialAttempts,'Blocked rename let companion edit send a request');
    equal(await detail(target.id),targetBefore,'Server preserved target after collision');
    await page.goto(origin+listing);
    equal(writes.filter(x=>x.path===draft).length,initialAttempts,'Navigation flushed a refused name');
    equal(await detail(target.id),targetBefore,'Server preserved target across navigation');
    const refusedOnReopen=awaitResponse(page,'PUT',draft);
    await openEditor(page,target.id);
    await reply(refusedOnReopen,409,'LOOP_NAME_CONFLICT');
    await notice.waitFor();
    equal(await uiName(page).inputValue(),alternativeCase(original.name),'Reopened device name');
    equal(await uiDesc(page).inputValue(),companion,'Reopened companion edit');
    const newNameForOriginal='Released '+suffix;
    await api('PUT',pathFor(original.id)+'/draft',{definition:{...originalBefore.draft.definition,name:newNameForOriginal}},200,
      {'if-match':'"'+originalBefore.draftToken+'"'});
    const retry=awaitResponse(page,'PUT',draft);
    await notice.getByRole('button',{name:'Try again',exact:true}).click();
    const accepted=await reply(retry,200);
    equal(accepted.data.definition.description,companion,'Explicit retry kept companion edit');
    equal(accepted.body.draft.id,targetBefore.draft.id,'Explicit retry retained draft identity');
    assert(accepted.body.draftToken!==targetBefore.draftToken,'Accepted rename did not advance token');
    equal((await detail(target.id)).draft.definition.description,companion,'Persisted companion edit');
    outcomes.push({active,nameCollision:nameCollision.body,attemptsBeforeNavigation:initialAttempts,
      recoveredDeviceDescription:companion,accepted});

    active='stale token takes precedence over equivalent name';
    const source=(await create('Independent tab '+suffix)).loop;
    const beforeStale=await detail(source.id);
    await openEditor(page,source.id);
    second=await page.context().newPage();
    bind(second,'second tab');
    await openEditor(second,source.id);
    const stalePath=pathFor(source.id)+'/draft';
    const committed=awaitResponse(second,'PUT',stalePath);
    await uiDesc(second).fill('fresh second-tab '+suffix);
    const fromSecond=await reply(committed,200);
    const stableAfterSecond=await detail(source.id);
    await page.bringToFront();
    const staleRename=awaitResponse(page,'PUT',stalePath);
    await uiName(page).fill(alternativeCase(occupied.name));
    const staleConflict=await reply(staleRename,409,'DRAFT_CONFLICT');
    equal(staleConflict.headers['if-match'],'"'+beforeStale.draftToken+'"','Stale browser sent observed old token');
    equal(staleConflict.body.draftToken,fromSecond.body.draftToken,'Stale refusal returned fresh token');
    await page.getByText('The draft changed on the server',{exact:false}).waitFor();
    equal(await nameNotice(page).count(),0,'Name notice improperly replaced stale-draft guidance');
    const confirmed=awaitResponse(page,'PUT',stalePath);
    await page.getByRole('button',{name:'Overwrite with this copy',exact:true}).click();
    const nextNameRefusal=await reply(confirmed,409,'LOOP_NAME_CONFLICT');
    equal(nextNameRefusal.headers['if-match'],'"'+fromSecond.body.draftToken+'"','Overwrite used exactly fresh token');
    await nameNotice(page).waitFor();
    equal(await detail(source.id),stableAfterSecond,'Fresh server draft preserved after both refusals');
    await nameNotice(page).scrollIntoViewIfNeeded();
    await page.screenshot({path:'distinct-name-conflict-desktop.png',animations:'disabled'});
    outcomes.push({active,staleConflict,followupNameConflict:nextNameRefusal});

    active='two browser writes collide before server admission';
    const raceName='Paired race '+suffix;
    const racers=[page,second];
    const barrier=[];
    let release;
    const gate=new Promise(resolve=>{release=resolve;});
    // Intercept only this fixture's two ordinary creates and release them together to Fastify.
    for (const target of racers) {
      await target.route(origin+'/loops',async route=>{
        const request=route.request();
        if(request.method()==='POST'&&normal(request.postDataJSON().definition.name)===normal(raceName)){
          barrier.push(request.postDataJSON());
          if(barrier.length===2)release();
          await gate;
        }
        await route.continue();
      });
      await target.goto(origin+listing);
      await target.getByRole('textbox',{name:'New loop name',exact:true}).fill(
        target===page?raceName:alternativeCase(raceName));
    }
    const pendingReplies=racers.map(target=>awaitResponse(target,'POST','/loops'));
    for(const target of racers){
      await target.bringToFront();
      await target.getByRole('button',{name:'Create',exact:true}).click();
    }
    const browserResults=await Promise.all(pendingReplies.map(async pending=>{
      const r=await pending;
      return {status:r.status(),body:await r.json(),request:r.request().postDataJSON()};
    }));
    equal(barrier.length,2,'Exactly two held browser requests');
    equal(browserResults.map(x=>x.status).sort(),[201,409],'Concurrent outcomes');
    const losing=browserResults.findIndex(x=>x.status===409);
    equal(browserResults[losing].body.code,'LOOP_NAME_CONFLICT','Concurrent loser guidance');
    await racers[losing].getByRole('button',{name:'Use “'+browserResults[losing].body.suggestedName+'”',exact:true}).waitFor();
    const current=(await loops()).filter(x=>normal(x.name)===normal(raceName));
    equal(current.length,1,'Exactly one committed equivalent name');
    equal(current[0].id,browserResults[1-losing].body.loop.id,'Winner ID matches list');
    outcomes.push({active,barrier,browserResults,winner:current[0]});
    equal(pageErrors,[],'Browser page errors');
    return {origin,browser:await page.evaluate(()=>navigator.userAgent),outcomes,writes,pageErrors,failure:null};
  } catch(error) {
    await page.screenshot({path:'first-failure.png',animations:'disabled'}).catch(()=>undefined);
    return {origin,outcomes,writes,pageErrors,failure:{active,message:String(error),stack:error.stack}};
  } finally { await second?.close(); }
}
