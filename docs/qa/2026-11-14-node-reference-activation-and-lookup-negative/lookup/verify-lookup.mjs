import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// This file is a future provider-free native probe. Run only under the owning lane's grant.
const [checkout, gatewayFile, bindingFile, reportFile, phase] = process.argv.slice(2);
assert(['before','corrected'].includes(phase));
assert.equal(process.version,'v22.23.4');
const root = await realpath(checkout);
const json = async (file)=>JSON.parse(await readFile(file,'utf8'));
const gateway = await json(gatewayFile), binding = await json(bindingFile);
const hash = (bytes)=>createHash('sha256').update(bytes).digest('hex');
const origin = new URL(gateway.url);
assert(origin.protocol==='http:' && origin.hostname==='127.0.0.1' && !['','4747','4748'].includes(origin.port));
assert.equal(gateway.head,binding.head);
assert.equal(gateway.tree,binding.tree);
assert.equal(gateway.base,binding.base);
assert.equal(gateway.currentWorkingSourceBound,true);
assert.equal(gateway.apiEntryHash,binding.critical['apps/api/dist/main.js']);
const require = createRequire(join(root,'packages/domain/package.json'));
const jsonataEntry = await realpath(require.resolve('jsonata'));
const jsonataPackage = await json(new URL('package.json',pathToFileURL(jsonataEntry)));
const jsonata = {version:jsonataPackage.version,entrySha256:hash(await readFile(jsonataEntry))};
assert.equal(jsonata.version,'2.2.2');
assert.equal(jsonata.entrySha256,'10965a9e3d86ccaf87f55294959637898e918c7ef5181af72d13279c8fc8e6de');
const health = await fetch(new URL('/healthz',origin));
assert.equal(health.status,200);
assert.equal(health.headers.get('x-graphgoblin-pid'),String(gateway.pid));
const domainEntry = join(root,'packages/domain/dist/index.js');
const domain = await import(pathToFileURL(domainEntry).href);
const evidence = {phase,head:gateway.head,tree:gateway.tree,base:gateway.base,jsonata,
  domainEntrySha256:hash(await readFile(domainEntry)),gatewayPid:gateway.pid,apiEntrySha256:gateway.apiEntryHash,
  timeline:[],groups:[],failures:[]};
