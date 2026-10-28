import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import * as L from './lib.mjs';
const scratch=path.dirname(fileURLToPath(import.meta.url)), {store,runId}=JSON.parse(fs.readFileSync(path.join(scratch,'missing-state.json'),'utf8'));
const rec=new L.Recorder('missing-head-review'), first=fs.readFileSync(path.join(L.ROOT,'CHANGELOG.md'),'utf8').split('\n').find(l=>l.startsWith('- Effort `none`'));
const select=first.match(/`(SELECT 'loop_versions'[^`]+);`/)[1], fixes=[...first.matchAll(/`(UPDATE [^`]+);`/g)].map(m=>m[1]);
await L.withDb(store,async db=>{
 rec.log('Exact CHANGELOG SELECT before hand fixes',(await db.execute(select)).rows);
 for(const sql of fixes)rec.log('Exact CHANGELOG UPDATE',{sql,changed:(await db.execute(sql)).rowsAffected});
 const remaining=(await db.execute(select)).rows;
 const events=(await db.execute(`SELECT run_id, seq, type, payload FROM run_events WHERE payload LIKE '%"minimal"%'`)).rows;
 rec.check('CHANGELOG inventory reports no rows after its fixes',remaining.length===0,remaining);
 rec.log('Historical events omitted by CHANGELOG SELECT',events);
});
const g=await L.startGateway({dir:store,port:6363,label:'historical-events-head',rec});
try{
 for(const route of [`/runs/${runId}`,`/runs/${runId}/events`,`/runs/${runId}/thread`])rec.log('Head read after documented hand fixes',{route,...L.problemOf(await g.call(route))});
}finally{await g.stop();g.copyLog('missing-head-review-gateway.log.txt')}
rec.finish({realProviderTurns:0});