import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import * as L from './lib.mjs';import {recipe} from './recipe.mjs';
const scratch=path.dirname(fileURLToPath(import.meta.url)),rec=new L.Recorder('real-positive'),{find,correct}=recipe();
for(const kind of ['catalog','failure','pinned']){
 const state=JSON.parse(fs.readFileSync(path.join(scratch,kind==='catalog'?'history-state.json':'missing-state.json'),'utf8'));
 await L.withDb(state.store,db=>db.execute('PRAGMA wal_checkpoint(TRUNCATE)'));
 const dir=L.makeStore('real-positive-'+kind);fs.copyFileSync(path.join(state.store,'graphgoblin.db'),path.join(dir,'graphgoblin.db'));
 await L.withDb(dir,async db=>{
  if(kind==='catalog')await db.execute("UPDATE model_catalog SET efforts='not-json',default_effort='minimal' WHERE harness='codex' AND model='gpt-6-luna'");
  else if(kind==='failure')await db.execute({sql:"UPDATE runs SET pinned=json_set(pinned,'$.defaults.owner.byHarness.codex.effort','minimal'), failure='not-json' WHERE id=?",args:[state.runId]});
  else await db.execute({sql:"UPDATE runs SET pinned='not-json',failure=json_set(failure,'$.missingSession.effort','minimal') WHERE id=?",args:[state.runId]});
  const before=(await db.execute(find)).rows;rec.check(kind+' SELECT exposes damaged column and valid minimal sibling',before.some(r=>r.place==='unreadable')&&before.some(r=>r.place===(kind==='catalog'?'model_catalog':'runs')));
  await db.executeMultiple(correct);
  const r=(await db.execute(kind==='catalog'?"SELECT efforts AS damaged, default_effort AS fixed FROM model_catalog WHERE harness='codex' AND model='gpt-6-luna'":{sql:kind==='failure'?"SELECT failure AS damaged,json_extract(pinned,'$.defaults.owner.byHarness.codex.effort') AS fixed FROM runs WHERE id=?":"SELECT pinned AS damaged,json_extract(failure,'$.missingSession.effort') AS fixed FROM runs WHERE id=?",args:[state.runId]})).rows[0];
  rec.check(kind+' damaged bytes preserved, valid sibling corrected',r.damaged==='not-json'&&r.fixed==='none',r);
  const after=(await db.execute(find)).rows;rec.check(kind+' only unreadable remains',after.length===1&&after[0].place==='unreadable',{after});
 });
}
const result=rec.finish();if(result.failed)process.exitCode=1;
