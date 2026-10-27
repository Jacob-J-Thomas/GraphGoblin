// Q1 with deterministic input waits. Every selection is pinned to a data-seq;
// a live `.last()` locator must not be reused after reading its sequence.
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {makeTemp,removeTemp,startApi,restClient,cycle,edge_,edge,delay,until,inspectorState,logger,HERE} from './lib.mjs';
const log=logger('pending-controlled.log.txt'),data=await makeTemp('pending-controlled'),result={checks:[]};let server,browser;
const check=(name,ok,detail)=>{result.checks.push({name,ok,detail});log(ok?'PASS':'FAIL',name,detail);};
try{
  server=await startApi({port:6617,dataDir:data,log});const api=restClient(server.url);
  const d=cycle({name:'QA Q1 controlled',passes:5});d.nodes.push({id:'answer',kind:'wait',label:'Answer',config:{mode:'input',prompt:'Continue?'}});d.edges.find(e=>e.from.node==='grow').to.node='answer';d.edges.push(edge_('answer','out','gate'));
  const loop=await api.createLoop(d),run=await api.start(loop.loop.id);await api.waitStatus(run.id,['waiting']);
  browser=await edge();const page=await browser.newPage({viewport:{width:1440,height:900}});await page.goto(`${server.url}/app/runs/${run.id}`);await until(async()=>(await inspectorState(page)).vars?.n===1);
  const completions=()=>page.locator('ol[aria-label="Timeline"] button[data-seq]').filter({hasText:'node.finishedGrow'});
  const eventsA=await api.allEvents(run.id),seqA=eventsA.find(e=>e.type==='node.finished'&&e.nodeId==='grow').seq;
  await page.locator(`button[data-seq="${seqA}"]`).click();await page.getByRole('heading',{name:`Thread at event ${seqA}`,exact:true}).waitFor();
  await page.getByRole('button',{name:'Follow live',exact:true}).click();await page.getByRole('heading',{name:'Current thread',exact:true}).waitFor();
  const waiting=await api.run(run.id);await api('POST',`/runs/${run.id}/input`,{waitId:waiting.waiting.waitId,input:'advance'});
  await until(async()=>(await inspectorState(page)).vars?.n===2);await api.waitStatus(run.id,['waiting']);await delay(700);
  const before=await inspectorState(page),eventsB=await api.allEvents(run.id),seqB=eventsB.filter(e=>e.type==='node.finished'&&e.nodeId==='grow').at(-1).seq;
  await page.route('**/thread?at=*',async route=>{const response=await route.fetch();await delay(2200);await route.fulfill({response});});
  await page.locator(`button[data-seq="${seqB}"]`).click();const samples=[];
  for(let i=0;i<10;i++){const state=await inspectorState(page);samples.push({heading:state.threadHeading,vars:state.vars,reading:state.reading,patch:state.patchDiff});if(i===3)await page.screenshot({path:join(HERE,'pending-controlled-during.png')});await delay(150);}
  const pending=samples.filter(s=>s.reading.some(x=>x.startsWith('Reading the thread')));
  check('pending new selection preserves immediately preceding current thread and label',before.threadHeading==='Current thread'&&before.vars.n===2&&pending.length>=8&&pending.every(s=>s.heading===before.threadHeading&&isDeepStrictEqual(s.vars,before.vars)&&!s.patch),{seqA,seqB,before:{heading:before.threadHeading,vars:before.vars},pending});
  await page.getByRole('heading',{name:`Thread at event ${seqB}`,exact:true}).waitFor();await page.getByRole('list',{name:'Patch diff',exact:true}).waitFor();
  const atB=await api('GET',`/runs/${run.id}/thread?at=${seqB}`),after=await inspectorState(page);
  const patchBefore=JSON.parse(await page.getByLabel('Value before /vars/n',{exact:true}).innerText()),patchAfter=JSON.parse(await page.getByLabel('Value after /vars/n',{exact:true}).innerText());
  check('completed selection shows exact historical thread and before/after diff',isDeepStrictEqual(after.vars,atB.vars)&&patchBefore===1&&patchAfter===2,{seqB,heading:after.threadHeading,vars:after.vars,expected:atB.vars,patchBefore,patchAfter});
  await api('POST',`/runs/${run.id}/cancel`,{});
}catch(e){result.error=String(e.stack??e);log('ERROR',result.error);}
finally{await browser?.close();await server?.kill();await removeTemp(data);result.ok=!result.error&&result.checks.every(x=>x.ok);await writeFile(join(HERE,'pending-controlled.json'),JSON.stringify(result,null,2)+'\n');await log.flush();}
