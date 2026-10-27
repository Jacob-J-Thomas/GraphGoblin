import * as L from './lib.mjs';
let api;const E={};
try{
 api=await L.startApi('timer-restart',6635,{GG_TIMER_POLL_MS:'50'});const node=L.waitNode();node.config.timeoutSeconds=6;node.config.onTimeout='continue';
 const childLoop=await L.publish(api,L.loop('Two timed child visits',[node,{id:'gate',kind:'decision',label:'Two visits',config:{kind:'expression',jsonata:'"again"',maxPasses:2,routes:[{id:'again',label:'Again',repeat:true},{id:'done',label:'Done'}]}}],{},[L.edge('a','start','park'),L.edge('b','park','gate'),L.edge('c','gate','park','again'),L.edge('d','gate','done','done'),L.edge('e','gate','done','limit-reached')]));
 const parent=await L.run(api,await L.publish(api,L.loop('Timed parent',[{id:'sub',kind:'subloop',label:'Await timed child',config:{loopRef:{loopId:childLoop,version:'latest'}}}])));const child=await L.until(async()=>(await api.get('/runs?parent='+parent.id)).items[0]);const first=await L.state(api,child.id,['waiting']);
 await L.sleep(2000);await api.post('/runs/'+child.id+'/input',{waitId:first.waiting.waitId,input:'first visit only'});const second=await L.until(async()=>{const s=await api.get('/runs/'+child.id);return s.waiting?.waitId!==first.waiting.waitId&&s.status==='waiting'?s:false;});
 await api.kill();api=await L.startApi('timer-restart',6635,{GG_TIMER_POLL_MS:'50'});const reopened=await api.get('/runs/'+child.id);
 L.check('hard restart preserves exact visit timeout identity',reopened.waiting.waitId===second.waiting.waitId && reopened.waiting.timeoutAt===second.waiting.timeoutAt,{second,reopened});
 await L.sleep(Math.max(0,Date.parse(first.waiting.timeoutAt)+300-Date.now()));const afterOldDeadline=await api.get('/runs/'+child.id);
 L.check('prior visit timeout cannot wake current visit',afterOldDeadline.status==='waiting' && afterOldDeadline.waiting.waitId===second.waiting.waitId,{first,second,afterOldDeadline});
 await api.kill();await L.sleep(Math.max(0,Date.parse(second.waiting.timeoutAt)+300-Date.now()));api=await L.startApi('timer-restart',6635,{GG_TIMER_POLL_MS:'50'});const done=await L.state(api,parent.id,['succeeded']);const ce=await L.events(api,child.id),pe=await L.events(api,parent.id);
 L.check('timeout elapsed offline wakes once and reuses exact child',ce.filter(e=>e.type==='node.finished'&&e.nodeId==='park').length===2 && pe.filter(e=>e.type==='child_run.started').length===1 && pe.filter(e=>e.type==='child_run.finished').length===1 && (await api.get('/runs?parent='+parent.id)).items.length===1,{ce,pe});
 E.details={parent,child,first,second,reopened,afterOldDeadline,done,childEvents:ce,parentEvents:pe};
}catch(error){E.error=String(error.stack);L.check('timer driver completed',false,E.error);}
finally{await L.cleanup();L.save('timer-results.json',{checks:L.checks,evidence:E});}
process.exitCode=L.checks.some(c=>!c.passed)?1:0;