async function http(method,path,expected,body,token) {
  const response = await fetch(new URL(path,origin),{
    method,signal:AbortSignal.timeout(10000),
    headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(token?{'if-match':'"'+token+'"'}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
  const data=await response.json();
  evidence.timeline.push({method,path,status:response.status,code:data.code,revision:data.draftToken,
    published:data.version?.id,token});
  if(expected!==undefined) assert.equal(response.status,expected,method+' '+path+' '+JSON.stringify(data));
  return {status:response.status,data};
}
const definition = (name,nodes,edges,variables={})=>({schemaVersion:4,name:'Reference QA '+phase+' '+name+' '+crypto.randomUUID().slice(0,7),
  nodes,edges,variables});
const node = (id,kind,config)=>({id,kind,label:id,config});
const wire = (id,source,port,target)=>({id,from:{node:source,port},to:{node:target,port:'in'}});
const noted = (nodeId,path,code)=> (issue)=>issue.nodeId===nodeId && issue.path===path && issue.code===code;
const missing = (nodeId,path)=>noted(nodeId,path,'NODE_REFERENCE_MISSING');
const warn = (nodeId,path)=>noted(nodeId,path,'NODE_REFERENCE_UNCERTAIN');
const clone = (value)=>structuredClone(value);
const setReference = (def,nodeId,source)=>{
  const subject=def.nodes.find(({id})=>id===nodeId);
  if(subject.kind==='decision') subject.config.context.messages.where=source;
  else if(subject.kind==='subloop') subject.config.input.vars.where=source;
  else subject.config.returns=source;
  return def;
};
function sourceOf(def,nodeId) {
  const subject=def.nodes.find(({id})=>id===nodeId);
  if(subject.kind==='decision') return subject.config.context.messages.where;
  if(subject.kind==='subloop') return subject.config.input.vars.where;
  return subject.config.returns;
}
const make = async (definition)=>(await http('POST','/loops',201,{definition})).data;
const loop = (id)=>'/loops/'+id;
const detail = async (id)=>(await http('GET',loop(id),200)).data;
const validate = async (id,definition)=>(await http('POST',loop(id)+'/validate',200,{definition})).data;
const publish = (id)=>http('POST',loop(id)+'/publish',undefined);
async function record(name,perform) {
  const entry={name};
  evidence.groups.push(entry);
  try { await perform(entry); }
  catch (error) { entry.error=String(error); evidence.failures.push({name,reason:String(error),stack:error.stack}); }
}
async function acceptedBoundary(entry,definition,witness) {
  const before=await make(definition);
  const id=before.loop.id;
  const original=await detail(id);
  const v1=await publish(id);
  assert.equal(v1.status,200,'Seed old immutable validated provider-free version');
  const acceptedBefore=await detail(id);
  const candidate=witness(clone(original.draft.definition));
  const written=(await http('PUT',loop(id)+'/draft',200,{definition:candidate},acceptedBefore.draftToken)).data;
  const held=await detail(id);
  assert.deepEqual(written.draft,held.draft);
  assert.deepEqual(held.current,v1.data.version);
  const validation=await validate(id,held.draft.definition);
  const attempt=await publish(id);
  const after=await detail(id);
  const immutable=(await http('GET',loop(id)+'/versions/'+v1.data.version.id,200)).data;
  assert.deepEqual(immutable,v1.data.version);
  entry.rest={firstVersion:v1.data.version,prePublish:held,savedIssues:written.issues,validation,attempt,after};
  if(phase==='corrected') {
    assert.equal(validation.publishable,false);
    assert.equal(attempt.status,422);
    assert.equal(attempt.data.code,'LOOP_INVALID');
    assert.deepEqual(after,held,'Refusal preserves exact old release, current draft and token');
  } else {
    // The suite never forces an old-server defect by relaxing a real new blocking control.
    assert.equal(validation.publishable,true);
    assert.equal(attempt.status,200);
    assert.deepEqual(after.current.definition,held.draft.definition);
  }
  return {validation,attempt,written};
}
function renameAssertions(entry,def,nodeId,path,original,repaired,beforeExpected=original) {
  const copy=clone(def);
  const result=domain.renameLoopNode(def,'work','renamed');
  assert.equal(result.kind,'renamed');
  assert.deepEqual(def,copy,'Public rename leaves original caller graph exact');
  entry.rename={before:original,result:sourceOf(result.definition,nodeId),warnings:result.warnings,
    edges:result.definition.edges};
  assert.deepEqual(result.definition.edges.map(({from,to})=>[from.node,to.node]),
    copy.edges.map(({from,to})=>[from.node==='work'?'renamed':from.node,to.node==='work'?'renamed':to.node]));
  assert.equal(entry.rename.result,phase==='before'?beforeExpected:repaired,nodeId+' understood reference rewrite');
  assert(!result.warnings.some(warn(nodeId,path)),path+' unexpectedly classified as ambiguous');
}

// A trigger publishes its input into outputs.start. The expression uses that genuine result as
// a computed key, so prefixing/changing the ordinary structural node ID affects actual runs.
const nested='$lookup(outputs, outputs.start.value).value';
const fixed='$lookup(outputs, outputs.renamed.value).value';
const missingCounter='$lookup(outputs, $string(counters.nodeVisits.missing))';
const minimal=(name,source)=>definition(name,[
  node('start','trigger',{type:'manual'}),node('end','exit',{returns:source}),
],[wire('edge','start','out','end')]);
async function pinned(id,version,input,expected){
  const admitted=await http('POST',loop(id)+'/runs',202,{versionId:version.id,input});
  const runId=admitted.data.run.id;
  let run;
  for(const deadline=Date.now()+10000;Date.now()<deadline;){
    run=(await http('GET','/runs/'+runId,200)).data;
    if(run.finalizedAt)break;
    await new Promise((done)=>setTimeout(done,125));
  }
  assert(run?.finalizedAt,'Provider-free pin finalized');
  assert.equal(run.versionId,version.id);
  assert.equal(run.status,'succeeded');
  assert.deepEqual(run.result,expected,'Exact local execution result');
  return run;
}
await record('Nested static key repair through public domain and actual runtime',async(entry)=>{
  const original=minimal('nested key',nested);
  const copy=clone(original);
  const branches={before:{outputs:{start:{value:'choice'},choice:{value:'chosen'}}},
    after:{outputs:{renamed:{value:'choice'},choice:{value:'chosen'}}}};
  const rename=domain.renameLoopNode(original,'start','renamed');
  assert.equal(rename.kind,'renamed');
  assert.deepEqual(original,copy);
  assert.deepEqual(rename.definition.edges,[wire('edge','renamed','out','end')]);
  const grew=sourceOf(rename.definition,'end');
  entry.domain={source:nested,result:grew,warnings:rename.warnings,branches,
    before:await domain.evaluateExpression(nested,branches.before),
    after:await domain.evaluateExpression(grew,branches.after),
    repairedControl:await domain.evaluateExpression(fixed,branches.after)};
  assert.equal(entry.domain.before,'chosen');
  assert.equal(entry.domain.repairedControl,'chosen');
  assert.equal(grew,phase==='before'?nested:fixed);
  assert.equal(entry.domain.after,phase==='before'?undefined:'chosen');
  assert(rename.warnings.some(warn('end','config.returns')),'Outer computed key remains honestly uncertain');

  const id=(await make(original)).loop.id;
  const first=(await publish(id)).data.version;
  const stored=await detail(id);
  assert.deepEqual(stored.current,first);
  const oldRun=await pinned(id,first,'start','start');
  const accepted=(await http('PUT',loop(id)+'/draft',200,{definition:rename.definition},stored.draftToken)).data;
  const current=await detail(id);
  assert.deepEqual(current.draft,accepted.draft);
  assert.equal(sourceOf(current.draft.definition,'end'),grew);
  const next=await publish(id);
  if(phase==='before'){
    // The stale reference also has an ordinary static validation path in some AST contexts. Keep
    // either public consequence honest, but require the recorded domain mismatch above exactly.
    if(next.status===200) entry.newRun=await pinned(id,next.data.version,'renamed',null);
    else {
      assert.equal(next.status,422);
      assert.equal(next.data.code,'LOOP_INVALID');
      assert.deepEqual(await detail(id),current);
    }
  }else{
    assert.equal(next.status,200);
    entry.newRun=await pinned(id,next.data.version,'renamed','renamed');
  }
  const immutable=(await http('GET',loop(id)+'/versions/'+first.id,200)).data;
  assert.deepEqual(immutable,first);
  entry.http={oldRun,first,accepted,current,next,immutable};
});
await record('Nested missing counter cannot replace immutable v1',async(entry)=>{
  const boundary=await acceptedBoundary(entry,minimal('nested missing counter','"original release"'),(def)=>
    setReference(def,'end',missingCounter));
  const expected=phase==='corrected';
  assert.equal(boundary.validation.issues.some(missing('end','config.returns')),expected);
  assert.equal(domain.validateLoop(entry.rest.prePublish.draft.definition).some(missing('end','config.returns')),expected);
  const direct=minimal('direct ordinary control','$string(counters.nodeVisits.missing)');
  assert(domain.validateLoop(direct).some(missing('end','config.returns')));
  const optional=minimal('nested presence control','$lookup(outputs, $string($exists(counters.nodeVisits.missing)))');
  const guarded=domain.validateLoop(optional);
  assert(!guarded.some(missing('end','config.returns')),'Explicit presence is still optional');
  const id=entry.rest.firstVersion.loopId;
  entry.oldRun=await pinned(id,entry.rest.firstVersion,null,'original release');
  entry.optional=guarded;
});
await writeFile(reportFile,JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({phase,groups:evidence.groups.map(({name,error})=>({name,error})),requests:evidence.timeline.length}));
if(evidence.failures.length)process.exitCode=2;

// Decision drafts use the real catalog shape and inherited model selection. Readiness stays
// unavailable by construction. Their reference signal is exact code/path, not total publishable.
