import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { CodexHarness } = await import(pathToFileURL(resolve('packages/adapter-codex/dist/index.js')));
const inherited=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>v!==undefined&&!k.toUpperCase().startsWith("GG_")&&!['NODE_OPTIONS','NODE_V8_COVERAGE','JEV_API_KEY','GG_JEV_API_KEY','LIVE'].includes(k)));
const text='Thread not found in referenced input. Error: invalid value for reasoning.effort.';
const refusal=JSON.stringify({status:400,error:{type:'invalid_request_error',message:text,param:'reasoning.effort'}});
const failureMessage=`The provider refused the request (HTTP 400, reasoning.effort): ${text}`;
const stderrCases={empty:'',banner:'Reading prompt from stdin...\n',repeat:refusal,bannerRepeat:'Banner\n'+refusal,decoratedRepeat:'ERROR: '+refusal,quota:JSON.stringify({status:429,error:{type:'rate_limit_exceeded',message:'Slow down'}}),auth:JSON.stringify({status:401,error:{type:'authentication_error',message:'Credentials expired'}}),server:JSON.stringify({status:503,error:{type:'server_error',message:'Service unavailable'}}),missing:'No rollout found with id new-missing-session',malformed:'{this is not JSON'};
function orders(prefix='',rest='SEFC'){return [prefix,...[...rest].flatMap(c=>orders(prefix+c,rest.replace(c,'')))];}
const rows=[];
for(const order of orders().filter(x=>/[EF]/.test(x))) for(const [stderrName,stderr] of Object.entries(stderrCases)) for(const exit of [0,1]) {
  const events=[{type:'thread.started',thread_id:'r3-order-thread'},...[...order].map(c=>c==='S'?{type:'turn.started'}:c==='C'?{type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,cache_write_input_tokens:0,output_tokens:1,reasoning_output_tokens:0}}:c==='E'?{type:'error',message:refusal}:{type:'turn.failed',error:{message:refusal}})];
  const h=new CodexHarness({codexBinary:process.execPath,env:{...inherited,NODE_OPTIONS:`--import=${new URL('./fixture-cli.mjs',import.meta.url).href}`,GG_AUDIT_SPEC:JSON.stringify({events,stderr,exit})}});
  const s=h.start({workingDirectory:process.cwd(),model:'gpt-6-luna',effort:'low',options:{sandbox:'read-only',approval:'never'},turn:{prompt:'Exact matrix task'}},new AbortController().signal);
  const observed=[];for await(const e of s.events) observed.push(e);
  let actual;try{await s.result;}catch(e){actual={code:e.code,message:e.message,retriable:e.retriable,submission:e.submission};}
  const missing=exit===1&&stderrName==='missing';
  const expected={code:missing?'HARNESS_SESSION_MISSING':'HARNESS_ARGUMENTS_REJECTED',message:missing?'The recorded Codex conversation was not found':failureMessage,retriable:false,submission:missing?'session-missing':order.includes('S')?'delivery-uncertain':'definitely-not-submitted'};
  const pass=JSON.stringify(actual)===JSON.stringify(expected);
  rows.push({order,stderrName,exit,pass,...(!pass?{expected,actual}: {})});
}
const summary={total:rows.length,passed:rows.filter(x=>x.pass).length,failed:rows.filter(x=>!x.pass).length};
writeFileSync(new URL('../extended-order-matrix.log.txt',import.meta.url),JSON.stringify({summary,rows},null,2)+'\n','utf8');
console.log(JSON.stringify({summary,failures:rows.filter(x=>!x.pass)},null,2));
assert.equal(summary.failed,0,'Every ordering must preserve a pinned refusal and distinguish a genuinely new cause');
