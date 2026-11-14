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
assert.equal(gateway.currentWorkingSourceBound,phase==='corrected');
assert.equal(gateway.apiEntryHash,binding.critical['apps/api/dist/main.js']);
const require = createRequire(join(root,'packages/domain/package.json'));
const jsonataEntry = await realpath(require.resolve('jsonata'));
const jsonataPackage = await json(new URL('package.json',pathToFileURL(jsonataEntry)));
const jsonata = {version:jsonataPackage.version,entrySha256:hash(await readFile(jsonataEntry))};
if (phase==='before') {
  assert.equal(jsonata.entrySha256,binding.jsonataInstallation.entrySha256);
  assert.equal(jsonata.version,binding.jsonataInstallation.version);
}
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
const start = node('work','trigger',{type:'manual'});
const end = node('end','exit',{});
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

// Decision drafts use the real catalog shape and inherited model selection. Readiness stays
// unavailable by construction. Their reference signal is exact code/path, not total publishable.
await record('F1 LLM and classifier message predicate roots',async(entry)=>{
  const held='$thread.counters.nodeVisits.work > 0 or $exists(counters.nodeVisits.work)';
  const after='$thread.counters.nodeVisits.renamed > 0 or $exists(counters.nodeVisits.work)';
  const known='$thread.gates.missing.passes > 0';
  const item='$exists(counters.nodeVisits.missing)';
  const options=[{id:'yes',label:'Yes',criteria:'Accept this message'},{id:'no',label:'No',criteria:'Reject it'}];
  const configs=[
    {kind:'llm',harness:'codex',model:{mode:'inherit'},effort:{mode:'inherit'},instructions:'Fixture never runs',
      routes:options.map(({id,label})=>({id,label}))},
    {kind:'classifier',model:'jev',question:'Fixture never runs',answer:{type:'choice',options}},
  ];
  const catalog=(await http('GET','/classifier-models',200)).data.items;
  assert(catalog.find(({id,primitives,configured})=>id==='jev'&&primitives.includes('choice')&&!configured));
  entry.witnesses=[];
  for(const config of configs) {
    const gate=node('pick','decision',{...config,context:{messages:{where:held}}});
    const graph=definition(config.kind,[start,gate,end],[wire('entry','work','out','pick'),
      wire('yes','pick','yes','end'),wire('no','pick','no','end')]);
    const witness={kind:config.kind}; entry.witnesses.push(witness);
    renameAssertions(witness,graph,'pick','config.context.messages.where',held,after,
      '$thread.counters.nodeVisits.work > 0 or $exists(counters.nodeVisits.renamed)');
    const stable=await make(graph);
    const control=setReference(clone(stable.draft.definition),'pick',item);
    const bad=setReference(clone(stable.draft.definition),'pick',known);
    const itemIssues=domain.validateLoop(control);
    const badIssues=domain.validateLoop(bad);
    const serverControl=await validate(stable.loop.id,control);
    const serverKnown=await validate(stable.loop.id,bad);
    const expected=phase==='corrected';
    for(const issues of [badIssues,serverKnown.issues]) {
      assert.equal(issues.some(missing('pick','config.context.messages.where')),expected);
    }
    assert.equal(itemIssues.some(noted('pick','config.context.messages.where','NODE_REFERENCE_OPTIONAL_MISSING')),!expected);
    assert.equal(serverControl.issues.some(noted('pick','config.context.messages.where','NODE_REFERENCE_OPTIONAL_MISSING')),!expected);
    witness.validation={domain:{item:itemIssues,bad:badIssues},gateway:{item:serverControl,bad:serverKnown}};
    witness.effects={
      before:await domain.evaluateExpression(held,{role:'user'},{bindings:{thread:{counters:{nodeVisits:{work:2}}}}}),
      renamed:await domain.evaluateExpression(after,{role:'user'},{bindings:{thread:{counters:{nodeVisits:{renamed:2}}}}}),
    };
    assert.deepEqual(witness.effects,{before:true,renamed:true});
  }
});

await record('F1 Subloop where variable uses the parent thread root',async(entry)=>{
  const child=definition('child',[node('start','trigger',{type:'manual'}),node('done','exit',{returns:'vars.where'})],
    [wire('child','start','out','done')],{where:{type:'number'}});
  const created=await make(child);
  const pin=await publish(created.loop.id);
  assert.equal(pin.status,200);
  const graph=definition('subloop-parent',[start,node('child','subloop',{loopRef:{loopId:created.loop.id,version:pin.data.version.version},
    input:{mode:'fresh',vars:{where:'counters.nodeVisits.work'}},output:{mode:'result-only',resultTo:{lastOutput:true}}}),
  node('end','exit',{returns:'outputs.child.value.result'})],
  [wire('start','work','out','child'),wire('finish','child','out','end')]);
  renameAssertions(entry,graph,'child','config.input.vars.where','counters.nodeVisits.work','counters.nodeVisits.renamed');
  const oldRef=await acceptedBoundary(entry,graph,(before)=>setReference(before,'child','gates.absent.passes'));
  const expected=phase==='corrected';
  for(const issues of [oldRef.validation.issues,oldRef.written.issues,
    phase==='corrected'?oldRef.attempt.data.errors:oldRef.attempt.data.issues]) {
    assert.equal(issues.some(missing('child','config.input.vars.where')),expected);
  }
});

