import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import * as L from './lib.mjs';import {recipe} from './recipe.mjs';
const scratch=path.dirname(fileURLToPath(import.meta.url)),rec=new L.Recorder('own-history'),{find,correct}=recipe();
for(const name of ['history','missing']){
 const {store,runId}=JSON.parse(fs.readFileSync(path.join(scratch,`${name}-state.json`),'utf8'));
 await L.withDb(store,async db=>{
  const expected=[];
  for(const r of (await db.execute(`SELECT id,status FROM loop_versions WHERE definition LIKE '%"minimal"%'`)).rows)expected.push(`loop_versions|${r.id} ${r.status}`);
  for(const r of (await db.execute(`SELECT key FROM settings WHERE value LIKE '%"minimal"%'`)).rows)expected.push(`settings|${r.key}`);
  for(const r of (await db.execute(`SELECT harness,model FROM model_catalog WHERE efforts LIKE '%"minimal"%' OR default_effort='minimal'`)).rows)expected.push(`model_catalog|${r.harness}/${r.model}`);
  for(const r of (await db.execute(`SELECT id FROM runs WHERE pinned LIKE '%"minimal"%' OR failure LIKE '%"minimal"%'`)).rows)expected.push(`runs|${r.id}`);
  for(const r of (await db.execute(`SELECT run_id,seq,type FROM run_events WHERE payload LIKE '%"minimal"%'`)).rows)expected.push(`run_events|${r.run_id}#${r.seq} ${r.type}`);
  for(const r of (await db.execute(`SELECT run_id,node_id,attempt FROM harness_sessions WHERE effort='minimal'`)).rows)expected.push(`harness_sessions|${r.run_id}/${r.node_id}/${r.attempt}`);
  const actual=(await db.execute(find)).rows.map(r=>`${r.place}|${r.ref}`);
  rec.check(name+' SELECT finds every base-written typed row',JSON.stringify(expected.sort())===JSON.stringify(actual.sort()),{expected,actual});
  const trigger=(await db.execute("SELECT sql FROM sqlite_master WHERE name='loop_versions_snapshot_immutable'")).rows[0].sql;
  await db.executeMultiple(correct);
  rec.check(name+' SELECT empty after complete CHANGELOG recipe',(await db.execute(find)).rows.length===0);
  const restored=(await db.execute("SELECT sql FROM sqlite_master WHERE name='loop_versions_snapshot_immutable'")).rows[0].sql;
  rec.check(name+' snapshot trigger restored byte-identically',trigger===restored);
 });
 const g=await L.startGateway({dir:store,port:name==='history'?6362:6363,label:name+'-fixed',rec});
 try{
  rec.check(name+' head starts',g.failedStart===undefined);
  for(const route of [`/runs/${runId}`,`/runs/${runId}/events?limit=1000`,`/runs/${runId}/thread`]){const r=await g.call(route);rec.check(name+' read '+route,r.status===200,L.problemOf(r));}
 }finally{await g.stop();g.copyLog('own-'+name+'-gateway.log.txt')}
}
rec.finish();