import assert from 'node:assert/strict';
import fs from 'node:fs';
const evidence=key=>JSON.parse(fs.readFileSync(new URL(key+'.result.json',import.meta.url),'utf8')).result;
const [wait, additional, routes, dynamic, geometry] = ['union-wait','union-additional','outputs','outputs-dynamic','geometry'].map(n=>JSON.parse(evidence(n)));
assert.equal(wait.rows[0].visible.timeout,'173');
assert.equal(wait.rows[1].visible.timeout,'');
assert.deepEqual(wait.rows[1].visible.onTimeout,['continue']);
assert.equal(wait.rows[2].saved.seconds,13);
assert.equal(wait.rows[3].saved.timeoutSeconds,59);
assert.equal(wait.rows[4].visible.timeout,'');
assert.deepEqual(wait.rows[5].saved,wait.rows[6].saved);
assert.deepEqual(wait.puts.map(x=>x.body.definition.nodes.find(n=>n.id==='subject').config),[
 {mode:'duration',seconds:13},{mode:'duration',seconds:13,timeoutSeconds:59},{mode:'signal',name:'i08-signal'}
]);
assert.equal(additional.decision.immediate.instructions.trim(),'');
assert.equal(additional.decision.immediate.oldSourceControlCount,0);
assert.equal(additional.decision.afterSave.instructions,additional.decision.saved.instructions);
assert.deepEqual(additional.decision.saved,additional.decision.reloaded.config);
assert.equal(additional.decision.before.maxPasses,additional.decision.saved.maxPasses);
assert.deepEqual(additional.decision.before.routes,additional.decision.saved.routes);
assert.equal(additional.mutate.immediate,'');
assert.deepEqual(additional.mutate.saved.operations,[{op:'delete',path:'/vars/new-probe'}]);
assert.deepEqual(additional.mutate.saved,additional.mutate.reloaded.config);
assert.equal(additional.errors.length,0);
assert.equal(routes.length,5);
assert.equal(routes.flatMap(r=>r.attempts).length,15);
for(const r of routes){
 assert.equal(r.error,undefined);
 assert.deepEqual(r.modal.map(p=>p.id),r.before.ports.map(p=>p.id));
 for(const a of r.attempts) assert(a.saved&&a.renderedSaved);
 assert.deepEqual(r.beforeReload.edges,r.afterReload.edges);
 assert.equal(r.puts.length,r.attempts.length);
 assert.deepEqual(r.beforeReload.device.definition.edges,r.afterReload.edges);
 assert.equal(r.modalAfter.free.length,0);
}
assert.equal(dynamic.error,undefined);
for(const a of dynamic.attempts) assert(a.saved&&a.rendered.some(e=>e.id===a.saved.id));
assert(dynamic.invalid.canvas.includes('Bad ID')&&dynamic.invalid.modal.includes('Bad ID'));
assert.match(dynamic.invalid.refusal[0],/Finish a unique, valid route ID/);
assert(!dynamic.invalid.saved.some(e=>e.from.port==='Bad ID'));
assert.equal(dynamic.reload.edges.length,5);
assert.equal(geometry.length,2);
for(const item of geometry){
 assert.equal(item.error,undefined);
 assert.notDeepEqual(item.before.server.positions.exhausted,item.edited.device.positions.exhausted);
 assert.equal(item.edited.device.routes['start-work'].length,3);
 assert.equal(item.edited.device.routes.return.length,3);
 assert.deepEqual(item.edited.device,item.reloaded.device);
 assert.deepEqual(item.edited.rendered,item.reloaded.rendered);
 assert.deepEqual(item.edited.device,item.puts.at(-1));
 if(item.mode==='server')assert.deepEqual(item.edited.device,item.reloaded.server);
 else {
  assert.deepEqual(item.before.server,item.reloaded.server);
  assert.deepEqual(item.edited.device,item.recovered.server);
 }
}
console.log(JSON.stringify({verified:true,unionPaths:3,validDecisionDrags:18,geometryPaths:2,
 decisionTypes:routes.map(r=>({kind:r.kind,ports:r.before.ports.map(p=>p.id)})),invalidIdAccuratelyRefused:true},null,2));
