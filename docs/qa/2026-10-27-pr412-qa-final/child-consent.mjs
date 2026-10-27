// Public HTTP relation lifecycle: new child after replay cannot inherit old component approval.
import fs from 'node:fs';
import {startServer,client,setCapacity,ADEQUATE,workLoop,parentLoop,temp,join,Evidence} from './qa-lib.mjs';
const ev=new Evidence('13-child-consent');const base=fs.mkdtempSync(join(temp,'gg-qa-412f-child-'));
const capacityFile=join(base,'capacity.json');setCapacity(capacityFile,ADEQUATE);
const server=await startServer({dataDir:join(base,'data'),port:6623,capacityFile,logFile:join(base,'server.log.txt'),env:{QA_LOG_LEVEL:'warn'}});const api=client(server.url);
try{
 const cLoop=await api.createLoop(workLoop('Consent child')),pLoop=await api.createLoop(parentLoop('Consent parent',cLoop));
 const p=(await api.startRun(pLoop,{})).id;await api.waitFinal(p);const c=(await api.get('/runs?parent='+p)).json.items[0].id;
 ev.check('new parent and child start retained',!(await api.run(p)).deletionApproval&&!(await api.run(c)).deletionApproval);
 ev.check('complete parent/child selection approves together',(await api.mark([p,c])).status===200);
 const replay=await api.post('/runs/'+p+'/replay',{nodeId:'call'});ev.check('replay accepted',replay.status===202,replay.status);
 const fork=replay.json.run.id;await api.waitFinal(fork);const nc=(await api.get('/runs?parent='+fork)).json.items[0].id;
 const rows=await Promise.all([p,c,fork,nc].map(id=>api.run(id)));
 ev.log('component after replay creates a new child',rows.map(r=>({id:r.id,parent:r.parentRunId,status:r.status,approval:r.deletionApproval})));
 ev.check('old parent/child approvals revoked and new parent/child unapproved',rows.every(r=>!r.deletionApproval));
 ev.check('old consent does not return when new child and replay finalize',rows.every(r=>Boolean(r.finalizedAt)));
 const prev=await api.preview([p,c,fork]);ev.log('preview omitting new child',prev.json.items);
 ev.check('new child must be explicitly selected with the full component',prev.status===200&&prev.json.items.some(i=>i.reasons.some(r=>r.includes(nc))));
 ev.check('mark complete four-run component',(await api.mark([p,c,fork,nc])).status===200);
 ev.check('withdraw one retains entire component',(await api.mark([nc],'withdraw')).status===200&&(await Promise.all([p,c,fork,nc].map(id=>api.run(id)))).every(r=>!r.deletionApproval));
}catch(e){ev.log('ERROR',String(e.stack??e));process.exitCode=1;}finally{ev.log('stop',await server.stop());ev.log('failures',ev.failures??0);}
