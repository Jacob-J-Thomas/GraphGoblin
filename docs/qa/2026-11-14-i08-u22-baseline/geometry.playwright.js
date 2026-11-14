async (page) => {
 const fixtures={"server":"01M7CAMGDAGGXF01ECFKFM6J71","device-first":"01M7CAMGDT2Q5B5F5WE9P5QD18"};
 const origin=new URL(page.url()).origin;
 const output=[];
 const path=(id)=>page.locator('.react-flow__edge[data-id="'+id+'"] .react-flow__edge-path');
 const edge=(id)=>page.locator('.react-flow__edge[data-id="'+id+'"]');
 const segment=(id,i)=>page.locator('.react-flow__edge[data-id="'+id+'"] .gg-route-handle[data-segment="'+i+'"]');
 async function settle() {
  await page.evaluate(()=>document.fonts.ready);
  await page.getByRole('button',{name:'Fit view'}).click();
  await page.locator('.react-flow__viewport').evaluate(async (e)=>{
   let last=e.getAttribute('style'),at=performance.now();
   await new Promise(resolve=>{const frame=()=>{const curr=e.getAttribute('style');if(curr!==last){last=curr;at=performance.now();}if(performance.now()-at>240)resolve();else requestAnimationFrame(frame);};requestAnimationFrame(frame);});
  });
 }
 async function start(id){
  await page.goto(origin+'/app/loops/'+id+'/edit');
  await page.getByTestId('node-side').waitFor({timeout:10000});
  for(const name of ['Hide palette','Hide loop settings']){
   const button=page.getByRole('button',{name,exact:true});
   if(await button.count()&&await button.isVisible())await button.click();
  }
  await settle();
 }
 async function drag(locator,dx,dy){
  const b=await locator.boundingBox();
  if(!b)throw Error('No pointer target');
  const x=b.x+b.width/2,y=b.y+b.height/2;
  await page.mouse.move(x,y);await page.mouse.down();
  await page.mouse.move(x+dx/2,y+dy/2,{steps:8});
  await page.mouse.move(x+dx,y+dy,{steps:8});
  await page.mouse.up();
 }
 async function select(id){
  await edge(id).focus();await page.keyboard.press('Enter');
 }
 async function api(id){const r=await page.request.get(origin+'/loops/'+id);return (await r.json()).draft.definition;}
 async function device(id){
  return await page.evaluate(async (key)=>{
   const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('graphgoblin',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   if(!db.objectStoreNames.contains('drafts')){db.close();return null;}
   try{return await new Promise((resolve,reject)=>{const r=db.transaction('drafts','readonly').objectStore('drafts').get(key);r.onsuccess=()=>resolve(r.result??null);r.onerror=()=>reject(r.error);});} finally {db.close();}
  },id);
 }
 function geometry(def){
  if(!def)return null;
  return {positions:Object.fromEntries(def.nodes.map(n=>[n.id,n.ui])),routes:Object.fromEntries(def.edges.map(e=>[e.id,e.ui?.route??null]))};
 }
 async function rendered(){
  const r={nodes:await page.locator('.react-flow__node').evaluateAll(e=>e.map(n=>({id:n.dataset.id,style:n.style.transform}))),paths:{}};
  for(const id of ['start-work','return'])r.paths[id]={d:await path(id).getAttribute('d'),label:await edge(id).getAttribute('aria-label')};
  return r;
 }
 async function waitFor(probe){
  for(let n=0;n<70;n++){const v=await probe();if(v)return v;await new Promise(resolve=>setTimeout(resolve,100));}return null;
 }
 for(const [mode,id] of Object.entries(fixtures)){
  const item={id,mode,puts:[]};
  output.push(item);
  const listener=r=>{if(r.method()==='PUT'&&r.url().endsWith('/loops/'+id+'/draft'))item.puts.push(geometry(r.postDataJSON().definition));};
  const deny='**/loops/'+id+'*';
  let blocked=false;
  page.on('request',listener);
  try{
   await start(id);
   item.before={server:geometry(await api(id)),rendered:await rendered()};
   if(mode==='device-first'){
    await page.route(deny,route=>route.request().url().includes('/app/')?route.continue():route.abort('failed'));
    blocked=true;
   }
   await drag(page.getByTestId('node-exhausted').locator(':scope > div:has([data-kind])'),-80,70);
   await select('start-work');
   await segment('start-work',1).waitFor();
   await drag(segment('start-work',1),0,140);
   await select('return');
   await segment('return',3).waitFor();
   await drag(segment('return',3),0,-70);
   const disk=await waitFor(async()=>{const d=await device(id);const g=geometry(d?.definition);return g?.routes['start-work']&&g?.routes.return?d:null;});
   const server=mode==='server'?await waitFor(async()=>{const d=await api(id);const g=geometry(d);return g.routes['start-work']&&g.routes.return?d:null;}):await api(id);
   item.edited={server:geometry(server),device:geometry(disk?.definition),deviceSynced:disk?.synced,rendered:await rendered()};
   await page.screenshot({path:'geometry-'+mode+'-before-reload.png'});
   await page.reload();
   await page.getByTestId('node-side').waitFor({timeout:15000});
   await settle();
   item.reloaded={server:geometry(await api(id)),device:geometry((await device(id))?.definition),rendered:await rendered()};
   await page.screenshot({path:'geometry-'+mode+'-after-reload.png'});
   if(blocked){
    await page.unroute(deny);blocked=false;
    await page.reload();await page.getByTestId('node-side').waitFor();
    item.recovered={server:geometry(await waitFor(async()=>{const d=await api(id);return geometry(d)?.routes.return?d:null;})),device:geometry((await device(id))?.definition),rendered:await rendered()};
   }
  } catch(e){item.error=String(e);}
  finally{if(blocked)await page.unroute(deny);page.off('request',listener);}
 }
 return output;
}

