// Native console Ctrl+C then deliberate later Ctrl+C, fake Codex only.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import * as L from './lib.mjs';
let api;const E={};const signal=()=>execFileSync(path.join(L.CLI,'console-tool.exe'),['ctrlc',String(api.child.pid)],{windowsHide:true,encoding:'utf8'});
try{
 L.control('hold.txt','F1 force provider');api=await L.startApi('provider-force',6637,{GG_SHUTDOWN_GRACE_MS:'1000'},undefined,{consoleHost:true});
 const infer=L.inference('think');infer.config.harness='codex';infer.config.model='gpt-6-luna';infer.config.prompt.template='F1 force provider {{ run.id }}';
 const childLoop=await L.publish(api,L.loop('Held fake Codex child',[infer]));const parent=await L.run(api,await L.publish(api,L.loop('Force fake provider parent',[{id:'sub',kind:'subloop',label:'Await fake CLI',config:{loopRef:{loopId:childLoop,version:'latest'}}}])));
 const child=await L.until(async()=>(await api.get('/runs?parent='+parent.id)).items[0]);
 const request=await L.until(()=>{const p=path.join(L.CLI,'requests.jsonl');return fs.existsSync(p)?fs.readFileSync(p,'utf8').trim().split('\n').map(JSON.parse).findLast(r=>r.prompt.includes(child.id)):false;});
 signal();await L.until(async()=>(await api.get('/system/shutdown')).phase==='awaiting-choice');const draining=await api.get('/runs/'+child.id);
 L.check('first real console Ctrl+C preserves fake Codex turn',draining.status==='running',draining);
 await L.sleep(1200);signal();const exited=await Promise.race([api.exit,L.sleep(12000).then(()=>({timeout:true}))]);L.check('later real console Ctrl+C explicitly forces fake CLI and exits zero',exited.code===0,exited);
 await api.kill();L.control('hold.txt');api=await L.startApi('provider-force',6637);
 const failed=await L.state(api,parent.id,['failed']);const childFailed=await api.get('/runs/'+child.id);
 L.check('forced fake provider has truthful nonresumable interruption',childFailed.failure.code==='RUN_INTERRUPTED_BY_STOP' && childFailed.failure.resumable===false,childFailed);
 const body={nodeId:'sub',observedSeq:failed.recovery.observedSeq};const replies=await Promise.all([api.call('POST','/runs/'+parent.id+'/replay',body),api.call('POST','/runs/'+parent.id+'/replay',body)]);const fork=replies.find(r=>r.status===202)?.body.run;if(fork)await L.state(api,fork.id,['succeeded']);
 L.check('explicit parent Replay after provider force produces one fork',replies.map(r=>r.status).sort().join()==='202,409' && !!fork,replies);
 E.details={parent,child,request,draining,exited,failed,childFailed,replies,fork};
}catch(error){E.error=String(error.stack);L.check('provider force driver completed',false,E.error);}
finally{L.control('hold.txt');await L.cleanup();L.save('provider-force-results.json',{checks:L.checks,evidence:E});}
process.exitCode=L.checks.some(c=>!c.passed)?1:0;
