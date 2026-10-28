import path from 'node:path';import {pathToFileURL} from 'node:url';import * as L from './lib.mjs';
const root=process.cwd(),rec=new L.Recorder('defaults-review');
const {createTestApp}=await import(pathToFileURL(path.join(root,'apps/api/dist/testing/test-app.js')));
const {createTestEngine}=await import(pathToFileURL(path.join(root,'packages/engine/dist/testing/scenario.js')));
const {FakeHarness}=await import(pathToFileURL(path.join(root,'packages/engine/dist/testing/fakes.js')));
const {DEFAULT_MODEL_CATALOG}=await import(pathToFileURL(path.join(root,'packages/infrastructure/dist/sqlite/settings.js')));
for(const [h,model] of [['codex','gpt-5.5'],['claude','claude-opus-5-5'],['claude','claude-fable-5-1'],['claude','claude-sonnet-5-5'],['claude','claude-haiku-5-5']]){
 const chosen={byHarness:{[h]:{model,effort:'none'}}};
 let error;try{const t=await createTestApp({tempPrefix:'gg-rev205-process-',env:{GG_DEFAULTS:JSON.stringify(chosen)}});await t.close()}catch(e){error=e.message}
 rec.check(model+' GG_DEFAULTS startup refuses unsupported none',error==='Invalid GG_DEFAULTS: The default reasoning effort is not supported by its model',error);
 for(const level of ['node','loop','owner','process']){
  const empty={byHarness:{}};
  const e=await createTestEngine({defaults:level==='process'?chosen:empty,ownerDefaults:()=>Promise.resolve(level==='owner'?chosen:empty)});
  e.ports.modelCatalog.entries.splice(0,e.ports.modelCatalog.entries.length,...DEFAULT_MODEL_CATALOG);
  const fake=new FakeHarness([],h);e.ports.harnesses[h]=fake;
  try{
   const d=L.single('runtime '+model+' '+level,L.inferenceNode('work',{harness:h,model,...(level==='node'?{effort:'none'}:{})}),level==='loop'?{defaults:chosen}:{});
   const run=await e.runToIdle(e.publish(d).loopId);
   const details={code:'EFFORT_UNSUPPORTED',path:'effort',...(level==='node'?{}:{level,harness:h})};
   rec.check(model+' '+level+' exact runtime details',run.failure?.code==='EVALUATION_INVALID_CONFIGURATION'&&JSON.stringify(run.failure.details)===JSON.stringify(details)&&fake.started.length===0,run.failure);
  }finally{e.manager.stop()}
 }
}
rec.finish();