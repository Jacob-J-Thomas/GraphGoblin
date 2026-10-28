import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import * as L from './lib.mjs';
const scratch=path.dirname(fileURLToPath(import.meta.url)),{store,runId}=JSON.parse(fs.readFileSync(path.join(scratch,'history-state.json'),'utf8')),rec=new L.Recorder('history-fix-review');
await L.withDb(store,async db=>{
 for(const table of (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")).rows.map(r=>r.name))for(const col of (await db.execute(`PRAGMA table_info("${table}")`)).rows){if(col.type!=='TEXT')continue;const r=await db.execute({sql:`SELECT count(*) n FROM "${table}" WHERE "${col.name}" LIKE ?`,args:['%minimal%']});if(r.rows[0].n)rec.log('remaining stored minimal text',{table,column:col.name,rows:r.rows[0].n});}
 rec.log('session effort rows',(await db.execute("SELECT run_id,node_id,effort FROM harness_sessions WHERE effort='minimal'")).rows);
 for(const level of ['owner','process'])for(const h of ['codex','claude']){const p=`$.pinned.defaults.${level}.byHarness.${h}.effort`;const r=await db.execute({sql:"UPDATE run_events SET payload=json_set(payload, ?, 'none') WHERE type='run.queued' AND json_extract(payload, ?)='minimal'",args:[p,p]});if(r.rowsAffected)rec.log('hand correction run.queued',{path:p,rows:r.rowsAffected});}
 rec.log('hand correction harness.session',{rows:(await db.execute("UPDATE run_events SET payload=json_set(payload, '$.effort', 'none') WHERE type='harness.session' AND json_extract(payload, '$.effort')='minimal'")).rowsAffected});
 rec.log('hand correction harness_sessions',{rows:(await db.execute("UPDATE harness_sessions SET effort='none' WHERE effort='minimal'")).rowsAffected});
});
const g=await L.startGateway({dir:store,port:6363,label:'history-events-fixed',rec});
try{const r=await g.call(`/runs/${runId}/events`);rec.check('hand correction of canonical effort fields restores events read',r.status===200,{...L.problemOf(r),items:r.json.items?.length});}finally{await g.stop();g.copyLog('history-fix-review-gateway.log.txt')}
rec.finish();