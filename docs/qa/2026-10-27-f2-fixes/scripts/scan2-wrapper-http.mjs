// Copied from the PR #426 audit scan 2 record (wrapper-http.mjs, with order-cli.mjs as
// scan2-order-cli.mjs); only the fake CLI name, the temporary prefix and the output path changed.
// Run from the worktree root after `pnpm build`: node docs/qa/2026-10-27-f2-fixes/scripts/scan2-wrapper-http.mjs
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {createTestApp}=await import(pathToFileURL(resolve('apps/api/dist/testing/test-app.js')));
const {CodexHarness}=await import(pathToFileURL(resolve('packages/adapter-codex/dist/index.js')));
const {singleNodeLoop,FakeHarness}=await import(pathToFileURL(resolve('packages/engine/dist/testing/index.js')));
const inherited=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>v!==undefined&&!['NODE_OPTIONS','NODE_V8_COVERAGE','JEV_API_KEY','GG_JEV_API_KEY','LIVE'].includes(k)));
const rows=[];
for(const text of ['Thread not found in referenced input.','Error: invalid value for reasoning.effort.']) {
  const stderr=JSON.stringify({status:400,error:{type:'invalid_request_error',message:text,param:'reasoning.effort'}})+'\n';
  const codex=new CodexHarness({codexBinary:process.execPath,env:{...inherited,NODE_OPTIONS:`--import=${new URL('./scan2-order-cli.mjs',import.meta.url).href}`,GG_AUDIT_ORDER:JSON.stringify({order:'SEF',refusal:'both',exit:1,text,stderr})}});
  const ready=new FakeHarness();
  const t=await createTestApp({tempPrefix:'gg-f2fix-scan2-',harnesses:{codex:{id:'codex',preflight:()=>ready.preflight(),start:(...a)=>codex.start(...a),resume:(...a)=>codex.resume(...a)}}});
  try {
    const loop=await t.publishLoop(singleNodeLoop('HTTP duplicate refusal '+rows.length,{id:'work',kind:'inference',label:'Work',config:{model:'gpt-6-luna',effort:'low',prompt:{template:'Controlled provider-free request'}}}));
    const start=await t.app.inject({method:'POST',url:`/loops/${loop}/runs`,payload:{input:null}});
    assert.equal(start.statusCode,202,start.body);
    const id=start.json().run.id;await t.idle();
    const read=await t.app.inject(`/runs/${id}`);assert.equal(read.statusCode,200);
    const run=read.json();
    const resumed=await t.app.inject({method:'POST',url:`/runs/${id}/resume`,payload:{observedSeq:run.recovery.observedSeq}});
    rows.push({text,expected:{code:'HARNESS_TURN_FAILED',adapterCode:'HARNESS_ARGUMENTS_REJECTED',submission:'delivery-uncertain',message:`harness turn failed: The provider refused the request (HTTP 400, reasoning.effort): ${text}`},actual:run.failure,resumeStatus:resumed.statusCode,resumeBody:resumed.json(),recovery:run.recovery});
  } finally {await t.close();}
}
writeFileSync(new URL('../scan2-wrapper-http.log.txt',import.meta.url),JSON.stringify(rows,null,2)+'\n','utf8');
console.log(JSON.stringify(rows.map(x=>({text:x.text,actual:x.actual,resumeStatus:x.resumeStatus})),null,2));
// An intentionally failing assertion makes the remaining regression directly reproducible.
for(const row of rows) {
  assert.equal(row.actual.code,row.expected.code,'HTTP refusal must keep its pinned cause');
  assert.equal(row.actual.message,row.expected.message,'HTTP refusal must keep provider text');
  assert.equal(row.actual.inference.submission,row.expected.submission);
}
