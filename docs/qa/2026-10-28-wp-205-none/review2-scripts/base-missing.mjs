import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import * as L from './lib.mjs';
const scratch=path.dirname(fileURLToPath(import.meta.url)),base=path.join(scratch,'base'),rec=new L.Recorder('missing-base-review');
const {createTestApp}=await import(pathToFileURL(path.join(base,'apps/api/dist/testing/test-app.js')));
const store=fs.mkdtempSync(path.join(os.tmpdir(),'gg-rev205b-missing-'));
const t=await createTestApp({tempPrefix:'gg-rev205b-missing-helper-',env:{GG_DATA_DIR:store,GG_DB_URL:'file:'+path.join(store,'graphgoblin.db').replaceAll('\\','/')}});
try{
 const row=await t.container.repos.catalog.findOne('codex','gpt-6-luna');await t.container.repos.catalog.upsert({...row,efforts:['minimal',...row.efforts]});
 t.harness.script([{items:[]},{announceSession:false,accepted:false,submission:'session-missing',items:[],error:{code:'HARNESS_SESSION_MISSING',message:'Controlled missing session'}}]);
 const first=L.inferenceNode('first',{model:'gpt-6-luna',effort:'minimal'}),second=L.inferenceNode('second',{model:'gpt-6-luna',effort:'minimal'});second.config.session={policy:'resume-previous'};
 const loopId=await t.publishLoop(L.loop('Base missing session',[first,second],[L.edge('e1','start','first'),L.edge('e2','first','second'),L.edge('e3','second','done')]));
 const start=await t.app.inject({method:'POST',url:`/loops/${loopId}/runs`,payload:{input:null}});if(start.statusCode!==202)throw new Error(start.body);await t.idle();
 const runId=start.json().run.id,run=(await t.app.inject(`/runs/${runId}`)).json();
 rec.check('base stores missing-session evidence at minimal',run.failure?.missingSession?.effort==='minimal',run.failure);
 fs.writeFileSync(path.join(scratch,'missing-state.json'),JSON.stringify({store,runId,loopId}));
}finally{await t.close()}
rec.finish();