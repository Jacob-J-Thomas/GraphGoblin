import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import * as L from './lib.mjs';
const scratch=path.dirname(fileURLToPath(import.meta.url)),{store,runId}=JSON.parse(fs.readFileSync(path.join(scratch,'missing-state.json'),'utf8')),rec=new L.Recorder('missing-fix-review');
await L.withDb(store,async db=>{
 rec.log('unlisted stored run failure',(await db.execute({sql:"SELECT id,json_extract(failure,'$.missingSession.effort') effort FROM runs WHERE id=?",args:[runId]})).rows);
 for(const sql of ["UPDATE runs SET failure=json_set(failure, '$.missingSession.effort', 'none') WHERE json_extract(failure, '$.missingSession.effort')='minimal'","UPDATE run_events SET payload=json_set(payload, '$.failure.missingSession.effort', 'none') WHERE type='run.failed' AND json_extract(payload, '$.failure.missingSession.effort')='minimal'","UPDATE run_events SET payload=json_set(payload, '$.effort', 'none') WHERE type='harness.session' AND json_extract(payload, '$.effort')='minimal'","UPDATE harness_sessions SET effort='none' WHERE effort='minimal'"])rec.log('narrow manual correction',{sql,rows:(await db.execute(sql)).rowsAffected});
});
const g=await L.startGateway({dir:store,port:6363,label:'missing-fixed',rec});
try{for(const route of [`/runs/${runId}`,`/runs/${runId}/events`,`/runs/${runId}/thread`]){const r=await g.call(route);rec.check('restored '+route,r.status===200,L.problemOf(r));}}finally{await g.stop();g.copyLog('missing-fix-review-gateway.log.txt')}
rec.finish();