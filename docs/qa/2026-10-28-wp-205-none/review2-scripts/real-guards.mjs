import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import * as L from './lib.mjs';import {recipe} from './recipe.mjs';
const scratch=path.dirname(fileURLToPath(import.meta.url)),rec=new L.Recorder('real-guards'),{find,correct}=recipe(),updates=correct.split('\n').filter(l=>l.startsWith('UPDATE '));
for(const kind of ['catalog','failure','pinned']){
 const state=JSON.parse(fs.readFileSync(path.join(scratch,kind==='catalog'?'history-state.json':'missing-state.json'),'utf8')),dir=L.makeStore('real-guard-'+kind);
 fs.copyFileSync(path.join(state.store,'graphgoblin.db'),path.join(dir,'graphgoblin.db'));
 await L.withDb(dir,async db=>{
  if(kind==='catalog')await db.execute("UPDATE model_catalog SET efforts='not-json',default_effort='minimal' WHERE harness='codex' AND model='gpt-6-luna'");
  else if(kind==='failure')await db.execute({sql:"UPDATE runs SET pinned=json_set(pinned,'$.defaults.owner.byHarness.codex.effort','minimal'), failure='not-json' WHERE id=?",args:[state.runId]});
  else await db.execute({sql:"UPDATE runs SET pinned='not-json',failure=json_set(failure,'$.missingSession.effort','minimal') WHERE id=?",args:[state.runId]});
  const selected=(await db.execute(find)).rows;let error;try{await db.execute(updates[kind==='catalog'?2:3])}catch(e){error=e.message}
  rec.check('real current-schema '+kind+' independently reproduces unguarded SET read',error==='SQLITE_ERROR: malformed JSON',{selected,error});
 });
}
rec.finish();