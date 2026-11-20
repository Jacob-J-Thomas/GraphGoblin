import fs from'node:fs/promises';import path from'node:path';import assert from'node:assert/strict';
const[root]=process.argv.slice(2),out=path.join(root,'records'),keys=['restored-delete','fresh-delete','unique-delete','both-owned-delete','description-control','target-rename'],assertions=[],results=[];let mapSamples=0;
const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);assertions.push(name);};
for(const key of keys){
 const result=JSON.parse(await fs.readFile(path.join(out,key+'-browser.json'),'utf8'));let continuation;
 if(result.status!=='complete'){continuation=JSON.parse(await fs.readFile(path.join(out,key+'-continuation.json'),'utf8'));check(key+' guarded continuation complete',continuation.status,'complete');check(key+' recovery equality guard',continuation.guardServerAndDeviceDefinitionEqual,true);check(key+' first attempt retained local success',result.checks.every(c=>c.passed),true);}
 const phase=name=>{const p=result.observations.find(o=>o.phase===name);assert.ok(p,key+' missing '+name);return p;};
 const initial=phase('server-original').server.definition;
 const before=key==='description-control'?initial:phase('before-structural-operation').device.definition;
 const expected=structuredClone(before);
 if(key.endsWith('-delete')){expected.nodes=before.nodes.filter(n=>n.id!=='done');expected.edges=before.edges.filter(e=>e.from.node!=='done'&&e.to.node!=='done');}
 else if(key==='description-control')expected.description='Unrelated topology QA description';
 else{expected.nodes=before.nodes.map(n=>n.id==='done'?{...n,id:'completed'}:n);expected.edges=before.edges.map(e=>({...e,from:e.from.node==='done'?{...e.from,node:'completed'}:e.from,to:e.to.node==='done'?{...e.to,node:'completed'}:e.to}));}
 const changed=phase('changed'),undo=phase('undo'),redo=phase('redo'),offline=phase('offline-device-reloaded');
 check(key+' changed exact intended physical definition',changed.device.definition,expected);check(key+' exact Undo',undo.device.definition,before);check(key+' exact Redo',redo.device.definition,expected);check(key+' Redo ownership',redo.device.decisionRoutes,changed.device.decisionRoutes);check(key+' offline persisted definition',offline.device.definition,expected);check(key+' offline persisted ownership',offline.device.decisionRoutes,changed.device.decisionRoutes);
 const end=continuation?continuation.observations:result.observations;for(const p of end.filter(o=>['saved','server-reloaded','after-explicit-device-copy-recovery'].includes(o.phase))){check(key+' '+p.phase+' API status',p.server.status,200);check(key+' '+p.phase+' exact persisted API definition',p.server.definition,expected);}
 check(key+' server reload exists',end.some(o=>o.phase==='server-reloaded'),true);
 if(key.endsWith('-delete')){const rows=changed.device.decisionRoutes.pick.rows;check(key+' yes emptied',rows[0].edgeIds,[]);check(key+' maybe emptied',rows[2].edgeIds,[]);check(key+' survivor claim',rows[1].edgeIds,key==='both-owned-delete'?['e1']:[]);check(key+' survivor physical port/target/geometry',changed.device.definition.edges[1],before.edges[2]);}
 if(key==='restored-delete'){const fixture=phase('restoration-fixture');check(key+' own captured map',fixture.ownMetadataPresent,true);check(key+' old contested claims',fixture.decisionRoutes.pick.rows.map(r=>r.edgeIds),[['e1'],['e1'],['m1']]);check(key+' repair keeps exact original physical records',phase('repaired-before-structural-operation').device.definition.edges,fixture.definition.edges);}
 for(const o of result.observations){if(o.device?.synced===false){check(key+' '+o.phase+' own nonempty map',Object.hasOwn(o.device,'decisionRoutes')&&Array.isArray(o.device.decisionRoutes?.pick?.rows)&&o.device.decisionRoutes.pick.rows.length===3,true);for(const row of o.device.decisionRoutes.pick.rows){assert.equal(typeof row.key,'number');assert.equal(typeof row.id,'string');assert.ok(Array.isArray(row.edgeIds));}mapSamples++;}}
 results.push({case:key,firstAttempt:result.status,continuation:continuation?.status??null,localChecks:result.checks.length,localPassed:result.checks.filter(c=>c.passed).length,requests:result.requests.length});
}
const record={status:'pass',cases:results,mapSamples,assertionsPassed:assertions.length,assertions};await fs.writeFile(path.join(out,'independent-replay.json'),JSON.stringify(record,null,2));console.log(JSON.stringify({status:record.status,cases:results.length,mapSamples,assertionsPassed:assertions.length,firstAttemptComplete:results.filter(r=>r.firstAttempt==='complete').length}));
