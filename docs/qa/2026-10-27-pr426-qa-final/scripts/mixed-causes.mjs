import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const load = (path) => import(pathToFileURL(resolve(path)));
const { CodexHarness } = await load('packages/adapter-codex/dist/index.js');
const { createTestApp } = await load('apps/api/dist/testing/test-app.js');
const { singleNodeLoop, FakeHarness } = await load('packages/engine/dist/testing/index.js');
const inherited = Object.fromEntries(Object.entries(process.env).filter(([k,v]) => v !== undefined && !k.toUpperCase().startsWith("GG_") && !['NODE_OPTIONS','NODE_V8_COVERAGE','JEV_API_KEY','GG_JEV_API_KEY','LIVE'].includes(k)));
const provider = (status, type, message, param) => JSON.stringify({status,error:{type,message,...(param ? {param}: {})}});
const refusalA = provider(400,'invalid_request_error','Effort A refused','reasoning.effort');
const refusalB = provider(400,'invalid_request_error','Schema B refused','response_format');
const missing = provider(404,'not_found_error','No rollout found with id genuinely-new-session');
const quota = provider(429,'insufficient_quota','Capacity unavailable');
const rate = provider(429,'rate_limit_exceeded','Capacity unavailable');
const auth = provider(401,'authentication_error','Credentials expired');
const misleadingRefusal = provider(400,'invalid_request_error','Thread not found in referenced input.','reasoning.effort');
const cases = [
  {name:'different-pinned-refusal-alone', first:refusalA, stderr:refusalB, expected:'Schema B refused'},
  {name:'repeat-then-different-pinned-refusal', first:refusalA, stderr:refusalA+'\n'+refusalB, expected:'Schema B refused'},
  {name:'missing-session-alone', first:refusalA, stderr:missing, expectedCode:'HARNESS_SESSION_MISSING'},
  {name:'repeat-then-missing-session-json', first:refusalA, stderr:refusalA+'\n'+missing, expectedCode:'HARNESS_SESSION_MISSING'},
  {name:'repeat-then-missing-session-text', first:refusalA, stderr:refusalA+'\nNo rollout found with id genuinely-new-session', expectedCode:'HARNESS_SESSION_MISSING'},
  {name:'quota-then-auth-alone', first:quota, stderr:auth, expectedCode:'HARNESS_NOT_AUTHENTICATED'},
  {name:'quota-repeat-then-auth', first:quota, stderr:quota+'\n'+auth, expectedCode:'HARNESS_NOT_AUTHENTICATED'},
  {name:'rate-then-quota-same-message', first:rate, stderr:quota, expectedRetriable:false},
  {name:'quota-then-rate-same-message', first:quota, stderr:rate, expectedRetriable:true},
  {name:'prefixed-repeat-without-completion', first:misleadingRefusal, stderr:'ERROR: '+misleadingRefusal, expectedCode:'HARNESS_ARGUMENTS_REJECTED'},
  {name:'prefixed-repeat-completion-before-failure', first:misleadingRefusal, stderr:'ERROR: '+misleadingRefusal, order:'SCF', expectedCode:'HARNESS_ARGUMENTS_REJECTED'},
  {name:'prefixed-repeat-completion-after-failure', first:misleadingRefusal, stderr:'ERROR: '+misleadingRefusal, order:'SFC', expectedCode:'HARNESS_ARGUMENTS_REJECTED'},
];
function input(c) {
  return {events:[{type:'thread.started',thread_id:'r3-thread'},...[...(c.order ?? 'SF')].map(s=>s==='S'?{type:'turn.started'}:s==='C'?{type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,cache_write_input_tokens:0,output_tokens:1,reasoning_output_tokens:0}}:{type:'turn.failed',error:{message:c.first}})],stderr:c.stderr,exit:1};
}
const rows=[];
for (const c of cases) {
  const spec=input(c);
  const harness = new CodexHarness({codexBinary:process.execPath,env:{...inherited,NODE_OPTIONS:`--import=${new URL('./fixture-cli.mjs',import.meta.url).href}`,GG_AUDIT_SPEC:JSON.stringify(spec)}});
  const session=harness.start({workingDirectory:process.cwd(),model:'gpt-6-luna',effort:'low',options:{sandbox:'read-only',approval:'never'},turn:{prompt:'Controlled audit request'}},new AbortController().signal);
  const events=[];for await(const e of session.events) events.push(e);
  let actual;try {await session.result;} catch(e) {actual={code:e.code,message:e.message,retriable:e.retriable,submission:e.submission};}
  const pass=Boolean(actual) && (!c.expected || actual.message.includes(c.expected)) && (!c.expectedCode || actual.code===c.expectedCode) && (c.expectedRetriable===undefined || actual.retriable===c.expectedRetriable);
  rows.push({...c,actual,pass,events});
}
// Persist the externally visible effects through real REST handlers and disposable SQLite.
const http=[];
for(const c of cases.filter(c=>['repeat-then-different-pinned-refusal','repeat-then-missing-session-json','quota-repeat-then-auth','prefixed-repeat-completion-before-failure','prefixed-repeat-completion-after-failure'].includes(c.name))) {
  const spec=input(c);
  const native=new CodexHarness({codexBinary:process.execPath,env:{...inherited,NODE_OPTIONS:`--import=${new URL('./fixture-cli.mjs',import.meta.url).href}`,GG_AUDIT_SPEC:JSON.stringify(spec)}});
  const ready=new FakeHarness();
  const t=await createTestApp({tempPrefix:'gg-qa-426f-scan3-mixed-',harnesses:{codex:{id:'codex',preflight:()=>ready.preflight(),start:(...a)=>native.start(...a),resume:(...a)=>native.resume(...a)}}});
  try {
    const loop=await t.publishLoop(singleNodeLoop(c.name,{id:'work',kind:'inference',label:'Work',config:{model:'gpt-6-luna',effort:'low',prompt:{template:'Exact authored task'}}}));
    const start=await t.app.inject({method:'POST',url:`/loops/${loop}/runs`,payload:{input:null}});assert.equal(start.statusCode,202,start.body);
    await t.idle();const run=(await t.app.inject(`/runs/${start.json().run.id}`)).json();
    const resume=run.recovery.resume.allowed ? {notInvoked:'would repeat the controlled error'} : await t.app.inject({method:'POST',url:`/runs/${run.id}/resume`,payload:{observedSeq:run.recovery.observedSeq}});
    http.push({name:c.name,failure:run.failure,recovery:run.recovery,resume:resume.statusCode ?? resume});
  } finally {await t.app.close(); await t.container.dispose(); /* retain disposable directory; no deletion */}
}
writeFileSync(new URL('../mixed-causes.log.txt',import.meta.url),JSON.stringify({rows,http},null,2)+'\n','utf8');
console.log(JSON.stringify({rows:rows.map(({name,actual,pass})=>({name,actual,pass})),http},null,2));
assert.equal(rows.filter(r=>!r.pass).length,0,'Distinct stderr causes must participate in the evidence fold');
