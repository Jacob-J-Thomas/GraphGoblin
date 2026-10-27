// Diagnose pointer modality while native dialogs are open; real Edge touch and mouse input.
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {startServer,client,setCapacity,ADEQUATE,workLoop,temp,join,root,here,Evidence,sleep} from './qa-lib.mjs';
const ev=new Evidence(process.argv[2]?'11e-touch-after-fullpage':'11c-touch-dialog');const base=fs.mkdtempSync(join(temp,'gg-qa-412f-touch-'));
const capacityFile=join(base,'capacity.json');setCapacity(capacityFile,ADEQUATE);
const server=await startServer({dataDir:join(base,'data'),port:6626,capacityFile,logFile:join(base,'server.log.txt'),env:{QA_LOG_LEVEL:'warn'}});
const api=client(server.url);const {chromium}=createRequire(join(root,'apps/web/package.json'))('@playwright/test');
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const l=await api.createLoop(workLoop('Touch modality'));const id=(await api.startRun(l,{})).id;await api.waitFinal(id);
 for(const width of [360,768,1024,1440]) for(const input of ['mouse','touch']){
  const c=await browser.newContext({viewport:{width,height:900},hasTouch:true});const p=await c.newPage();
  await p.goto(server.url+'/app/runs');await p.getByRole('checkbox',{name:'Select history '+id}).check();
  const media=()=>p.evaluate(()=>({coarse:matchMedia('(pointer:coarse)').matches,fine:matchMedia('(pointer:fine)').matches,anyCoarse:matchMedia('(any-pointer:coarse)').matches}));
  ev.log('before',width,input,await media());
  if(process.argv[2]){await p.screenshot({path:join(here,`diagnostic-fullpage-${width}-${input}.png`),fullPage:true});ev.log('after fullpage screenshot',width,input,await media());}
  const opener=p.getByRole('button',{name:'Review delete-ready history'});if(input==='touch')await opener.tap();else await opener.click();
  const d=p.getByRole('dialog');await d.waitFor();await sleep(600);
  const sizes=await d.getByRole('button').evaluateAll(bs=>bs.map(e=>{const b=e.getBoundingClientRect();return {name:e.getAttribute('aria-label')||e.textContent.trim(),w:b.width,h:b.height,class:e.className};}));
  const m=await media();ev.log('open',width,input,m,sizes);
  ev.check(`native dialog ${width} ${input}: 44px whenever pointer coarse`,!m.coarse||sizes.every(b=>b.w>=44&&b.h>=44));
  if(input==='touch' && m.coarse)await p.screenshot({path:join(here,`touch-dialog-${width}.png`)});
  await p.keyboard.press('Escape');await c.close();
 }
}catch(e){ev.log('ERROR',String(e.stack??e));process.exitCode=1;}
finally{await browser.close();ev.log('stop',await server.stop());ev.log('failures',ev.failures??0);}
