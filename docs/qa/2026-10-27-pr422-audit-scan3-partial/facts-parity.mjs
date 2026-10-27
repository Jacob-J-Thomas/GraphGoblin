import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
const repo=process.cwd();
const built=p=>import(pathToFileURL(path.join(repo,p)).href);
const infra=await built('packages/infrastructure/dist/sqlite/index.js');
const {openStoreBefore}=await built('packages/infrastructure/dist/sqlite/testing/index.js');
const {FakeClock}=await built('packages/engine/dist/testing/index.js');
const {fakeUlid}=await built('packages/contracts/dist/testing/index.js');
const require=createRequire(path.join(repo,'packages/infrastructure/package.json'));
const {drizzle}=require('drizzle-orm/libsql');
const markers=['run.failed','run.finished','run.cancelled','run.started','run.resumed'];
const expected=(events,nodes)=>({
  observedSeq:events.at(-1)?.seq??0,
  lifecycle:events.findLast(e=>markers.includes(e.type)),
  failed:events.findLast(e=>e.type==='run.failed'),
  resumed:events.findLast(e=>e.type==='run.resumed'),
  reachedNodeIds:nodes.filter(id=>events.some(e=>e.type==='node.started'&&e.nodeId===id)),
});
const results={synthetic:[],upgraded:[],append:[]};
const handle=await infra.openMemoryDatabase();
try{
 const statements=[];
 const db=drizzle(handle.client,{schema:infra.schema,logger:{logQuery:(query,params)=>statements.push({query,params})}});
 const store=new infra.SqliteEventStore(db,new FakeClock());
 const id=fakeUlid('marker-parity');
 const nodes=['a','b','c','unreached'];
 const batches=[
 [],
 [{type:'run.started',attempt:1}],
 [{type:'node.started',nodeId:'a',kind:'script',attempt:1,configHash:'fixed'}],
 [{type:'run.failed',failure:{code:'SCRIPT_OUTCOME_UNCERTAIN',message:'A',resumable:true,nodeId:'a',script:{state:'outcome-uncertain',visitId:'a-1'}}}],
 [{type:'run.resumed',actor:{kind:'user',id:'audit'},childRecovery:{runId:fakeUlid('child'),failureSeq:3,observedSeq:4,retryUncertainScript:true}},{type:'run.started',attempt:2}],
 [{type:'run.failed',failure:{code:'SCRIPT_EXIT_CODE',message:'A again',resumable:true,nodeId:'a'}}],
 [{type:'run.resumed',actor:{kind:'user',id:'audit'}},{type:'node.started',nodeId:'b',kind:'script',attempt:2,configHash:'fixed'}],
 [{type:'run.cancelled'}],
 ];
 for(const drafts of batches){
  if(drafts.length)await store.append(id,drafts);
  const history=await store.read(id);
  statements.length=0;
  const actual=await store.recoveryFacts(id,nodes);
  assert.deepEqual(actual,expected(history,nodes));
  assert.equal(statements.length,2+nodes.length);
  results.synthetic.push({seq:actual.observedSeq,latest:actual.lifecycle?.type,failed:actual.failed?.seq,resumed:actual.resumed?.seq,reached:actual.reachedNodeIds});
 }
 // Alternate relevant markers among large unrelated histories, not only one initial failure.
 for(let round=0;round<30;round++){
  await store.append(id,Array.from({length:100},()=>({type:'signal.received',name:'noise',payload:'x'.repeat(256)})));
  await store.append(id,[round%2===0?{type:'run.started',attempt:round+3}:{type:'run.failed',failure:{code:'INTERNAL_ERROR',message:'controlled',resumable:true}}]);
  const history=await store.read(id);
  statements.length=0;
  const actual=await store.recoveryFacts(id,nodes);
  assert.deepEqual(actual,expected(history,nodes));
  const plans=[];
  let returned=0;
  for(const {query,params} of statements){
    returned+=(await handle.client.execute({sql:query,args:params})).rows.length;
    plans.push(...(await handle.client.execute({sql:'EXPLAIN QUERY PLAN '+query,args:params})).rows.map(r=>String(r.detail)));
  }
  assert(returned<=1+3+nodes.length);
  assert(!plans.some(p=>/SCAN run_events/.test(p)));
  assert(plans.some(p=>p.includes('run_events_reached_idx')));
  if(round===29)results.synthetic.push({seq:actual.observedSeq,statements:statements.length,returned,plans});
 }
}finally{handle.close();}
// Check every upgraded native run against its complete actual log, using a read-only connection.
const file=path.join(process.env.GG_QA_ROOT,'upgrade-store','graphgoblin.db');
const client=infra.openReadOnlyDatabaseClient(file);
try{
 const db=infra.databaseView(client);
 const store=new infra.SqliteEventStore(db,new FakeClock());
 const loops=new infra.SqliteLoopRepository(db,new FakeClock(),{next:()=>{throw Error('read only');}});
 const runs=await client.execute('SELECT id,version_id,status FROM runs ORDER BY id');
 for(const row of runs.rows){
   const version=await loops.getVersion(String(row.version_id));
   const nodes=version.definition.nodes.map(n=>n.id);
   const history=await store.read(String(row.id));
   const actual=await store.recoveryFacts(String(row.id),nodes);
   assert.deepEqual(actual,expected(history,nodes));
   results.upgraded.push({runId:String(row.id),status:row.status,events:history.length,reached:actual.reachedNodeIds});
 }
}finally{client.close();}
// Same public append implementation, with/without exactly the new partial index.
for(const indexed of [false,true]){
 const h=indexed?await infra.openMemoryDatabase():await openStoreBefore(':memory:','0025_recovery_facts');
 try{
   const statements=[];
   const db=drizzle(h.client,{schema:infra.schema,logger:{logQuery:(query)=>statements.push(query)}});
   const store=new infra.SqliteEventStore(db,new FakeClock());
   const id=fakeUlid('append-benchmark');
   for(const kind of ['signal.received','node.started']){
     const samples=[];
     for(let round=0;round<7;round++){
       const begin=performance.now();
       statements.length=0;
       for(let n=0;n<10;n++)await store.append(id,Array.from({length:100},()=>kind==='signal.received'?{type:kind,name:'noise',payload:'x'.repeat(256)}:{type:kind,nodeId:'a',kind:'script',attempt:round+1,configHash:'fixed'}));
       const ms=performance.now()-begin;
       assert.equal(statements.length,30);
       samples.push(ms);
     }
     const sorted=[...samples.slice(1)].sort((a,b)=>a-b);
     results.append.push({indexed,kind,eventsPerSample:1000,statementsPerSample:30,ms:samples,medianMs:sorted[Math.floor(sorted.length/2)]});
   }
 }finally{h.close();}
}
const record=path.join(path.dirname(fileURLToPath(import.meta.url)),'facts-parity-results.json');
fs.writeFileSync(record,JSON.stringify(results,null,2)+'\n','utf8');
console.log(JSON.stringify({syntheticComparisons:38,upgradedRuns:results.upgraded.length,append:results.append}));
