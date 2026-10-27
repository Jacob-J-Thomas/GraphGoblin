// O2-O4 against the built app. DOM live-region changes are announcement candidates;
// actual speech output is deliberately not claimed.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeTemp, removeTemp, startApi, restClient, logger, edge, delay, until, cycle, inspectorState, HERE } from './lib.mjs';
const log=logger('a11y-strict.log.txt'), data=await makeTemp('a11y-strict');
const result={checks:[]}; let server,browser;
const check=(name,ok,detail)=>{result.checks.push({name,ok,detail});log(ok?'PASS':'FAIL',name,detail);};
const focus=page=>page.evaluate(()=>({tag:document.activeElement?.tagName,seq:document.activeElement?.getAttribute('data-seq'),name:document.activeElement?.textContent?.trim(),label:document.activeElement?.getAttribute('aria-label')}));
try {
  server=await startApi({port:6618,dataDir:data,log}); const api=restClient(server.url);
  const loop=await api.createLoop(cycle({name:'QA timeline accessibility'})),run=await api.start(loop.loop.id);
  browser=await edge();result.edgeVersion=browser.version();const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.addInitScript(()=>{
    window.__live=[];const seen=new WeakMap();
    new MutationObserver(()=>{
      for(const el of document.querySelectorAll('[aria-live],[role="status"],[role="alert"]')) {
        const text=(el.textContent??'').replace(/\s+/g,' ').trim();
        if(seen.get(el)!==text){seen.set(el,text);window.__live.push({at:performance.now(),text,live:el.getAttribute('aria-live'),role:el.getAttribute('role')});}
      }
    }).observe(document,{subtree:true,childList:true,characterData:true});
  });
  await page.goto(`${server.url}/app/runs/${run.id}`);
  await until(async()=> (await inspectorState(page)).rowsMounted===80);
  await delay(2000);const start=await page.evaluate(()=>performance.now()),before=await inspectorState(page);
  await delay(10000);const after=await inspectorState(page),announcements=await page.evaluate(t=>window.__live.filter(x=>x.at>=t&&x.text),start);
  check('10 s following: no append announcements while event count grows',announcements.length===0&&after.timeline.total>before.timeline.total,{seconds:10,from:before.timeline.total,to:after.timeline.total,changes:announcements.length,announcements});
  const timeline=page.getByRole('list',{name:'Timeline',exact:true});
  const target=timeline.getByRole('button',{name:/node\.finished Grow/}).first();
  const seq=Number(await target.getAttribute('data-seq'));await target.focus();const selectedAt=await page.evaluate(()=>performance.now());
  await page.keyboard.press('Enter');await page.getByRole('heading',{name:`Thread at event ${seq}`,exact:true}).waitFor();
  await until(async()=>!(await inspectorState(page)).reading.some(x=>x.startsWith('Reading the thread')));
  const row=page.locator(`ol[aria-label="Timeline"] button[data-seq="${seq}"]`);
  const selectedFocus=await focus(page);await page.keyboard.press('Shift+Tab');const backwards=await focus(page);
  await row.focus();await page.keyboard.press('Tab');const forwards=await focus(page);
  check('one Shift+Tab and one Tab each leave Timeline rows',backwards.seq===null&&forwards.seq===null,{seq,selectedFocus,backwards,forwards});
  const pauseAnnouncements=await page.evaluate(t=>window.__live.filter(x=>x.at>=t&&x.text).map(x=>x.text),selectedAt);
  check('keyboard selection retains row focus and announces pause',selectedFocus.seq===String(seq)&&pauseAnnouncements.some(x=>x.startsWith('Following paused.')),{selectedFocus,pauseAnnouncements});
  const selectedState=await inspectorState(page);
  result.ariaSelected={thread:await page.getByRole('region',{name:`Thread at event ${seq}`,exact:true}).ariaSnapshot(),patch:await page.getByRole('list',{name:'Patch diff',exact:true}).ariaSnapshot(),row:await row.ariaSnapshot()};
  const follow=page.getByRole('button',{name:'Follow live',exact:true});await follow.focus();await page.keyboard.press('Enter');
  await page.getByRole('heading',{name:'Current thread',exact:true}).waitFor();await delay(700);const afterFollow=await focus(page);
  check('Follow live retains keyboard focus after Enter',afterFollow.name==='Follow live'&&await follow.getAttribute('aria-disabled')==='true',{afterFollow,ariaDisabled:await follow.getAttribute('aria-disabled')});
  result.ariaFollowing={thread:await page.getByRole('region',{name:'Current thread',exact:true}).ariaSnapshot(),currentRow:await page.locator('ol[aria-label="Timeline"] button[aria-current="true"]').ariaSnapshot(),controls:await follow.ariaSnapshot()};
  check('names identify current thread, selected boundary, patch before/after and current row',result.ariaFollowing.thread.includes('Current thread')&&result.ariaSelected.thread.includes(`Thread at event ${seq}`)&&result.ariaSelected.patch.includes('Before')&&result.ariaSelected.patch.includes('After')&&selectedState.patchTitle?.startsWith('Patch from Grow'),{selectedBoundary:seq,patchTitle:selectedState.patchTitle,ariaFollowing:result.ariaFollowing,ariaSelected:result.ariaSelected});
  await page.screenshot({path:join(HERE,'a11y-strict-following.png')});await api('POST',`/runs/${run.id}/cancel`,{});
}catch(e){result.error=String(e.stack??e);log('ERROR',result.error);}
finally{await browser?.close();await server?.kill();await removeTemp(data);result.ok=!result.error&&result.checks.every(x=>x.ok);await writeFile(join(HERE,'a11y-strict.json'),JSON.stringify(result,null,2)+'\n');await log.flush();}
