// Existing-history migration fixture: real current-format runs are created through HTTP.
// With the gateway stopped, reverse only migration 0021 (two indexes + its ledger row),
// then let the built gateway apply its shipped migration on restart. No other schema/data
// is rewound. This exercises migration over existing history, not a build of main.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { makeTemp, removeTemp, startApi, restClient, cycle, until, logger, HERE, ROOT } from './lib.mjs';
const require=createRequire(join(ROOT,'packages/infrastructure/package.json'));
const {createClient}=require('@libsql/client');
const data=await makeTemp('migration'), log=logger('migration.log.txt'), result={checks:[]};let server,db;
const check=(name,ok,detail)=>{result.checks.push({name,ok,detail});log(ok?'PASS':'FAIL',name,detail);};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
try {
  server=await startApi({port:6619,dataDir:data,log});let api=restClient(server.url);
  const loop=await api.createLoop(cycle({name:'QA migration history',passes:20}));
  const done=await api.start(loop.loop.id);await until(async()=>(await api.run(done.id)).finalizedAt);
  const liveLoop=await api.createLoop(cycle({name:'QA migration paused history'}));
  const paused=await api.start(liveLoop.loop.id);await until(async()=>(await api.run(paused.id)).lastEventSeq>150);
  await api('POST',`/runs/${paused.id}/pause`,{});await api.waitStatus(paused.id,['paused']);
  await api('POST',`/runs/${paused.id}/resume`,{});await until(async()=>(await api.run(paused.id)).lastEventSeq>300);
  await api('POST',`/runs/${paused.id}/pause`,{});await api.waitStatus(paused.id,['paused']);
  const ids=[done.id,paused.id],before=[];
  for(const id of ids)before.push({id,observation:await api('GET',`/runs/${id}/observation`),thread:await api('GET',`/runs/${id}/thread`),events:await api.allEvents(id)});
  await server.kill();server=undefined;
  const url=`file:${join(data,'graphgoblin.db').replaceAll('\\','/')}`;db=createClient({url});
  const rows=async()=>Object.fromEntries(await Promise.all(['runs','run_events','run_threads','loop_versions'].map(async table=>{
    const exists=await db.execute({sql:"SELECT name FROM sqlite_master WHERE type='table' AND name=?",args:[table]});
    return [table,exists.rows.length?digest((await db.execute(`SELECT * FROM ${table} ORDER BY rowid`)).rows):null];
  })));
  const dataBefore=await rows();
  const ledgerBefore=(await db.execute('SELECT * FROM __drizzle_migrations ORDER BY created_at')).rows;
  await db.execute('DROP INDEX run_events_gate_idx');await db.execute('DROP INDEX run_events_fresh_session_idx');
  await db.execute('DELETE FROM __drizzle_migrations WHERE created_at=1793016584412');
  const beforeMigrationLedger=(await db.execute('SELECT * FROM __drizzle_migrations ORDER BY created_at')).rows;
  const indexesBefore=(await db.execute("SELECT name FROM sqlite_master WHERE type='index' AND name IN ('run_events_gate_idx','run_events_fresh_session_idx')")).rows;
  const unindexed={};
  for(const id of ids){
    const gates=await db.execute({sql:"SELECT seq,payload FROM run_events WHERE run_id=? AND type='decision.made' AND CASE WHEN json_valid(payload) THEN json_type(payload,'$.gate') IS NOT NULL ELSE 1 END ORDER BY seq DESC LIMIT 1",args:[id]});
    const fresh=await db.execute({sql:"SELECT seq,payload FROM run_events WHERE run_id=? AND type='run.resumed' AND CASE WHEN json_valid(payload) THEN json_type(payload,'$.freshSession') IS NOT NULL ELSE 1 END ORDER BY seq DESC LIMIT 20",args:[id]});
    unindexed[id]={gate:gates.rows,fresh:fresh.rows};
  }
  check('fixture has existing history, current format and exactly migration 0021 pending',before.every(x=>x.events.length>100)&&ledgerBefore.length===beforeMigrationLedger.length+1&&indexesBefore.length===0,{events:before.map(x=>({id:x.id,count:x.events.length})),ledgerBefore:ledgerBefore.length,ledgerAtUpgrade:beforeMigrationLedger.length,indexesBefore});
  db.close();db=undefined;
  server=await startApi({port:6619,dataDir:data,log});api=restClient(server.url);
  const after=[];for(const id of ids)after.push({id,observation:await api('GET',`/runs/${id}/observation`),thread:await api('GET',`/runs/${id}/thread`),events:await api.allEvents(id)});
  check('HTTP evidence, current threads and paged event reads unchanged after migration',isDeepStrictEqual(before,after),{runs:ids,observations:after.map(x=>({id:x.id,observation:x.observation})),beforeHash:digest(before),afterHash:digest(after),unindexed});
  await server.kill();server=undefined;db=createClient({url});
  const dataAfter=await rows(),ledgerAfter=(await db.execute('SELECT * FROM __drizzle_migrations ORDER BY created_at')).rows,indexesAfter=(await db.execute("SELECT name,sql FROM sqlite_master WHERE type='index' AND name IN ('run_events_gate_idx','run_events_fresh_session_idx') ORDER BY name")).rows;
  check('0021 reapplied once and existing data unchanged',indexesAfter.length===2&&isDeepStrictEqual(ledgerBefore,ledgerAfter)&&isDeepStrictEqual(dataBefore,dataAfter),{dataBefore,dataAfter,ledgerCount:ledgerAfter.length,indexesAfter});
  db.close();db=undefined;
  server=await startApi({port:6619,dataDir:data,log});await server.kill();server=undefined;db=createClient({url});
  check('second restart does not reapply migration',isDeepStrictEqual((await db.execute('SELECT * FROM __drizzle_migrations ORDER BY created_at')).rows,ledgerAfter),{ledgerCount:ledgerAfter.length});
}catch(e){result.error=String(e.stack??e);log('ERROR',result.error);}
finally{await server?.kill();db?.close();await removeTemp(data);result.ok=!result.error&&result.checks.every(x=>x.ok);await writeFile(join(HERE,'migration.json'),JSON.stringify(result,null,2)+'\n');await log.flush();}
