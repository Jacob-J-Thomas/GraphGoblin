import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';
const scratch=path.dirname(fileURLToPath(import.meta.url)), root=process.cwd(), base=path.join(scratch,'base');
const {createTestApp}=await import(pathToFileURL(path.join(base,'apps/api/dist/testing/test-app.js')));
const L=await import('./lib.mjs');
const store=fs.mkdtempSync(path.join(os.tmpdir(),'gg-rev205c-history-'));
const t=await createTestApp({tempPrefix:'gg-rev205c-base-helper-',env:{GG_DATA_DIR:store,GG_DB_URL:'file:'+path.join(store,'graphgoblin.db').replaceAll('\\','/')}});
try{
 const row=await t.container.repos.catalog.findOne('codex','gpt-6-luna');await t.container.repos.catalog.upsert({...row,efforts:['minimal',...row.efforts]});
 const settings=await t.app.inject({method:'PUT',url:'/settings',payload:{defaults:{byHarness:{codex:{model:'gpt-6-luna',effort:'minimal'}}}}});if(settings.statusCode!==200)throw new Error(settings.body);
 const loopId=await t.publishLoop(L.single('Review base historical minimal',L.inferenceNode('work',{model:'gpt-6-luna',effort:'minimal'})));
 const start=await t.app.inject({method:'POST',url:`/loops/${loopId}/runs`,payload:{input:null}});if(start.statusCode!==202)throw new Error(start.body);await t.idle();
 const runId=start.json().run.id, run=(await t.app.inject(`/runs/${runId}`)).json();
 const events=(await t.app.inject(`/runs/${runId}/events`)).json();
 console.log('BASE_HISTORY',JSON.stringify({status:run.status,events:events.items.map(e=>({seq:e.seq,type:e.type,payload:e.type==='harness.session'?e.payload:undefined}))}));
 fs.writeFileSync(path.join(scratch,'history-state.json'),JSON.stringify({store,loopId,runId}));
}finally{await t.close()}