import {register} from 'node:module';
register('./baseline-loader.mjs',import.meta.url);
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const built=p=>import(pathToFileURL(join(process.env.GG_QA_ROOT,'baseline-main',p)).href);
const {createContainer,buildApp,loadConfig}=await built('apps/api/dist/index.js');
const {minimalLoop}=await built('packages/contracts/dist/testing/index.js');
const dataDir=await mkdtemp(join(tmpdir(),'gg-audit-422r3-definition-'));
const c=await createContainer(loadConfig({GG_DATA_DIR:dataDir,GG_REQUIRE_API_KEY:'false',GG_MASTER_KEY:Buffer.alloc(32,9).toString('base64')}),{startTimers:false});
await c.start();
const app=await buildApp(c,{logger:false});
const results=[];
try{
 const created=await app.inject({method:'POST',url:'/loops',payload:{definition:minimalLoop()}});
 assert.equal(created.statusCode,201);
 const loopId=created.json().loop.id;
 assert.equal((await app.inject({method:'POST',url:`/loops/${loopId}/publish`})).statusCode,200);
 const started=await app.inject({method:'POST',url:`/loops/${loopId}/runs`,payload:{}});
 assert.equal(started.statusCode,202);
 const run=started.json().run;
 await c.manager.waitForIdle();
 const before=(await app.inject(`/runs/${run.id}`)).json();
 const original=(await c.handle.client.execute({sql:'SELECT definition FROM loop_versions WHERE id=?',args:[run.versionId]})).rows[0].definition;
 for(const bad of ['{}','{']){
   await c.handle.client.execute({sql:'UPDATE loop_versions SET definition=? WHERE id=?',args:[bad,run.versionId]});
   const responses=[];
   for(const action of ['read']){
     const response=await app.inject(action==='read'?`/runs/${run.id}`:{method:'POST',url:`/runs/${run.id}/${action}`,payload:{observedSeq:before.recovery.observedSeq,...(action==='replay'?{nodeId:'start'}:{})}});
     responses.push({action,status:response.statusCode,body:response.json()});
   }
   results.push({storedDefinition:bad,responses});
 }
 await c.handle.client.execute({sql:'UPDATE loop_versions SET definition=? WHERE id=?',args:[original,run.versionId]});
}finally{await app.close();await c.dispose();}
await writeFile(join(dirname(fileURLToPath(import.meta.url)),'unreadable-definition-baseline-results.json'),JSON.stringify(results,null,2)+'\n','utf8');
console.log(JSON.stringify(results.map(r=>({storedDefinition:r.storedDefinition,responses:r.responses.map(s=>({action:s.action,status:s.status,code:s.body.code??s.body.recovery?.resume?.code}))}))));
