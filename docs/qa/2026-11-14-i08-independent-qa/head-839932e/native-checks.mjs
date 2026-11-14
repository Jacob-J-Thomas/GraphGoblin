import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
const evidence=dirname(fileURLToPath(import.meta.url));
const worktree=await realpath(process.argv[2]);
const expected=process.argv[3];
const git=(...args)=>execFileSync('git',args,{cwd:worktree,encoding:'utf8'}).trim();
assert.equal(git('rev-parse','HEAD'),expected);
assert.equal(git('status','--porcelain'),'');
const store=await mkdtemp(join(evidence,'sqlite-'));
const report={head:expected,node:process.version,worktree,store,processes:[],cases:[],calls:[],hashes:{}};
const lockNames=['graphgoblin.lock','graphgoblin.db.graphgoblin.lock','graphgoblin.lock.reclaim','graphgoblin.db.graphgoblin.lock.reclaim'];
const active=new Set();
for(const f of ['apps/api/dist/main.js','packages/domain/dist/expression.js','packages/domain/dist/json-schema.js','packages/domain/node_modules/jsonata/jsonata.js']){
 report.hashes[f]=createHash('sha256').update(await readFile(join(worktree,f))).digest('hex');
}
async function exists(path){try{await access(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function poll(test,ms=15000){
 const end=performance.now()+ms;
 while(performance.now()<end){const actual=await test();if(actual)return actual;await delay(40);}
 throw Error('Timed out waiting for the native fixture');
}
async function start(){
 const idx=report.processes.length+1;
 const ready=join(store,'ready-'+idx+'.json');
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^GG_|^(JEV_API_KEY|NODE_OPTIONS|OLLAMA_HOST|CODEX_HOME|CLAUDE_CONFIG_DIR)$/i.test(key)));
 Object.assign(env,{GG_PORT:'0',GG_HOST:'127.0.0.1',GG_DATA_DIR:store,GG_OLLAMA_ENABLED:'false',GG_LOG_LEVEL:'warn'});
 const child=spawn(process.execPath,[join(evidence,'start-native-gateway.mjs'),worktree,store,ready],{cwd:worktree,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 const record={idx,pid:child.pid,stdout:'',stderr:''};
 report.processes.push(record);
 active.add(child);
 child.stdout.on('data',b=>record.stdout+=b);
 child.stderr.on('data',b=>record.stderr+=b);
 const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>{active.delete(child);record.exit={code,signal};resolve(record.exit);});});
 const fixture=await poll(async()=>{if(record.exit)throw Error('Gateway exited early '+record.stderr);return await exists(ready)?JSON.parse(await readFile(ready,'utf8')):null;});
 assert.equal(fixture.pid,child.pid);
 assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.origin)&&!/:474[78]$/.test(fixture.origin));
 record.origin=fixture.origin;
 const {response}=await call(fixture,'GET','/healthz');
 assert.equal(response.headers.get('x-graphgoblin-pid'),String(child.pid));
 assert.equal(await exists(join(store,'graphgoblin.db')),true);
 return {...fixture,child,exited,record};
}
async function stop(fixture){
 assert.equal((await fetch(fixture.origin+'/healthz')).headers.get('x-graphgoblin-pid'),String(fixture.pid));
 const {response}=await call(fixture,'POST','/system/shutdown',{action:'drain'});
 assert.equal(response.status,202);
 const result=await Promise.race([fixture.exited,delay(8000,null,{ref:false})]);
 assert.deepEqual(result,{code:0,signal:null});
 fixture.record.existingLocks=(await Promise.all(lockNames.map(async n=>await exists(join(store,n))?n:null))).filter(Boolean);
 assert.deepEqual(fixture.record.existingLocks,[]);
}
async function call(app,method,path,body){
 const r=await fetch(app.origin+path,{method,signal:AbortSignal.timeout(12000),...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
 const data=await r.json();
 const log={pid:app.pid,method,path,status:r.status};
 if(r.status>=400)log.error=data;
 if(path.includes('/runs')&&method==='POST')log.input=body;
 report.calls.push(log);
 return {response:r,data};
}
async function verify(name,body){
 try{report.cases.push({name,status:'pass',details:await body()});}
 catch(e){report.cases.push({name,status:'fail',message:String(e),stack:e.stack});}
}
const node=(id,kind,config)=>({id,kind,label:id,config,ui:{x:0,y:0}});
const edge=(id,from,to,port='out')=>({id,from:{node:from,port},to:{node:to}});
function definition(name,{schema,returns='trigger.payload',mutate,decision}={}){
 const nodes=[node('start','trigger',{type:'manual',...(schema===undefined?{}:{inputSchema:schema})}),node('done','exit',{returns})];
 let edges=[edge('e','start','done')];
 if(mutate){
  nodes.splice(1,0,node('change','mutate',{operations:[{op:'set',path:'/lastOutput',value:{kind:'expression',jsonata:mutate}}]}));
  edges=[edge('a','start','change'),edge('b','change','done')];
 }
 if(decision){
  nodes.splice(1,0,node('choose','decision',{kind:'expression',jsonata:decision,routes:[{id:'yes',label:'Yes'},{id:'no',label:'No'}]}),
   node('other','exit',{returns:'"other"'}));
  edges=[edge('a','start','choose'),edge('b','choose','done','yes'),edge('c','choose','other','no')];
 }
 return {schemaVersion:4,name,nodes,edges};
}
async function publish(app,d,id){
 if(id){const put=await call(app,'PUT','/loops/'+id+'/draft',{definition:d});assert.equal(put.response.status,200,JSON.stringify(put.data));}
 else {const make=await call(app,'POST','/loops',{definition:d});assert.equal(make.response.status,201,JSON.stringify(make.data));id=make.data.loop.id;}
 const publish=await call(app,'POST','/loops/'+id+'/publish');
 assert.equal(publish.response.status,200,JSON.stringify(publish.data));
 return {id,version:publish.data.version.id};
}
async function terminal(app,id){
 return poll(async()=>{const {data}=await call(app,'GET','/runs/'+id);return ['succeeded','failed','cancelled'].includes(data.status)?data:null;});
}
async function accepted(app,target,input){
 const r=await call(app,'POST','/loops/'+target.id+'/runs',{versionId:target.version,input});
 assert.equal(r.response.status,202,JSON.stringify(r.data));
 assert.equal(r.data.run.versionId,target.version);
 const run=await terminal(app,r.data.run.id);
 assert.equal(run.versionId,target.version);
 return run;
}
async function refused(app,target,input,detail){
 const r=await call(app,'POST','/loops/'+target.id+'/runs',{versionId:target.version,input});
 assert.equal(r.response.status,400,JSON.stringify(r.data));
 assert.equal(r.data.code,'INVALID_INPUT');
 assert.match(r.data.detail,detail);
 assert(!r.data.run);
 return r.data;
}
const schemaId='https://scope.test/catalog/input';
const fields=(accept)=>({$id:schemaId,type:'object',required:['x/y'],additionalProperties:false,
 properties:{'x/y':{$ref:'record'},count:{type:'integer',minimum:1}},
 definitions:{'f~g':{$id:'record',$ref:'#/definitions/leaf'},leaf:accept}});
function ownFields(accept){
 // Draft-07 permits named embedded IDs with their own relative scope. The type target uses a root pointer to avoid ambiguous fixtures.
 const source=fields(accept);
 source.definitions['f~g'].$ref=schemaId+'#/definitions/leaf';
 return source;
}
const positiveA={'x/y':'warm@scope.test',count:3}, positiveB={'x/y':true,count:3}, positiveC={'x/y':23,count:3};
let httpHits=0, app;
const external=createServer((req,res)=>{httpHits++;res.statusCode=200;res.setHeader('content-type','application/json');res.end(JSON.stringify({type:'string'}));});
await new Promise((resolve,reject)=>{external.once('error',reject);external.listen(0,'127.0.0.1',resolve);});
const href='http://127.0.0.1:'+external.address().port+'/schema';
try {
 app=await start();
 await verify('same root and nested IDs, three selected versions and real warm/cold SQLite validation orders',async()=>{
  const v1=await publish(app,definition('Schema ID versioned',{schema:ownFields({type:'string',format:'email'})}));
  const other=await publish(app,definition('Same ID other loop',{schema:ownFields({type:'integer',minimum:5})}));
  const v2=await publish(app,definition('Schema ID versioned',{schema:ownFields({type:'boolean'})}),v1.id);
  const checkpoints=[];
  async function triad(target,positive,wrong,detail){
   const refusal=await refused(app,target,wrong,detail);
   const done=await accepted(app,target,positive);
   assert.equal(done.status,'succeeded',JSON.stringify(done.failure));
   assert.deepEqual(done.result,positive);
   checkpoints.push({pid:app.pid,version:target.version,result:done.result,diagnostic:refusal.detail});
  }
  await triad(v1,positiveA,positiveB,/\/x~1y must be string/);
  await triad(other,positiveC,positiveA,/\/x~1y must be integer/);
  await triad(v2,positiveB,positiveC,/\/x~1y must be boolean/);
  await refused(app,v1,{'x/y':'not-an-email',count:0},/(?=.*\/count must be >= 1)(?=.*\/x~1y must match format "email")/);
  await refused(app,v2,{count:3},/must have required property 'x\/y'/);
  await stop(app);app=await start();
  await triad(v2,positiveB,positiveA,/\/x~1y must be boolean/);
  await triad(other,positiveC,positiveB,/\/x~1y must be integer/);
  await triad(v1,positiveA,positiveC,/\/x~1y must be string/);
  const repeat=await accepted(app,v2,positiveB);
  assert.deepEqual(repeat.result,positiveB);
  return checkpoints;
 });
 await verify('published independent schema cannot be used as external reference after warming, no HTTP fetch',async()=>{
  const target=await publish(app,definition('Reference target warmup',{schema:{$id:href,type:'object',properties:{value:{type:'string'}},required:['value']}}));
  assert.deepEqual((await accepted(app,target,{value:'a'})).result,{value:'a'});
  const consuming=await publish(app,definition('Cross-resource refusal',{schema:{$id:'https://scope.test/cross',type:'object',properties:{entry:{$ref:href}}}}));
  const failure=await refused(app,consuming,{entry:'valid if externally loaded'},/invalid schema: can't resolve reference .*\/schema/);
  assert.equal(httpHits,0);
  return {target:target.version,consuming:consuming.version,httpHits,diagnostic:failure.detail};
 });
 if (process.env.QA_461_FULL_EXPRESSIONS === '1') await verify('flat JSONata literal arrays and projected inputs in real published runs',async()=>{
  const selections=[];
  const expression='trigger.payload.items.{"label": label, "point": point * 2}';
  const projection=await publish(app,definition('Width projection',{returns:expression}));
  for(const width of [99,100,200,417]){
   const items=Array.from({length:width},(_,i)=>({label:'row-'+i,point:i}));
   const expected=items.map(({label,point})=>({label,point:point*2}));
   const flat=await publish(app,definition('Width literal '+width,{returns:JSON.stringify(expected)}));
   for(const [target,input] of [[projection,{items}],[flat,{}]]){
    const run=await accepted(app,target,input);
    assert.equal(run.status,'succeeded',JSON.stringify(run.failure));
    assert.deepEqual(run.result,expected);
    selections.push({width,method:target===flat?'literal':'projection',runId:run.id,last:run.result.at(-1)});
   }
  }
  return selections;
 });
 if (process.env.QA_461_FULL_EXPRESSIONS === '1') await verify('native run true nesting and cycle guards, deadline, and precise malformed expression',async()=>{
  const scenarios=[
   {name:'deep real stack',source:'['.repeat(230)+'1'+']'.repeat(230),expected:/max depth 200/},
   {name:'checked eval cycle',source:'$eval(trigger.payload.source)',input:{source:'$eval(trigger.payload.source)'},expected:/max depth 200/},
   {name:'tail recursion deadline',source:'($forever := function($n) {$forever($n+1)}; $forever(0))',expected:/exceeded 2000ms/},
   {name:'valid syntax malformed operand',source:'trigger.payload.num * 2',input:{num:'not-a-number'},expected:/number|numeric/i},
  ];
  const result=[];
  for(const s of scenarios){
   const t=await publish(app,definition('Guard '+s.name,{mutate:s.source,returns:'lastOutput'}));
   const started=performance.now();
   const run=await accepted(app,t,s.input??{});
   assert.equal(run.status,'failed',JSON.stringify(run));
   assert.match(run.failure.message,s.expected);
   result.push({name:s.name,runId:run.id,code:run.failure.code,diagnostic:run.failure.message,ms:Math.round(performance.now()-started)});
  }
  return result;
 });
 await verify('cached recursive schema survives different successful and failed compiles through REST',async()=>{
  const ref='https://scope.test/live/tree';
  const recursive={$schema:'http://json-schema.org/schema',$id:ref,type:'object',required:['value'],properties:{value:{type:'string'},children:{type:'array',items:{$ref:'#'}}}};
  const wrong={$schema:'http://json-schema.org/draft-07/schema#',$id:ref,type:'object',properties:{value:{type:'integer'},children:{type:'array',items:{$ref:'#'}}}};
  const first=await publish(app,definition('Recursive aliases',{schema:recursive}));
  const good={value:'root',children:[{value:'leaf'}]};
  assert.deepEqual((await accepted(app,first,good)).result,good);
  const bad=await publish(app,definition('Invalid intermediate schema',{schema:{$id:ref,definitions:{nested:{$id:'private-reference',type:'string'}},$ref:'missing'}}));
  const broken=await refused(app,bad,{value:'test'},/can't resolve reference missing/);
  const hidden=await publish(app,definition('Refusal of intermediate nested ID',{schema:{$ref:'https://scope.test/live/private-reference'}}));
  await refused(app,hidden,'root',/can't resolve reference https:\/\/scope\.test\/live\/private-reference/);
  const other=await publish(app,definition('Different recursive alias',{schema:wrong}));
  const integer={value:1,children:[{value:2}]};
  assert.deepEqual((await accepted(app,other,integer)).result,integer);
  assert.deepEqual((await accepted(app,first,good)).result,good);
  const detailed=await refused(app,first,integer,/(?=.*\/value must be string)(?=.*\/children\/0\/value must be string)/);
  return {recursive:first.version,other:other.version,invalid:broken.detail,wrongInput:detailed.detail};
 });
 await verify('unchanged expression entry smoke test after compiler-only delta',async()=>{
  const rows=Array.from({length:205},(_,n)=>({n,valid:n%2===0}));
  const literal=await publish(app,definition('Final head expression smoke',{returns:JSON.stringify(rows)}));
  const run=await accepted(app,literal,{});
  assert.equal(run.status,'succeeded');
  assert.deepEqual(run.result,rows);
  return {count:run.result.length,runId:run.id};
 });
} catch(e) { report.harnessFailure={message:String(e),stack:e.stack}; }
finally {
 if(app&&active.has(app.child)){try{await stop(app);}catch(e){report.cleanupError=String(e);}}
 for(const child of active){if(child.exitCode===null&&child.signalCode===null)child.kill();}
 await new Promise(resolve=>external.close(resolve));
 report.externalRequests=httpHits;
 report.finalHead=git('rev-parse','HEAD');
 report.finalStatus=git('status','--porcelain');
 await writeFile(join(evidence,'native-results.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({cases:report.cases,processes:report.processes,harnessFailure:report.harnessFailure,cleanup:report.cleanupError,finalHead:report.finalHead,finalStatus:report.finalStatus},null,2));
 if(report.cases.some(c=>c.status!=='pass')||report.harnessFailure||report.cleanupError||report.head!==report.finalHead||report.finalStatus)process.exitCode=1;
}


