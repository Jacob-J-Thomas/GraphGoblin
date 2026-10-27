// Follow-up to the visibly overlapping five-digit event numbers in history-final.png.
// Reopens only this QA's own completed-history store; measures real Edge DOM geometry.
import {readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';
import {startApi,restClient,edge,until,inspectorState,logger,HERE} from './lib.mjs';
const log=logger('timeline-layout.log.txt'),result={};let server,browser;
try{
  const ledger=(await readFile(join(HERE,'processes.log.txt'),'utf8')).trim().split('\n').map(x=>JSON.parse(x));
  const owned=ledger.find(x=>x.port===6612);if(!owned)throw new Error('Missing owned history fixture');
  server=await startApi({port:6612,dataDir:owned.dataDir.replaceAll('%USERPROFILE%',process.env.USERPROFILE),log});const api=restClient(server.url);
  const history=JSON.parse(await readFile(join(HERE,'history.json'),'utf8'));
  // The cancelled run ID is available through the public list, scoped to this disposable store.
  const runs=await api('GET','/runs');const items=Array.isArray(runs)?runs:runs.items;
  const run=items.find(x=>x.lastEventSeq>=10_000);if(!run)throw new Error('Missing long run');
  browser=await edge();const page=await browser.newPage({viewport:{width:1440,height:900}});await page.goto(`${server.url}/app/runs/${run.id}`);await until(async()=>(await inspectorState(page)).timeline.stream==='complete');
  const row=page.locator('ol[aria-label="Timeline"] button[data-seq]').last();await row.scrollIntoViewIfNeeded();
  result.geometry=await row.evaluate(button=>{
    const code=button.querySelector('code'),sequence=[...button.children].find(x=>x.textContent?.trim().startsWith('#'));
    const a=sequence?.getBoundingClientRect(),b=code?.getBoundingClientRect();
    const range=document.createRange();range.selectNodeContents(sequence);const text=range.getBoundingClientRect();
    return {seq:button.getAttribute('data-seq'),name:button.textContent,sequenceTag:sequence?.outerHTML,typeTag:code?.outerHTML,sequenceCellRight:a?.right,sequenceTextRight:text.right,typeLeft:b?.left,overlapPixels:text.right-(b?.left??Infinity)};
  });
  const timeline=page.getByRole('heading',{name:/^Timeline \(/}).locator('xpath=ancestor::section[1]');
  await timeline.screenshot({path:join(HERE,'timeline-five-digit-overlap.png')});
  result.runId=run.id;result.edgeVersion=browser.version();result.confirmed=result.geometry.overlapPixels>0;log(result.confirmed?'CONFIRMED':'NOT REPRODUCED',result);
}catch(e){result.error=String(e.stack??e);log('ERROR',result.error);}
finally{await browser?.close();await server?.kill();await writeFile(join(HERE,'timeline-layout.json'),JSON.stringify(result,null,2)+'\n');await log.flush();}