const expressions = [
  {label:'function-result predicate',template:'$distinct(vars.rows)[n = $$.counters.nodeVisits.KEY].n',expected:2},
  {label:'block-result predicate',template:'(vars.rows)[n = $$.counters.nodeVisits.KEY].n',expected:2},
  {label:'function-result grouping',template:'$distinct(vars.rows){tag: $sum($$.counters.nodeVisits.KEY)}',
    expected:{one:2,two:2}},
  {label:'apply RHS attachment probe',template:'vars.rows ~> $distinct()[n = $$.counters.nodeVisits.KEY]',mayIgnore:true},
];
const asSource = (item,key)=>item.template.replace('KEY',key);
const expressionGraph=(text)=>definition('expression',[start,node('end','exit',{returns:text})],
  [wire('out','work','out','end')],{rows:{type:'array'}});

await record('F2 evaluator-confirmed non-path JSONata attachments',async(entry)=>{
  const originalRoot={vars:{rows:[{tag:'one',n:1},{tag:'two',n:2}]},counters:{nodeVisits:{work:2}}};
  const changedRoot={...originalRoot,counters:{nodeVisits:{work:1}}};
  entry.witnesses=[];
  for(const item of expressions) {
    const old=asSource(item,'work'), newer=asSource(item,'renamed');
    const before=await domain.evaluateExpression(old,originalRoot);
    const variant=await domain.evaluateExpression(old,changedRoot);
    const observesOriginalRoot=JSON.stringify(before)!==JSON.stringify(variant);
    const graph=expressionGraph(old);
    const result=domain.renameLoopNode(graph,'work','renamed');
    assert.equal(result.kind,'renamed');
    const proposed=sourceOf(result.definition,'end');
    const witness={name:item.label,source:old,before,variant,observesOriginalRoot,proposed,warnings:result.warnings};
    entry.witnesses.push(witness);
    if(item.mayIgnore && !observesOriginalRoot) {
      witness.disposition='Runtime does not observe attachment with this installed evaluator. Conservative warning is allowed and no false missing-reference refusal is required.';
      // An ignored attachment has no runtime root obligation. Capture actual findings without
      // demanding a false structural block or an unsafe edit.
      continue;
    }
    assert(observesOriginalRoot,item.label+' fixture must demonstrably evaluate the original root');
    if(!item.mayIgnore) assert.deepEqual(before,item.expected);
    const rewrittenResult=await domain.evaluateExpression(newer,
      {...originalRoot,counters:{nodeVisits:{renamed:2}}});
    assert.deepEqual(rewrittenResult,before,item.label+' rewrite preserves actual execution');
    if(phase==='before') assert.equal(proposed,old);
    else if(proposed!==newer) {
      assert.equal(proposed,old);
      assert(result.warnings.some(warn('end','config.returns')),item.label+' omitted exact field warning');
    }
    witness.missing=domain.validateLoop(expressionGraph(asSource(item,'missing')));
    if(phase==='corrected') assert(witness.missing.some(missing('end','config.returns'))||
      witness.missing.some(warn('end','config.returns')),item.label+' must not silently skip a real attachment');
  }
  const human=expressions[0];
  const boundary=await acceptedBoundary(entry,expressionGraph(asSource(human,'work')),
    (before)=>setReference(before,'end',asSource(human,'missing')));
  assert.equal(boundary.validation.issues.some(missing('end','config.returns')),phase==='corrected');
  const local='$distinct(vars.rows)[$exists(counters.nodeVisits.ghost)]';
  const optional='$distinct(vars.rows)[$exists($$.counters.nodeVisits.ghost)]';
  entry.controls={local:domain.validateLoop(expressionGraph(local)),optional:domain.validateLoop(expressionGraph(optional))};
  assert(!entry.controls.local.some(missing('end','config.returns')));
  assert(!entry.controls.optional.some(missing('end','config.returns')));
});

await writeFile(reportFile,JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({phase,head:gateway.head,scenarios:evidence.groups.map(({name,error})=>({name,error})),
  requests:evidence.timeline.length},null,2));
if(evidence.failures.length) process.exitCode=2;
