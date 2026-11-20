async page=>{
 const cfg=__CONFIG__,readback=(__READBACK__),observations=[],checks=[],requests=[];
 const responseListener=response=>{const u=new URL(response.url());requests.push({origin:u.origin,path:u.pathname.replaceAll(cfg.id,'<disposable-loop-id>'),method:response.request().method(),status:response.status()});};page.on('response',responseListener);
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const check=(label,passed)=>{checks.push({label,passed});if(!passed)throw new Error('Behavior assertion failed: '+label);};
 const durable=async expected=>page.waitForFunction(async expected=>{
  const id=location.pathname.split('/')[3],value=await new Promise(resolve=>{const open=indexedDB.open('graphgoblin',2);open.onsuccess=()=>{const db=open.result,r=db.transaction('drafts','readonly').objectStore('drafts').get(id);r.onsuccess=()=>{db.close();resolve(r.result);};};});
  return value?.synced===false&&Object.hasOwn(value,'decisionRoutes')&&Array.isArray(value.decisionRoutes?.pick?.rows)&&value.decisionRoutes.pick.rows.length===3&&JSON.stringify(value.definition.nodes.map(n=>n.id))===JSON.stringify(expected.nodeIds)&&JSON.stringify(value.definition.nodes.find(n=>n.id==='pick').config.routes.map(r=>r.id))===JSON.stringify(expected.routeIds)&&(!expected.description||value.definition.description===expected.description)&&(!expected.definition||JSON.stringify(value.definition)===JSON.stringify(expected.definition));
 },expected,{timeout:15000});
 const capture=async(phase,expected)=>{if(expected)await durable(expected);const value=await readback(page);observations.push({phase,...value});return value;};
 const spec=definition=>({nodeIds:definition.nodes.map(n=>n.id),routeIds:definition.nodes.find(n=>n.id==='pick').config.routes.map(r=>r.id),description:definition.description,definition});
 let before,after,beforeMap,environment;
 try{
  await page.context().setOffline(false);await page.goto(cfg.url);await page.getByRole('heading',{name:cfg.name,exact:true}).waitFor({state:'visible'});await page.evaluate(async()=>{await navigator.serviceWorker.ready;});environment=await page.evaluate(()=>({userAgent:navigator.userAgent,origin:location.origin,viewport:{width:innerWidth,height:innerHeight}}));await capture('server-original');
  if(cfg.kind==='restore'){
   await page.goto(new URL(cfg.url).origin+'/app/loops',{waitUntil:'domcontentloaded'});
   const receipt=await page.evaluate(async input=>{
    const response=await fetch('/loops/'+input.id,{headers:{authorization:'Bearer '+localStorage.getItem('graphgoblin-api-key')}}),server=await response.json();if(response.status!==200||typeof server.draftToken!=='string')throw new Error('Missing actual server base');
    const definition=structuredClone(input.definition);definition.name=input.name;
    const value={loopId:input.id,definition,decisionRoutes:structuredClone(input.decisionRoutes),savedAt:new Date().toISOString(),synced:false,baseToken:server.draftToken};
    await new Promise((resolve,reject)=>{const open=indexedDB.open('graphgoblin',2);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(value,input.id);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};};});
    return{boundary:'Authorized current-format IndexedDB restoration outside mounted editor. No product/store function replacement.',ownMetadataPresent:Object.hasOwn(value,'decisionRoutes'),decisionRoutes:value.decisionRoutes,definition:value.definition,baseMatchesActualServer:true};
   },cfg);observations.push({phase:'restoration-fixture',...receipt});
   await page.goto(cfg.url,{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:cfg.name,exact:true}).waitFor({state:'visible'});await page.getByText('Restored unsaved changes from this device',{exact:false}).waitFor({state:'visible',timeout:15000});await capture('restored-collision');
   await page.context().setOffline(true);await page.getByTestId('rf__node-pick').dblclick();const dialog=page.getByRole('dialog',{name:'Edit decision pick',exact:true});await dialog.waitFor({state:'visible'});const second=dialog.getByRole('group',{name:'Routes 2',exact:true}).getByRole('textbox',{name:'Id',exact:true});check('captured second row restored as yes',await second.inputValue()==='yes');await second.fill('affirm');
   const repaired=await capture('repaired-before-structural-operation',{nodeIds:['start','pick','done','other'],routeIds:['yes','affirm','maybe']});check('repair leaves all physical records and geometry untouched',same(repaired.device.definition.edges,cfg.definition.edges));await dialog.getByRole('button',{name:'Done',exact:true}).click();
  }else await page.context().setOffline(true);
  if(cfg.kind==='description'){
   // This control also creates a positively present device map through normal public typing.
   await page.getByRole('textbox',{name:'Description',exact:true}).fill('Unrelated topology QA description');
   before=observations[0].server.definition;after=structuredClone(before);after.description='Unrelated topology QA description';
  }else{
   if(cfg.kind!=='restore'){
    // A harmless label edit then Undo seeds a durable map without changing physical records.
    await page.getByTestId('rf__node-pick').dblclick();const d=page.getByRole('dialog',{name:'Edit decision pick',exact:true});const labelDef=structuredClone(observations[0].server.definition);labelDef.nodes.find(n=>n.id==='pick').label='Pick QA';await d.getByRole('textbox',{name:'Label',exact:true}).fill('Pick QA');await capture('map-materialized',spec(labelDef));await d.getByRole('button',{name:'Done',exact:true}).click();await page.getByRole('button',{name:/^Undo(?: |$)/}).click();await capture('map-after-label-undo',spec(observations[0].server.definition));
   }
   const ready=await capture('before-structural-operation');before=structuredClone(ready.device.definition);beforeMap=structuredClone(ready.device.decisionRoutes);after=structuredClone(before);
   await page.getByTestId('rf__node-done').dblclick();const dialog=page.getByRole('dialog',{name:'Edit exit done',exact:true});await dialog.waitFor({state:'visible'});
   if(cfg.kind==='rename'){
    const id=dialog.getByRole('textbox',{name:'Node id',exact:true});await id.fill('completed');await id.press('Enter');after.nodes=after.nodes.map(n=>n.id==='done'?{...n,id:'completed'}:n);after.edges=after.edges.map(e=>({...e,from:e.from.node==='done'?{...e.from,node:'completed'}:e.from,to:e.to.node==='done'?{...e.to,node:'completed'}:e.to}));await page.getByRole('dialog',{name:'Edit exit completed',exact:true}).getByRole('button',{name:'Done',exact:true}).click();
   }else{await dialog.getByRole('button',{name:'Delete node',exact:true}).click();after.nodes=after.nodes.filter(n=>n.id!=='done');after.edges=after.edges.filter(e=>e.from.node!=='done'&&e.to.node!=='done');}
  }
  let changed=await capture('changed',spec(after));check('exact intended definition and ordered physical records',same(changed.device.definition,after));
  const rows=changed.device.decisionRoutes.pick.rows;
  if(!['rename','description'].includes(cfg.kind)){check('deleted yes and maybe ownership is empty',same(rows[0].edgeIds,[])&&same(rows[2].edgeIds,[]));check('separate survivor ownership remains correct',same(rows[1].edgeIds,cfg.kind==='owned'?['e1']:[]));}
  await page.screenshot({path:cfg.image,fullPage:true});
  await page.getByRole('button',{name:/^Undo(?: |$)/}).click();const undone=await capture('undo',spec(before));check('Undo restores exact full definition',same(undone.device.definition,before));if(beforeMap)check('Undo restores positively present exact ownership',same(undone.device.decisionRoutes,beforeMap));
  await page.getByRole('button',{name:/^Redo(?: |$)/}).click();const redone=await capture('redo',spec(after));check('Redo restores exact full definition and ownership',same(redone.device.definition,after)&&same(redone.device.decisionRoutes,changed.device.decisionRoutes));
  await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:cfg.name,exact:true}).waitFor({state:'visible'});await page.getByText('Restored unsaved changes from this device',{exact:false}).waitFor({state:'visible',timeout:15000});const local=await capture('offline-device-reloaded',spec(after));check('offline reload preserves exact definition and present ownership',same(local.device.definition,after)&&same(local.device.decisionRoutes,changed.device.decisionRoutes));
  await page.context().setOffline(false);await page.getByText('All changes saved',{exact:true}).waitFor({state:'visible',timeout:30000});const saved=await capture('saved');check('API saved exact intended definition',saved.server.status===200&&same(saved.server.definition,after));
  await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:cfg.name,exact:true}).waitFor({state:'visible'});const reloaded=await capture('server-reloaded');check('server reload preserves exact intended definition',reloaded.server.status===200&&same(reloaded.server.definition,after));
  return{status:'complete',case:cfg.key,checks,observations,requests,environment};
 }catch(error){try{await capture('error-state');}catch{}return{status:'automation-error',case:cfg.key,error:String(error),checks,observations,requests,environment,expectedBefore:before,expectedAfter:after};}finally{page.off('response',responseListener);await page.context().setOffline(false);}
}
