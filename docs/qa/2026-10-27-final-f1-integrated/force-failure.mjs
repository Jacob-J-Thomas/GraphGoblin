// Environment-constrained native force: verify the specified fail-closed path and parent Replay.
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from '../../../apps/web/node_modules/@playwright/test/index.mjs';
import * as L from './lib.mjs';
let api,browser;const E={};const marker=path.join(L.ROOT,'force-failure.jsonl'),release=path.join(L.ROOT,'force-failure.release');
const count=()=>fs.existsSync(marker)?fs.readFileSync(marker,'utf8').trim().split('\n').length:0;
try{
 api=await L.startApi('force-failure',6637,{GG_SHUTDOWN_GRACE_MS:'1000'});
 const childLoop=await L.publish(api,L.loop('Native force child',[L.scriptNode(path.join(L.RECORD,'effect.mjs'),['hold',marker,release])]));
 const parent=await L.run(api,await L.publish(api,L.loop('Native force parent',[{id:'sub',kind:'subloop',label:'Await child',config:{loopRef:{loopId:childLoop,version:'latest'}}}])));
 const child=await L.until(async()=>(await api.get('/runs?parent='+parent.id)).items[0]);await L.until(()=>count()===1);
 browser=await chromium.launch({channel:'msedge',headless:true});const p=await browser.newPage({viewport:{width:1440,height:1050}});await p.goto(api.base+'/app/runs/'+parent.id);
 await api.post('/system/shutdown',{action:'drain'});await api.post('/system/shutdown',{action:'force'});
 const failedStop=await L.until(async()=>{const s=await api.get('/system/shutdown');return s.phase==='force-failed'?s:false;});
 await p.getByRole('heading',{name:'Force stop failed',exact:true}).waitFor({timeout:15000});
 E.notice=await p.locator('body').innerText();await p.screenshot({path:path.join(L.RECORD,'native-force-failed.png')});
 const interrupted=await api.get('/runs/'+child.id);
 L.check('native access-denied cleanup stays force-failed and inspectable',interrupted.failure.code==='SCRIPT_TERMINATION_UNCONFIRMED' && failedStop.unconfirmedRunIds.includes(child.id) && api.child.exitCode===null,{failedStop,interrupted});
 L.check('failed force neither duplicates nor claims success',count()===1 && interrupted.failure.resumable===false && interrupted.failure.script.state==='outcome-uncertain');
 fs.writeFileSync(release,'release only this fixture process');
 const ack=await api.post('/system/shutdown',{action:'force'});const exited=await api.exit;L.check('explicit acknowledgement after failed cleanup exits one',exited.code===1,{ack,exited});
 await api.kill();api=await L.startApi('force-failure',6637);
 const source=await L.state(api,parent.id,['failed']);const childAfter=await api.get('/runs/'+child.id);
 const denied=await api.call('POST','/runs/'+child.id+'/replay',{nodeId:'script',observedSeq:childAfter.recovery.observedSeq,retryUncertainScript:true});
 L.check('failed parent owns child recovery after restart',denied.status===409 && denied.body.code==='PARENT_RECOVERY_REQUIRED',denied);
 const before=await L.events(api,parent.id);const body={nodeId:'sub',observedSeq:source.recovery.observedSeq,retryUncertainScript:true};
 const replies=await Promise.all([api.call('POST','/runs/'+parent.id+'/replay',body),api.call('POST','/runs/'+parent.id+'/replay',body)]);const fork=replies.find(r=>r.status===202)?.body.run;
 L.check('parent explicit Replay admits exactly one fork',replies.map(r=>r.status).sort().join()==='202,409'&&!!fork,replies);
 if(fork)await L.state(api,fork.id,['succeeded']);
 const newChildren=fork?(await api.get('/runs?parent='+fork.id)).items:[];
 L.check('explicit parent fork owns one new child and preserves source',newChildren.length===1 && newChildren[0].id!==child.id && count()===2 && JSON.stringify(before)===JSON.stringify(await L.events(api,parent.id)),{newChildren,count:count()});
 E.details={parent,child,failedStop,interrupted,ack,exited,source,childAfter,denied,replies,fork,newChildren};
}catch(error){E.error=String(error.stack);L.check('force-failure driver completed',false,E.error);}
finally{fs.writeFileSync(release,'fixture cleanup');await browser?.close();await L.cleanup();L.save('force-failure-results.json',{checks:L.checks,evidence:E});}
process.exitCode=L.checks.some(c=>!c.passed)?1:0;
