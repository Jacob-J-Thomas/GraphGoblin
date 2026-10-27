// The pause starts when a row receives focus, before Enter selects it.
// Capture announcements before focus, correcting a11y-strict's late timestamp.
import {writeFile} from 'node:fs/promises';import {join} from 'node:path';
import {makeTemp,removeTemp,startApi,restClient,cycle,edge,delay,until,inspectorState,logger,HERE} from './lib.mjs';
const log=logger('a11y-pause.log.txt'),data=await makeTemp('a11y-pause'),result={};let server,browser;
try{
  server=await startApi({port:6618,dataDir:data,log});const api=restClient(server.url),loop=await api.createLoop(cycle({name:'QA pause announcement'})),run=await api.start(loop.loop.id);
  browser=await edge();const page=await browser.newPage();await page.addInitScript(()=>{window.__live=[];const seen=new WeakMap();new MutationObserver(()=>{for(const el of document.querySelectorAll('[aria-live]')){const text=el.textContent?.trim();if(text&&seen.get(el)!==text){seen.set(el,text);window.__live.push({at:performance.now(),text});}}}).observe(document,{subtree:true,childList:true,characterData:true});});
  await page.goto(`${server.url}/app/runs/${run.id}`);await until(async()=>(await inspectorState(page)).rowsMounted===80);await delay(1000);
  const before=await inspectorState(page),from=await page.evaluate(()=>performance.now());
  await page.locator('ol[aria-label="Timeline"] button[data-seq]').first().focus();await delay(300);
  const focused=await page.evaluate(()=>({seq:document.activeElement?.getAttribute('data-seq'),name:document.activeElement?.textContent}));
  await page.keyboard.press('Enter');await page.getByRole('heading',{name:`Thread at event ${focused.seq}`,exact:true}).waitFor();await delay(200);
  const announcements=await page.evaluate(t=>window.__live.filter(x=>x.at>=t),from),after=await inspectorState(page);
  result.ok=before.followLiveEnabled===false&&after.followLiveEnabled===true&&announcements.some(x=>x.text.startsWith('Following paused.'));
  Object.assign(result,{before:{timeline:before.timeline,following:!before.followLiveEnabled},focused,after:{timeline:after.timeline,following:!after.followLiveEnabled},announcements});log(result.ok?'PASS':'FAIL',result);await api('POST',`/runs/${run.id}/cancel`,{});
}catch(e){result.error=String(e.stack??e);log('ERROR',result.error);}
finally{await browser?.close();await server?.kill();await removeTemp(data);await writeFile(join(HERE,'a11y-pause.json'),JSON.stringify(result,null,2)+'\n');await log.flush();}
