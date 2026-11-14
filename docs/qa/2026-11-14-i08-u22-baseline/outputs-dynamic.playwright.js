async (page) => {
 const origin=new URL(page.url()).origin;
 const result={attempts:[],requests:[]};
 const start={id:'start',kind:'trigger',label:'Start',config:{type:'manual'},ui:{x:0,y:100}};
 const subject={id:'subject',kind:'decision',label:'Subject',ui:{x:315,y:100},config:{kind:'expression',jsonata:'"yes"',routes:[{id:'yes',label:'Yes'},{id:'no',label:'No'}]}};
 const done={id:'done',kind:'exit',label:'Done',ui:{x:1010,y:100},config:{}};
 const alternate={id:'alternate',kind:'exit',label:'Alternate',ui:{x:770,y:340},config:{}};
 const edge=(id,from,port,to)=>({id,from:{node:from,port},to:{node:to}});
 const r=await page.request.post(origin+'/loops',{data:{definition:{schemaVersion:4,name:'I08 dynamic output handles',nodes:[start,subject,done,alternate],edges:[edge('incoming','start','out','subject'),edge('yes-edge','subject','yes','done')]}}});
 if(!r.ok())throw Error(await r.text());
 const id=(await r.json()).loop.id;
 result.id=id;
 const listener=(r)=>{if(r.method()==='PUT'&&r.url().endsWith('/loops/'+id+'/draft')){const d=r.postDataJSON().definition;result.requests.push({config:d.nodes.find(n=>n.id==='subject').config,edges:d.edges});}};
 page.on('request',listener);
 const handles=()=>page.getByTestId('node-subject').locator('.react-flow__handle.source').evaluateAll(els=>els.map(e=>e.dataset.handleid));
 const modal=()=>page.getByRole('dialog').getByLabel('Output',{exact:true}).locator('option').evaluateAll(els=>els.map(e=>e.value));
 const visibleEdges=()=>page.locator('.react-flow__edge').evaluateAll(els=>els.map(e=>({id:e.dataset.id,label:e.getAttribute('aria-label')})));
 const api=async()=> (await (await page.request.get(origin+'/loops/'+id)).json()).draft.definition;
 const route=(dialog,index)=>dialog.locator('[data-field="routes.'+index+'.id"] input');
 const open=async()=>{await page.getByTestId('node-subject').locator(':scope > div:has([data-kind])').click();return page.getByRole('dialog');};
 const doneDialog=async(d)=>{await d.getByRole('button',{name:'Done',exact:true}).click();await d.waitFor({state:'hidden'});};
 async function waitFor(probe){
  for(let n=0;n<65;n++){const v=await probe();if(v)return v;await new Promise(resolve=>setTimeout(resolve,100));}return null;
 }
 async function drag(port,target){
  const selectors=[page.getByTestId('node-subject').locator('.react-flow__handle.source[data-handleid="'+port+'"]'),page.getByTestId('node-'+target).locator('.react-flow__handle.target')];
  const pts=await Promise.all(selectors.map(async l=>{const b=await l.boundingBox();if(!b)throw Error('missing port '+port);return {x:b.x+b.width/2,y:b.y+b.height/2};}));
  await page.mouse.move(pts[0].x,pts[0].y);await page.mouse.down();await page.mouse.move(pts[1].x,pts[1].y,{steps:20});await page.mouse.up();
 }
 try{
  await page.goto(origin+'/app/loops/'+id+'/edit');
  await page.getByTestId('node-subject').waitFor();
  for(const name of ['Hide palette','Hide loop settings']){const b=page.getByRole('button',{name,exact:true});if(await b.count()&&await b.isVisible())await b.click();}
  await page.getByRole('button',{name:'Fit view'}).click();
  let d=await open();
  await route(d,1).fill('replaced-no');
  await route(d,1).press('Tab');
  result.replaced={canvas:await handles(),modal:await modal(),prior:(await api()).edges};
  await doneDialog(d);
  await drag('replaced-no','alternate');
  const saved=await waitFor(async()=> (await api()).edges.find(e=>e.from.port==='replaced-no'));
  result.attempts.push({port:'replaced-no',saved,rendered:await visibleEdges()});

  d=await open();
  await d.getByRole('button',{name:'Add routes',exact:true}).click();
  await route(d,2).fill('new-third');
  await d.locator('[data-field="routes.2.label"] input').fill('9');
  result.added={canvas:await handles(),modal:await modal()};
  await doneDialog(d);
  await drag('new-third','done');
  const third=await waitFor(async()=> (await api()).edges.find(e=>e.from.port==='new-third'));
  result.attempts.push({port:'new-third',saved:third,rendered:await visibleEdges()});

  d=await open();
  await d.getByRole('button',{name:'Add routes',exact:true}).click();
  const invalidPort='Bad ID';
  await route(d,3).fill(invalidPort);
  await d.locator('[data-field="routes.3.label"] input').fill('unfinished');
  const invalidModal=await modal();
  const invalidCanvas=await handles();
  const output=d.getByLabel('Output',{exact:true});
  const refused=invalidModal.includes(invalidPort);
  if(refused){
   await output.selectOption(invalidPort);
   await d.getByLabel('To',{exact:true}).selectOption('alternate');
   await d.getByRole('button',{name:'Connect',exact:true}).click();
  }
  result.invalid={canvas:invalidCanvas,modal:invalidModal,refusal:await d.getByRole('region',{name:'Connections'}).getByRole('alert').allTextContents(),saved:(await api()).edges,saveStatus:await page.getByTestId('save-state').innerText()};
  await page.screenshot({path:'outputs-dynamic-invalid.png'});
  await route(d,3).fill('fixed-fourth');
  await route(d,3).press('Tab');
  result.fixed={canvas:await handles(),modal:await modal()};
  await doneDialog(d);
  await drag('fixed-fourth','alternate');
  const fourth=await waitFor(async()=> (await api()).edges.find(e=>e.from.port==='fixed-fourth'));
  result.attempts.push({port:'fixed-fourth',saved:fourth,rendered:await visibleEdges()});
  await page.screenshot({path:'outputs-dynamic-before-reload.png'});
  await page.reload();
  await page.getByTestId('node-subject').waitFor();
  await waitFor(async()=> (await visibleEdges()).length===5);
  result.reload={handles:await handles(),edges:(await api()).edges,rendered:await visibleEdges()};
  await page.screenshot({path:'outputs-dynamic-after-reload.png'});
 }catch(e){result.error=String(e);result.snapshot=await page.locator('body').ariaSnapshot();}
 finally{page.off('request',listener);}
 return result;
}
