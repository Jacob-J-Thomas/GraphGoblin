import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '../../../apps/web/node_modules/@playwright/test/index.mjs';
import * as L from './lib.mjs';
let api,browser;const E={};const marker=path.join(L.ROOT,'force-script.jsonl'),release=path.join(L.ROOT,'force-script.release');
const count=()=>fs.existsSync(marker)?fs.readFileSync(marker,'utf8').trim().split('\n').length:0;
try{
 api=await L.startApi('force-nested',6637,{GG_MAX_CONCURRENT_RUNS:'1',GG_SHUTDOWN_GRACE_MS:'1000'});
 const childLoop=await L.publish(api,L.loop('Force child',[L.scriptNode(path.join(L.RECORD,'effect.mjs'),['hold',marker,release])]));
 const parent=await L.run(api,await L.publish(api,L.loop('Force parent',[{id:'sub',kind:'subloop',label:'Await child',config:{loopRef:{loopId:childLoop,version:'latest'}}}])));
 const child=await L.until(async()=>(await api.get('/runs?parent='+parent.id)).items[0]);await L.until(()=>count()===1);
 const queued=await L.run(api,await L.publish(api,L.loop('Force independent queued')));
 const ctrl=new AbortController();const sse=fetch(api.base+'/runs/'+parent.id+'/events?after=0',{headers:{accept:'text/event-stream'},signal:ctrl.signal}).then(r=>r.text());
 browser=await chromium.launch({channel:'msedge',headless:true});const p=await browser.newPage({viewport:{width:1440,height:1050}});await p.goto(api.base+'/app/runs/'+parent.id);
 const drain=await api.post('/system/shutdown',{action:'drain'});await L.until(async()=>(await api.get('/system/shutdown')).phase==='awaiting-choice');
 await p.getByText(/grace period elapsed/).waitFor();await p.getByRole('button',{name:'Force stop',exact:true}).click();
 E.confirmText=await p.locator('body').innerText();await p.screenshot({path:path.join(L.RECORD,'force-nested-confirm.png')});
 // Record the public explicit force separately from the opened, unsubmitted browser confirmation.
 const forced=await api.post('/system/shutdown',{action:'force'});const exited=await Promise.race([api.exit,L.sleep(15000).then(()=>({timeout:true}))]);
 const stream=await Promise.race([sse,L.sleep(5000).then(()=>null)]);if(stream===null)ctrl.abort();
 L.check('explicit force exits with truthful native interruption',exited.code===0,{forced,exited});
 L.check('parent SSE closes without fabricated force failure of parked parent',stream!==null && !stream.includes('event: run.failed'),stream?.slice(-2000));
 await api.kill();api=await L.startApi('force-nested',6637);
 const childFailed=await L.state(api,child.id,['failed']);const parentFailed=await L.state(api,parent.id,['failed']);await L.state(api,queued.id,['succeeded']);
 L.check('forced child records effect uncertainty and cannot Resume',childFailed.failure.code==='RUN_INTERRUPTED_BY_STOP' && childFailed.failure.resumable===false && childFailed.failure.details.effectMayHaveHappened===true && !childFailed.recovery.resume.allowed,childFailed);
 L.check('forced child never silently duplicated',count()===1 && (await api.get('/runs?parent='+parent.id)).items.length===1,{count:count(),parentFailed});
 const denied=await api.call('POST','/runs/'+parent.id+'/resume',{observedSeq:parentFailed.recovery.observedSeq});L.check('parent recovery refuses nonresumable child',denied.status===409,denied);
 await p.goto(api.base+'/app/runs/'+child.id);await p.getByRole('button',{name:'Resume',exact:true}).waitFor();L.check('forced child inspector refuses Resume',await p.getByRole('button',{name:'Resume',exact:true}).isDisabled());
 await p.screenshot({path:path.join(L.RECORD,'force-nested-restarted.png')});fs.writeFileSync(release,'fork may finish');
 const before=await L.events(api,child.id);const body={nodeId:'script',observedSeq:childFailed.recovery.observedSeq,retryUncertainScript:true};
 const replies=await Promise.all([api.call('POST','/runs/'+child.id+'/replay',body),api.call('POST','/runs/'+child.id+'/replay',body)]);const fork=replies.find(r=>r.status===202)?.body.run;
 L.check('explicit Replay of forced script admits exactly one fork',replies.map(r=>r.status).sort().join()==='202,409' && !!fork,{replies});
 if(fork)await L.state(api,fork.id,['succeeded']);
 L.check('only explicit fork repeats effect; source history preserved',count()===2 && JSON.stringify(before)===JSON.stringify(await L.events(api,child.id)),{count:count(),fork});
 E.details={parent,child,queued,drain,forced,exited,parentFailed,childFailed,denied,replies,fork};
}catch(error){E.error=String(error.stack);L.check('force nested driver completed',false,E.error);}
finally{await browser?.close();await L.cleanup();L.save('force-nested-results.json',{checks:L.checks,evidence:E});}
process.exitCode=L.checks.some(c=>!c.passed)?1:0;
