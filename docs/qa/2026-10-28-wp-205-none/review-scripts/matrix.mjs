import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import * as L from './lib.mjs';
const root=process.cwd(), rec=new L.Recorder('matrix-review');
const {createTestApp}=await import(pathToFileURL(path.join(root,'apps/api/dist/testing/test-app.js')));
const {FakeHarness}=await import(pathToFileURL(path.join(root,'packages/engine/dist/testing/fakes.js')));
const {codexEffortName}=await import(pathToFileURL(path.join(root,'packages/adapter-codex/dist/effort-names.js')));
const families=[{prefix:'gpt-6',none:'minimal'}];
for(const [model,expected] of [['gpt-6','minimal'],['gpt-6-luna','minimal'],['gpt-6.1-sol','minimal'],['gpt-60','none'],['gpt-6x','none'],['house','none']])rec.check('whole segment '+model,codexEffortName(model,'none',families)===expected,{expected,actual:codexEffortName(model,'none',families)});
for(const [h,model] of [['codex','gpt-5.5'],['claude','claude-opus-5-5'],['claude','claude-fable-5-1'],['claude','claude-sonnet-5-5'],['claude','claude-haiku-5-5']]){
 const codex=new FakeHarness(), claude=new FakeHarness([],'claude'),t=await createTestApp({tempPrefix:'gg-rev205-matrix-',harnesses:{codex,claude}});
 const d=e=>L.single('matrix '+model,L.inferenceNode('work',{harness:h,model,effort:e}));
 const call=(url,method,payload)=>t.app.inject({url,method,...(payload?{payload}:{})});
 const refused=(r,status)=>r.statusCode===status&&r.body.includes('EFFORT_UNSUPPORTED');
 try{
  rec.check(model+' create',refused(await call('/loops','POST',{definition:d('none')}),400));
  const loopId=await t.publishLoop(d('low'));
  rec.check(model+' save draft',refused(await call(`/loops/${loopId}/draft`,'PUT',{definition:d('none')}),400));
  rec.check(model+' validate',refused(await call(`/loops/${loopId}/validate`,'POST',{definition:d('none')}),200));
  const defaults={byHarness:{[h]:{model,effort:'none'}}};
  rec.check(model+' owner defaults',refused(await call('/settings','PUT',{defaults}),400));
  const inherited=L.single('defaults '+model,L.inferenceNode('work',{harness:h,model}),{defaults});
  rec.check(model+' loop defaults',refused(await call('/loops','POST',{definition:inherited}),400));
  const row=await t.container.repos.catalog.findOne(h,model);await t.container.repos.catalog.upsert({...row,efforts:['none',...row.efforts]});
  const stored=await call('/loops','POST',{definition:d('none')}), storedId=stored.json().loop.id;
  const pinnedId=await t.publishLoop(d('none'));
  await t.container.repos.catalog.seed();
  rec.check(model+' publish stored unsupported effort',refused(await call(`/loops/${storedId}/publish`,'POST'),422));
  const start=await call(`/loops/${pinnedId}/runs`,'POST',{input:null});await t.idle();
  const run=(await t.app.inject(`/runs/${start.json().run.id}`)).json();
  rec.check(model+' pinned run rejects without provider request',run.failure?.code==='EVALUATION_INVALID_CONFIGURATION'&&JSON.stringify(run.failure.details)===JSON.stringify({code:'EFFORT_UNSUPPORTED',path:'effort'})&&codex.started.length===0&&claude.started.length===0,run.failure);
 }finally{await t.close()}
 // GG_DEFAULTS is refused at startup (not an HTTP problem).
 let error;try{const target=await createTestApp({tempPrefix:'gg-rev205-process-',env:{GG_DEFAULTS:JSON.stringify({byHarness:{[h]:{model,effort:'none'}}})}});await target.close()}catch(e){error=e.message}
 rec.check(model+' GG_DEFAULTS startup refusal',error?.startsWith('Invalid GG_DEFAULTS:')&&error.includes('none'),error);
}
rec.finish();