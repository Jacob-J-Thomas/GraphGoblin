async (page) => {
 const ids=FIXTURE_IDS;
 const origin = new URL(page.url()).origin;
 const result={};
 const open=async (id)=>{
  await page.goto(origin+'/app/loops/'+id+'/edit');
  await page.getByTestId('node-subject').locator(':scope > div:has([data-kind])').click();
  return page.getByRole('dialog');
 };
 async function config(id){
  return (await (await page.request.get(origin+'/loops/'+id)).json()).draft.definition.nodes.find(n=>n.id==='subject').config;
 }
 async function waitFor(probe){
  for(let n=0;n<70;n++){const v=await probe();if(v)return v;await new Promise(resolve=>setTimeout(resolve,100));}return null;
 }
 const request=(id,trace,r)=>{
  if (r.method()==='PUT'&&r.url().endsWith('/loops/'+id+'/draft')) {
   const def=r.postDataJSON().definition;trace.push({config:def.nodes.find(n=>n.id==='subject').config,edges:def.edges.filter(e=>e.from.node==='subject')});
  }
 };
 const errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 const decisionId=ids.decision;
 const dTrace=[];
 const listener=r=>request(decisionId,dTrace,r);
 page.on('request',listener);
 try{
  let d=await open(decisionId);
  const before=await config(decisionId);
  await d.getByRole('radiogroup',{name:'Decision kind'}).getByText('llm',{exact:true}).click();
  const review=d.getByRole('region',{name:'Change decision kind?'});
  const quote=await review.innerText();
  await d.getByRole('button',{name:'Confirm change',exact:true}).click();
  const instructions=d.getByLabel('Instructions',{exact:true});
  await instructions.waitFor();
  const immediate={instructions:await instructions.innerText(),oldSourceControlCount:await d.getByLabel('Jsonata',{exact:true}).count()};
  const authored='Choose pass from current preview';
  await instructions.fill(authored);
  await instructions.press('Tab');
  const saved=await waitFor(async()=>{const c=await config(decisionId);return c.kind==='llm'&&c.instructions===authored?c:null;});
  const afterSave={instructions:await instructions.innerText(),routes:await d.locator('[data-field="routes.0.label"] input').inputValue()};
  await d.getByRole('button',{name:'Done',exact:true}).click();
  await page.reload();
  await page.getByTestId('node-subject').locator(':scope > div:has([data-kind])').click();
  d=page.getByRole('dialog');
  result.decision={before,quote,immediate,saved,afterSave,reloaded:{source:await d.getByLabel('Instructions',{exact:true}).innerText(),config:await config(decisionId)},requests:dTrace};
  await page.screenshot({path:'union-decision-after.png'});
 }catch(e){result.decision={error:String(e),requests:dTrace};}
 finally{page.off('request',listener);}
 const mutateId=ids.mutate;
 const trace=[];
 const mListener=r=>request(mutateId,trace,r);
 page.on('request',mListener);
 try{
  const d=await open(mutateId);
  await d.getByRole('button',{name:/^Operations 1\b/}).click();
  const row=d.getByRole('group',{name:'Operations 1',exact:true});
  const select=row.getByRole('combobox',{name:'Op',exact:true});
  const path=row.getByLabel('Path',{exact:true});
  const before={value:await path.inputValue(),config:await config(mutateId)};
  await select.selectOption({label:'delete'});
  const immediate=await path.inputValue();
  await path.fill('/vars/new-probe');
  await path.press('Tab');
  const saved=await waitFor(async()=>{const c=await config(mutateId);return c.operations[0]?.op==='delete'&&c.operations[0]?.path==='/vars/new-probe'?c:null;});
  await d.getByRole('button',{name:'Done',exact:true}).click();
  await page.reload();
  await page.getByTestId('node-subject').locator(':scope > div:has([data-kind])').click();
  await page.getByRole('dialog').getByRole('button',{name:/^Operations 1\b/}).click();
  result.mutate={before,immediate,saved,reloaded:{visible:await page.getByRole('dialog').getByRole('group',{name:'Operations 1',exact:true}).getByLabel('Path',{exact:true}).inputValue(),config:await config(mutateId)},requests:trace};
  await page.screenshot({path:'union-mutate-after.png'});
 }catch(e){result.mutate={error:String(e),requests:trace,dialog:await page.getByRole('dialog').ariaSnapshot()};}
 finally{page.off('request',mListener);}
 result.errors=errors;
 return result;
}
