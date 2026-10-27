// Independent built-product Edge QA: Runs reflow/touch targets and eligibility with live following.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { startServer,client,setCapacity,ADEQUATE,workLoop,temp,join,root,here,Evidence,sleep } from './qa-lib.mjs';
const ev=new Evidence('11f-ui-matrix-live');
const base=fs.mkdtempSync(join(temp,'gg-qa-412f-matrix-'));
const capacityFile=join(base,'capacity.json'); setCapacity(capacityFile,ADEQUATE);
const server=await startServer({dataDir:join(base,'data'),port:6626,capacityFile,logFile:join(base,'server.log.txt'),env:{QA_LOG_LEVEL:'warn'}});
const api=client(server.url);
const {chromium}=createRequire(join(root,'apps/web/package.json'))('@playwright/test');
const browser=await chromium.launch({channel:'msedge',headless:true});
ev.log('Microsoft Edge',browser.version(),'Node',process.version,'data',base);
let live;
try {
  const loop=await api.createLoop(workLoop('Matrix final QA'));
  const ids=[]; for(let i=0;i<3;i++) ids.push((await api.startRun(loop,{text:'matrix-'+i,files:1,bytes:32})).id);
  for(const id of ids) await api.waitFinal(id);
  await api.mark([ids[0]]);
  for(const theme of ['dark','light']) for(const width of [360,768,1024,1440]){
    const context=await browser.newContext({viewport:{width,height:900},hasTouch:true,colorScheme:theme});
    await context.addInitScript(t=>localStorage.setItem('graphgoblin-theme',t),theme);
    const page=await context.newPage(); page.setDefaultTimeout(20000);
    await page.goto(server.url+'/app/runs');
    await page.getByRole('checkbox',{name:'Select history '+ids[1]}).waitFor();
    await page.getByRole('checkbox',{name:'Select history '+ids[1]}).check();
    const measure=()=>page.evaluate(()=>{
      const targets=[...document.querySelectorAll('button,a[href],input:not([type=file]),select,textarea,summary')].filter(e=>e.getClientRects().length && getComputedStyle(e).visibility!=='hidden');
      return {width:innerWidth,scroll:document.documentElement.scrollWidth,coarse:matchMedia('(pointer:coarse)').matches,theme:document.documentElement.dataset.theme,
        controls:targets.length,small:targets.flatMap(e=>{const el=e.matches('input[type=checkbox],input[type=radio]')?e.closest('label')??e:e;const box=el.getBoundingClientRect();const a=getComputedStyle(el,'::after');const w=a.content!=='none'&&a.position==='absolute'?parseFloat(a.width):box.width;const h=a.content!=='none'&&a.position==='absolute'?parseFloat(a.height):box.height;return w<43.9||h<43.9?[{tag:e.tagName,name:e.getAttribute('aria-label')??e.textContent?.trim().slice(0,45),w,h}]:[];}),
        clipped:targets.flatMap(e=>{const b=e.getBoundingClientRect();let clipped=b.left<-.5||b.right>innerWidth+.5;for(let p=e.parentElement;p;p=p.parentElement){if(['hidden','clip','auto','scroll'].includes(getComputedStyle(p).overflowX)){const a=p.getBoundingClientRect();if(b.left<a.left-.5||b.right>a.right+.5)clipped=true;}}return clipped?[e.getAttribute('aria-label')??e.textContent?.trim().slice(0,45)]:[];})};
    });
    const runs=await measure(); ev.log('Runs '+theme+' '+width,runs);
    ev.check(`Runs ${theme} ${width}: no horizontal overflow or clipped controls`,runs.scroll===width && !runs.clipped.length);
    ev.check(`Runs ${theme} ${width}: coarse-pointer controls at least 44 px`,runs.controls>0 && runs.coarse && !runs.small.length,runs.small);
    // Edge/Playwright fullPage resizes tall pages and clears coarse-pointer emulation.
    // Keep viewport captures while interacting; the diagnostic is retained in 11e.
    await page.screenshot({path:join(here,`matrix-runs-${theme}-${width}.png`),fullPage:false});
    ev.check(`capture ${theme} ${width}: coarse pointer remains enabled`,await page.evaluate(()=>matchMedia('(pointer:coarse)').matches));
    await page.getByRole('button',{name:'Review delete-ready history'}).click();
    const dialog=page.getByRole('dialog'); await dialog.getByRole('button',{name:'Confirm delete-ready selection'}).waitFor();
    // Fixed settling window after native showModal; exploratory captures at 100ms are retained.
    await sleep(600);
    ev.log(`dialog ${theme} ${width}`,await dialog.ariaSnapshot());
    const bounds=await dialog.evaluate(el=>{const b=el.getBoundingClientRect();const buttons=[...el.querySelectorAll('button')].filter(e=>e.getClientRects().length).map(e=>{const x=e.getBoundingClientRect();const a=getComputedStyle(e,'::after');const pseudo=a.content!=='none'&&a.position==='absolute';const w=pseudo?parseFloat(a.width):x.width,h=pseudo?parseFloat(a.height):x.height;const cx=(x.left+x.right)/2,cy=(x.top+x.bottom)/2;const hits=[[-w/2+1,0],[w/2-1,0],[0,-h/2+1],[0,h/2-1]].every(([dx,dy])=>{const hit=document.elementFromPoint(cx+dx,cy+dy);return hit===e||e.contains(hit);});return{name:e.textContent.trim()||e.getAttribute('aria-label'),w,h,drawnWidth:x.width,drawnHeight:x.height,hits,left:x.left,right:x.right};});return {left:b.left,right:b.right,width:innerWidth,buttons,focus:document.activeElement?.textContent?.trim()};});
    ev.check(`dialog ${theme} ${width}: fits and buttons meet 44 px with hit testing`,bounds.left>=0 && bounds.right<=width && bounds.buttons.every(b=>b.w>=44&&b.h>=44&&b.hits),bounds);
    await page.screenshot({path:join(here,`matrix-dialog-${theme}-${width}.png`)});
    await page.keyboard.press('Escape'); await dialog.waitFor({state:'hidden'});
    ev.check(`dialog ${theme} ${width}: Escape keeps consent absent`,!(await api.run(ids[1])).deletionApproval);
    await context.close();
  }
  // A fast, real local engine loop (no inference/provider) exercises #418 alongside #187.
  const edge=(from,port,to)=>({id:from+'-'+port+'-'+to,from:{node:from,port},to:{node:to}});
  const def={schemaVersion:4,name:'Live follow final QA',settings:{maxNodeVisits:null},nodes:[
    {id:'start',kind:'trigger',label:'Start',config:{type:'manual'}},
    {id:'grow',kind:'mutate',label:'Grow',config:{operations:[{op:'set',path:'/vars/n',value:{kind:'expression',jsonata:'($exists(vars.n) ? vars.n : 0) + 1'}}]}},
    {id:'gate',kind:'decision',label:'Gate',config:{kind:'expression',jsonata:'"again"',maxPasses:null,routes:[{id:'again',label:'Again',repeat:true},{id:'done',label:'Done'}]}},
    {id:'finish',kind:'exit',label:'Finish',config:{returns:'vars.n'}}],edges:[edge('start','out','grow'),edge('grow','out','gate'),edge('gate','again','grow'),edge('gate','done','finish'),edge('gate','limit-reached','finish')]};
  const loop2=await api.createLoop(def); live=(await api.startRun(loop2,{})).id;
  const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();page.setDefaultTimeout(20000);
  const reads=[];page.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/runs/'+live))reads.push({route:u.pathname,at:u.searchParams.get('at')});});
  await page.goto(server.url+'/app/runs/'+live);
  await page.getByRole('heading',{name:'Current thread',exact:true}).waitFor();
  const from=(await api.run(live)).lastEventSeq, mark=reads.length;
  await sleep(3500); const to=(await api.run(live)).lastEventSeq;
  ev.log('live window',{from,to,reads:reads.slice(mark)});
  ev.check('inspector live advances with eligibility panel present, without historical reads',to>from && !reads.slice(mark).some(r=>r.at!==null) && await page.getByRole('button',{name:'Review delete-ready history'}).isVisible());
  await page.getByRole('button',{name:'Review delete-ready history'}).click();
  const dialog=page.getByRole('dialog');await dialog.getByText(/Run is running/).waitFor();
  ev.check('active inspector eligibility preview protects the live run',await dialog.getByRole('button',{name:'Confirm delete-ready selection'}).isDisabled());
  await page.keyboard.press('Escape');
  const timeline=page.getByRole('list',{name:'Timeline',exact:true});await timeline.getByRole('button').last().focus();
  await page.getByText(/^Following paused\. Showing events/).waitFor();
  const follow=page.getByRole('button',{name:'Follow live'});await follow.focus();await page.keyboard.press('Enter');
  await page.getByText('Following live.',{exact:true}).waitFor({state:'attached'});
  ev.check('keyboard Follow live works alongside eligibility',await follow.evaluate(e=>e===document.activeElement));
  await api.post('/runs/'+live+'/cancel');await api.waitFinal(live);live=undefined;
  await page.getByRole('button',{name:'Review delete-ready history'}).click();
  await dialog.getByRole('button',{name:'Confirm delete-ready selection'}).click();await dialog.waitFor({state:'hidden'});
  await page.getByText(/Delete-ready: confirmed by/).waitFor();
  ev.check('after live cancellation inspector can mark finalized history',Boolean((await api.run((new URL(page.url())).pathname.split('/').at(-1))).deletionApproval));
  await page.screenshot({path:join(here,'live-follow-with-eligibility.png'),fullPage:true});
  await context.close();
}catch(error){ev.log('ERROR',String(error.stack??error));process.exitCode=1;}
finally{if(live){await api.post('/runs/'+live+'/cancel');await api.waitFinal(live);}await browser.close();ev.log('server stop',await server.stop());ev.log('failures',ev.failures??0);}
