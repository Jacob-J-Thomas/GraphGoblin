async (page) => {
 const fixtures={"llm":"01M7CAQMGKW39MNPC90CDM033N","score":"01M7CAQMHNM3DD5X8J6FA71KCT","expression":"01M7CAMGBQ4B6NN3PW06KDV1AD","noul":"01M7CAQMHAZXN7M1CXR2H070Q3","choice":"01M7CAQMGYM406KQXPEJFB2XY8"};
 const origin=new URL(page.url()).origin;
 await page.setViewportSize({width:1440,height:940});
 const output=[];
 const isShown=async (selector)=>await selector.count()>0 && await selector.isVisible();
 const handles=()=>page.getByTestId('node-subject').locator('.react-flow__handle.source');
 const renderedEdges=()=>page.locator('.react-flow__edge').evaluateAll(nodes=>nodes.map(e=>({id:e.dataset.id,label:e.getAttribute('aria-label')})));
 const draft=async (id)=>{const r=await page.request.get(origin+'/loops/'+id);return (await r.json()).draft.definition;};
 const model=async (id)=>await page.evaluate(async (key)=>{
   const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('graphgoblin',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   if(!db.objectStoreNames.contains('drafts')){db.close();return null;}
   try{return await new Promise((resolve,reject)=>{const r=db.transaction('drafts','readonly').objectStore('drafts').get(key);r.onsuccess=()=>resolve(r.result??null);r.onerror=()=>reject(r.error);});} finally {db.close();}
 },id);
 async function waitFor(probe){
  for(let n=0;n<55;n++){const found=await probe();if(found)return found;await new Promise(resolve=>setTimeout(resolve,100));}
  return null;
 }
 async function open(id) {
  await page.goto(origin+'/app/loops/'+id+'/edit');
  await page.getByTestId('node-subject').waitFor({timeout:10000});
  for(const name of ['Hide palette','Hide loop settings']){
   const button=page.getByRole('button',{name,exact:true});if(await isShown(button))await button.click();
  }
  await page.getByRole('button',{name:'Fit view'}).click();
  await page.evaluate(()=>document.fonts.ready);
 }
 async function openDialog(){
  await page.getByTestId('node-subject').locator(':scope > div:has([data-kind])').click();
  const dialog=page.getByRole('dialog');await dialog.waitFor({timeout:5000});return dialog;
 }
 async function point(locator){
  const b=await locator.boundingBox();
  if(!b)throw Error('No public handle bounds: '+locator);
  return {x:b.x+b.width/2,y:b.y+b.height/2};
 }
 async function drag(from,to){
  const a=await point(from),b=await point(to);
  await page.mouse.move(a.x,a.y);
  await page.mouse.down();
  await page.mouse.move(b.x,b.y,{steps:20});
  await page.mouse.up();
  return {from:a,to:b};
 }
 for(const [kind,id] of Object.entries(fixtures)){
  const item={kind,id,puts:[],attempts:[]};
  output.push(item);
  const listener=r=>{if(r.method()==='PUT'&&r.url().endsWith('/loops/'+id+'/draft')){const data=r.postDataJSON();item.puts.push({node:data.definition.nodes.find(n=>n.id==='subject').config,edges:data.definition.edges.filter(e=>e.from.node==='subject')});}};
  page.on('request',listener);
  try{
   await open(id);
   item.before={definition:await draft(id),ports:await handles().evaluateAll(els=>els.map(e=>({id:e.dataset.handleid,label:e.getAttribute('aria-label')})))};
   const d=await openDialog();
   item.modal=await d.getByLabel('Output',{exact:true}).locator('option').evaluateAll(els=>els.map(e=>({id:e.value,label:e.textContent})));
   await d.getByRole('button',{name:'Done',exact:true}).click();
   await page.getByRole('dialog').waitFor({state:'hidden'});
   const base=item.before.ports.map(p=>p.id);
   for(let i=0;i<base.length;i++){
    const port=base[i];
    const selector=page.getByTestId('node-subject').locator('.react-flow__handle[data-handleid="'+port+'"]');
    const target=i%2===0?'via':'done';
    const coordinates=await drag(selector,page.getByTestId('node-'+target).locator('.react-flow__handle.target'));
    const saved=await waitFor(async ()=> (await draft(id)).edges.find(e=>e.from.node==='subject'&&e.from.port===port&&e.to.node===target));
    const rendered=await renderedEdges();
    item.attempts.push({port,target,coordinates,saved,rendered,renderedSaved:saved?rendered.some(e=>e.id===saved.id):false});
   }
   item.beforeReload={edges:(await draft(id)).edges,rendered:await renderedEdges(),device:await model(id)};
   const d2=await openDialog();
   item.modalAfter={free:await d2.getByLabel('Output',{exact:true}).locator('option').evaluateAll(els=>els.map(e=>e.value)),mapped:await d2.getByRole('region',{name:'Connections'}).locator('li').allTextContents()};
   await d2.getByRole('button',{name:'Done',exact:true}).click();
   await page.screenshot({path:'outputs-'+kind+'-before-reload.png'});
   await page.reload();
   await page.getByTestId('node-subject').waitFor();
   await waitFor(async ()=>(await renderedEdges()).length>1);
   item.afterReload={rendered:await renderedEdges(),edges:(await draft(id)).edges,ports:await handles().evaluateAll(els=>els.map(e=>e.dataset.handleid))};
   await page.screenshot({path:'outputs-'+kind+'-after-reload.png'});
  }catch(error){item.error=String(error);}
  page.off('request',listener);
 }
 return output;
}

