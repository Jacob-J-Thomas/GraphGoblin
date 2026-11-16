import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const checkout = 'C:/Users/98jak/.codex/worktrees/gg-20261115-runtime/GraphGoblin';
const batch = 'C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch';
const output = path.join(batch, 'review-410-astra-scan2');
const seen = new Map();
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
function read(p) {
  const file = path.resolve(p);
  const b = fs.readFileSync(file);
  seen.set(file, {path:file,bytes:b.length,sha256:sha(b)});
  return b.toString('utf8').replace(/^\uFEFF/, '');
}
const json = (p) => JSON.parse(read(p));
const write = (name, data) => fs.writeFileSync(path.join(output,name), JSON.stringify(data,null,2)+'\n');
const hash = (p) => { read(p); return seen.get(path.resolve(p)); };
const walk = (p) => fs.readdirSync(p,{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(path.join(p,d.name)):[path.join(p,d.name)]);
const packetNames = ['runtime-failure-completion','runtime-failure-final-ci','terminal-wait-baseline','terminal-wait-candidate','terminal-wait-implementation'].map(x=>'2026-11-15-'+x);
const baselinePath = path.join(checkout,'docs/qa/2026-11-15-terminal-wait-baseline/baseline-02/raw/summary.json');
const candidatePath = path.join(checkout,'docs/qa/2026-11-15-terminal-wait-candidate/candidate/native-evidence/summary.json');
const mode = process.argv[2];
if (mode === 'integrity') {
  const admissionFile = path.join(batch,'runtime-410-astra-admission.json');
  assert.equal(hash(admissionFile).sha256,'8c13a5d536316dfafaa57b82bf4aadef7fbbee6b029d7590280f66c3392d1a28');
  const admission = json(admissionFile);
  const admitted = [...admission.boundInputs,...admission.ci.raw,admission.ci.artifact].map(v=>{
    const actual=hash(v.path); return {...actual,expectedBytes:v.bytes,expectedSha256:v.sha256,matched:actual.bytes===v.bytes&&actual.sha256===v.sha256};
  });
  const packets=[];
  for(const packet of packetNames) {
    const dir=path.join(checkout,'docs/qa',packet);
    const manifest=read(path.join(dir,'SHA256SUMS'));
    const entries=manifest.trim().split(/\r?\n/).map(line=>{
      const match=/^([a-f0-9]{64})\s+[ *]?(.+)$/.exec(line);
      assert.ok(match, line);
      const rel=match[2]; const actual=hash(path.join(dir,rel));
      return {path:rel,...actual,expectedSha256:match[1],matched:actual.sha256===match[1]};
    });
    const actualFiles=walk(dir).map(p=>path.relative(dir,p).replaceAll('\\','/')).filter(p=>p!=='SHA256SUMS');
    const listed=new Set(manifest.trim().split(/\r?\n/).map(l=>/^([a-f0-9]{64})\s+[ *]?(.+)$/.exec(l)[2]));
    const unlisted=actualFiles.filter(p=>!listed.has(p));
    const mapping=json(path.join(dir,'source-copy-map.json'));
    const copied=(mapping.files??[]).map(v=>{
      const local=hash(path.join(dir,v.path));
      const original=path.resolve(mapping.sourceRoot??batch,v.sourcePath);
      const source=fs.existsSync(original)?hash(original):undefined;
      return {destination:v.path,source:original,expectedBytes:v.bytes,expectedSha256:v.sha256,destinationMatches:local.bytes===v.bytes&&local.sha256===v.sha256,sourceMatches:!!source&&source.bytes===v.bytes&&source.sha256===v.sha256};
    });
    packets.push({packet,entries:entries.length,allMatched:entries.every(e=>e.matched),unlisted,copied,entryDetails:entries});
  }
  const result={at:new Date().toISOString(),node:process.version,admitted,packets};
  write('packet-integrity.json',result);
  console.log(JSON.stringify({admitted:admitted.length,admittedMatched:admitted.filter(x=>x.matched).length,packets:packets.map(({packet,entries,allMatched,unlisted,copied})=>({packet,entries,allMatched,unlisted,copied:copied.length,sourceExceptions:copied.filter(x=>!x.sourceMatches||!x.destinationMatches)}))},null,2));
} else if(mode === 'shape') {
  const c=json(candidatePath); const b=json(baselinePath);
  const compact=(o,depth=0)=>{
    if(o===null||typeof o!=='object')return o;
    if(Array.isArray(o))return {arrayLength:o.length,sample:o.length?compact(o[0],depth+1):undefined};
    if(depth>3)return {keys:Object.keys(o).slice(0,35)};
    return Object.fromEntries(Object.entries(o).slice(0,25).map(([k,v])=>[k,compact(v,depth+1)]));
  };
  console.log(JSON.stringify(compact({W1:c.W1,W2:c.W2,W3:c.W3,W4:c.W4,cleanup:c.cleanup,baselineSeed:b.W4.seed}),null,2));
} else if(mode === 'native') {
  const c=json(candidatePath), b=json(baselinePath);
  const checks=[];
  const check=(name,fn)=>{try{fn(); checks.push({name,pass:true});}catch(e){checks.push({name,pass:false,error:String(e)});}};
  const eq=assert.deepEqual;
  const publicRuns=(p)=>[p.rest,p.mcpGet.structuredContent,...p.restPages.flatMap(x=>x.items).filter(x=>x.id===p.raw.row.id),...p.mcpPages.flatMap(x=>x.items).filter(x=>x.id===p.raw.row.id)];
  const events=(raw)=>raw.events.map(e=>({...JSON.parse(e.payload),type:e.type,runId:e.run_id,seq:e.seq,ts:e.ts,...(e.node_id?{nodeId:e.node_id}:{})}));
  const terminal=(raw,type='run.failed')=>events(raw).filter(e=>e.type===type);
  function failedPair(pair,hasWait) {
    const p=pair.parent,row=p.raw.row,rawEvents=events(p.raw);
    assert.equal(row.status,'failed'); assert.ok(row.finalized_at); assert.ok(row.finished_at);
    assert.equal(row.waiting===null,!hasWait);
    const surfaces=publicRuns(p); assert.equal(surfaces.length,4);
    const f=JSON.parse(row.failure);
    for(const [i,r] of surfaces.entries()){
      assert.equal(Object.hasOwn(r,'waiting'),hasWait);
      // MCP list_runs deliberately uses describeRun's compact failure projection.
      eq(r.failure,i===3?{code:f.code,message:f.message,script:f.script,resumable:f.resumable}:f);
    }
    assert.equal(terminal(p.raw).length,1);
    eq(terminal(p.raw)[0].failure,JSON.parse(row.failure));
    assert.equal(JSON.parse(row.failure).code,'SCRIPT_EXIT_CODE');
    assert.equal(JSON.parse(row.failure).details.childRunId,pair.child.id);
    eq(p.restEvents.items,rawEvents); eq(p.mcpEvents.structuredContent.items,rawEvents);
    eq(rawEvents.filter(e=>['run.waiting','run.woken','child_run.finished','run.failed'].includes(e.type)).map(e=>[e.type,e.seq]),[['run.waiting',7],['run.woken',8],['child_run.finished',10],['run.failed',11]]);
    assert.equal(pair.rawChild.row.parent_run_id,row.id);
    assert.equal(pair.rawChild.row.waiting,null);
    assert.ok(pair.rawChild.row.finalized_at);
  }
  check('Both accepted raw matrices completed and have no remaining sessions',()=>{for(const s of[c,b]){assert.equal(s.result,'assertions-met');eq(s.remaining,{writers:[],mcp:[],observers:0});}});
  check('Baseline W1 stale wait in SQL and all four public surfaces',()=>failedPair(b.W1.after,true));
  check('Baseline W2 stale wait after event-first restart in all surfaces',()=>failedPair(b.W2.after,true));
  check('Candidate W1 wait clear with exact public and event agreement',()=>failedPair(c.W1.after,false));
  check('Candidate W2 wait clear with exact public and event agreement',()=>failedPair(c.W2.after,false));
  const proof=json(path.join(checkout,'docs/qa/2026-11-15-terminal-wait-candidate/candidate/native-evidence/W2-verified-before-interruption.json'));
  const crash=json(path.join(checkout,'docs/qa/2026-11-15-terminal-wait-candidate/candidate/native-evidence/W2-post-crash-before-reopen.json'));
  check('W2 independently saved proof binds the held transition and landed raw records',()=>{eq(proof.gate,c.W2.gate);eq(proof.landed,c.W2.landing);eq(proof.script,c.W2.scriptBeforeKill);eq(proof.pair,c.W2.pair);assert.equal(proof.gate.delegateEntered,false);assert.equal(proof.gate.ownsWaitingMember,true);});
  check('W2 landing is nonterminal, not projected, with prior wait and a committed failure',()=>{
    const r=c.W2.landing.parent.row; assert.equal(r.status,'running');assert.equal(r.waiting,c.W2.before.parent.raw.row.waiting);eq(JSON.parse(r.waiting),c.W2.pair.parentWait);
    for(const field of['failure','finished_at','finalized_at'])assert.equal(r[field],null);
    assert.equal(r.last_event_seq,11);assert.equal(r.thread_snapshot_seq,7);assert.equal(c.W2.landing.parent.events.at(-1).type,'run.failed');
    const f=terminal(c.W2.landing.parent);assert.equal(f.length,1);eq(f[0].failure,c.W2.gate.change.failure);
  });
  check('W2 restart preserved all parent events, child row/events and failure identity',()=>{
    eq(c.W2.after.parent.raw.events,c.W2.landing.parent.events);eq(c.W2.after.rawChild,c.W2.landing.child);
    eq(terminal(c.W2.after.parent.raw)[0].failure,proof.failureEvent.failure);assert.equal(c.W2.after.parent.raw.row.thread_snapshot_seq,11);
    for(const field of['id','loop_id','version_id','parent_run_id','invocation_id','current_node_id','pinned','initial_thread'])assert.equal(c.W2.after.parent.raw.row[field],c.W2.landing.parent.row[field]);
  });
  check('W2 exact owned process was interrupted and ordinary process reused store/instance',()=>{
    const held=c.processes.find(p=>p.role==='event-first-gated-gateway'),restarted=c.processes.find(p=>p.role==='event-first-ordinary-restart');
    assert.equal(held.pid,proof.process.pid);assert.equal(held.windowsCreationTime,proof.process.windowsCreationTime);eq(held.exit,{code:null,signal:'SIGKILL'});eq(held.close,held.exit);assert.equal(held.listenerClosed,true);
    assert.notEqual(held.windowsCreationTime,restarted.windowsCreationTime);assert.equal(restarted.mode,'ordinary');assert.equal(restarted.store,held.store);assert.equal(restarted.instance,held.instance);
    eq(crash.crashFiles,c.W2.beforeReopenFiles);eq(crash.interrupted,c.W2.interrupted);assert.ok(crash.crashFiles['graphgoblin.db-wal'].bytes>32);
    assert.equal(c.W2.scriptBeforeKill.marker.ppid,held.pid);assert.equal(c.W2.scriptBeforeKill.marker.code,7);
  });
  check('W3 active parent and child raw rows/events did not change',()=>{eq(c.W3.activeBefore.parent.raw,c.W3.activeAfterOtherRuns.parent.raw);eq(c.W3.activeBefore.rawChild,c.W3.activeAfterOtherRuns.rawChild);assert.equal(c.W3.activeBefore.parent.raw.row.status,'waiting');});
  check('W3 success clears waits and performs one subloop completion and exit',()=>{
    const p=c.W3.successAfter;assert.equal(p.parent.raw.row.status,'succeeded');assert.equal(p.parent.raw.row.waiting,null);assert.equal(p.rawChild.row.waiting,null);assert.equal(p.rawChild.row.status,'succeeded');
    assert.equal(events(p.parent.raw).filter(e=>e.type==='child_run.finished').length,1);assert.equal(terminal(p.parent.raw,'run.finished').length,1);
  });
  check('W3 cancellation clears both waits and finalized both runs',()=>{
    for(const r of[c.W3.cancelled.parent.raw.row,c.W3.cancelled.rawChild.row]){assert.equal(r.status,'cancelled');assert.equal(r.waiting,null);assert.ok(r.finalized_at);}
  });
  check('W3 authored failure is run.finished, no failure object, no wait',()=>{
    const p=c.W3.authoredFailure;assert.equal(p.raw.row.waiting,null);assert.equal(p.raw.row.failure,null);assert.equal(p.raw.row.outcome,'failure');assert.equal(terminal(p.raw).length,0);assert.equal(terminal(p.raw,'run.finished').length,1);
  });
  check('W4 exact historical parent/child bytes match baseline live and restart witnesses',()=>{
    for(const prior of[b.W1.after,b.W4.after]){eq(c.W4.after.parent.raw,prior.parent.raw);eq(c.W4.after.rawChild,prior.rawChild);}
    failedPair(c.W4.after,true);assert.equal(c.W4.seed.parentId,b.W1.pair.parentId);
  });
  check('Private seed remains original standalone file without sidecars',()=>{
    assert.equal(hash(c.W4.seed.database).sha256,c.W4.seed.sha256);assert.equal(fs.statSync(c.W4.seed.database).size,552960);eq(fs.readdirSync(path.dirname(c.W4.seed.database)),['graphgoblin.db']);
  });
  check('Candidate stores remain empty; captured process cleanup is complete',()=>{
    for(const info of Object.values(c.cleanup)){assert.equal(info.empty,true);eq(fs.readdirSync(info.path),[]);assert.equal(info.probe.exit.code,0);}
    for(const p of c.processes){if(p.mode==='gated')continue;assert.equal(p.exit.code,0);assert.equal(p.close.code,0);if(p.origin)assert.equal(p.listenerClosed,true);}
  });
  const result={at:new Date().toISOString(),checks,summaryDigests:{candidate:hash(candidatePath),baseline:hash(baselinePath)},W2:{gate:c.W2.gate,proofProcess:proof.process,crashFiles:crash.crashFiles},privateSeed:hash(c.W4.seed.database)};
  write('native-independent-readback.json',result);console.log(JSON.stringify({checks,passed:checks.filter(x=>x.pass).length,total:checks.length},null,2));if(checks.some(x=>!x.pass))process.exitCode=1;
} else if(mode === 'bindings') {
  const candidateFile=path.join(batch,'runtime-410-build-candidate-review-01/build-binding.json');
  const baselineFile=path.join(batch,'runtime-410-build-baseline-review-01/build-binding.json');
  const c=json(candidateFile),b=json(baselineFile),native=json(candidatePath);
  assert.equal(hash(candidateFile).sha256,'cbf6bbd47aa7c556443e31afad40d39ea7425bc5b6b073c4754bfef393c3a38a');
  assert.equal(hash(baselineFile).sha256,'121b25eae6c8784313649af2e057569d86bdee60edb3aae77cf8c90639066ac3');
  const matches=(entries)=>Object.entries(entries).map(([rel,expected])=>{const actual=hash(path.join(checkout,rel));return{path:rel,expectedSha256:expected,actualSha256:actual.sha256,matched:actual.sha256===expected};});
  const outputs=matches(c.outputFiles),source=matches(Object.fromEntries(Object.entries(c.sourceFiles).filter(([p])=>!p.startsWith('docs/')))),dependencies=matches(c.dependencyFiles);
  const sourceChanges=Object.keys(c.sourceFiles).filter(p=>c.sourceFiles[p]!==b.sourceFiles[p]);
  const outputChanges=Object.keys(c.outputFiles).filter(p=>c.outputFiles[p]!==b.outputFiles[p]);
  const links=Object.entries(c.workspaceLinks).map(([p,t])=>({path:p,target:t,matched:fs.realpathSync(path.join(checkout,p))===fs.realpathSync(path.join(checkout,t))}));
  const runtime=Object.values(native.runtimeBindings).map(x=>{const rel=path.relative(checkout,x.file).replaceAll('\\','/');return{...x,relative:rel,matched:c.outputFiles[rel]===x.sha256};});
  const preflight=json(path.join(checkout,'docs/qa/2026-11-15-terminal-wait-candidate/candidate/launch/preflight.json'));
  const closing=json(path.join(checkout,'docs/qa/2026-11-15-terminal-wait-candidate/candidate/launch/launch-result.json'));
  const harness=Object.entries(preflight.harness.files).map(([p,expected])=>({path:p,matched:hash(path.join(batch,'runtime-410-native-preparation',p)).sha256===expected&&closing.closingHarness.files[p]===expected}));
  assert.deepEqual(preflight.build,closing.closingBuild);
  assert.equal(preflight.build.buildBindingSha256,hash(candidateFile).sha256);
  assert.equal(c.head,'4e4501bd92953794bb733a746f7c24d1bcc2452a');assert.equal(c.actualMain,'154401c7b47c1e56b62a6daec50e2a3145ea967d');assert.equal(b.head,c.actualMain);
  const buildProof=[];
  for(const binding of[c,b])for(const [kind,receipt]of Object.entries(binding.buildProof)){if(typeof receipt!=='object')continue;buildProof.push({kind,path:receipt.path,matched:hash(receipt.path).sha256===receipt.sha256});}
  const result={at:new Date().toISOString(),candidate:{head:c.head,tree:c.tree,digest:hash(candidateFile),sourceFiles:Object.keys(c.sourceFiles).length,outputRoots:c.outputRoots.length,node:c.nodeVersion},baseline:{head:b.head,tree:b.tree,digest:hash(baselineFile)},sourceChanges,outputChanges,outputs,nonDocsSource:source,dependencies,links,runtime,harness,buildProof,nodeHashMatch:hash(c.nodePath).sha256===c.nodeSha256,preflightClosingBuildEqual:true};
  write('build-bindings-independent-readback.json',result);
  const groups={outputs,nonDocsSource:source,dependencies,links,runtime,harness,buildProof};
  console.log(JSON.stringify({candidate:result.candidate,baseline:result.baseline,sourceChanges,outputChanges,groups:Object.fromEntries(Object.entries(groups).map(([n,a])=>[n,{count:a.length,mismatches:a.filter(x=>!x.matched)}])),nodeHashMatch:result.nodeHashMatch,preflightClosingBuildEqual:true},null,2));
  if(Object.values(groups).some(a=>a.some(x=>!x.matched))||!result.nodeHashMatch)process.exitCode=1;
} else if(mode === 'ci') {
  const admission=json(path.join(batch,'runtime-410-astra-admission.json'));
  const logs=Object.fromEntries(admission.ci.raw.map(r=>[path.basename(r.path),read(r.path)]));
  const gates=logs['runtime-487-root-gates-retry.decoded.log'];
  const groups=[...gates.matchAll(/Tests\s+(\d+) passed(?:\s*\|\s*(\d+) skipped)?\s*\((\d+)\)/g)].map(m=>({passed:Number(m[1]),skipped:Number(m[2]??0),total:Number(m[3])}));
  const totals=groups.reduce((a,g)=>({passed:a.passed+g.passed,skipped:a.skipped+g.skipped}),{passed:0,skipped:0});
  assert.equal(groups.length,13);assert.deepEqual(totals,{passed:9607,skipped:41});
  const lineMatches=(text,rx)=>text.split(/\r?\n/).map((text,i)=>({line:i+1,text})).filter(x=>rx.test(x.text));
  const result={at:new Date().toISOString(),groups,totals,gates:lineMatches(gates,/HEAD is now|node: v22|Tests\s+\d|Tasks:|Cached:|21 vulnerabilities found|Severity:|awaited-children|child-failure-parity/),browser:lineMatches(logs['runtime-487-root-browser.decoded.log'],/481 passed|1 skipped|retries=0|LIVE: 0|Microsoft Edge|Skipped:|GG_ROUTING_STRICT_PERF/),windows:lineMatches(logs['runtime-487-root-windows-launcher.decoded.log'],/# tests|# pass|# fail|# skipped|No files were found/),templates:lineMatches(logs['runtime-487-root-template-image.decoded.log'],/network none|read-only|templates|catalog/i).slice(-12)};
  write('ci-log-independent-readback.json',result);console.log(JSON.stringify(result,null,2));
} else if(mode === 'build-shape') {
  const b=json(path.join(batch,'runtime-410-build-candidate-review-01/build-binding.json'));
  console.log(JSON.stringify({head:b.head,tree:b.tree,actualMain:b.actualMain,nodeVersion:b.nodeVersion,sourceFileCount:Object.keys(b.sourceFiles).length,outputFileCount:Object.keys(b.outputFiles).length,sourceSample:Object.entries(b.sourceFiles).slice(0,2),outputSample:Object.entries(b.outputFiles).slice(0,2),runtimeEntries:b.runtimeEntries,outputRoots:b.outputRoots,buildProof:b.buildProof,dependencies:Object.entries(b.dependencyFiles).slice(0,2),linkExample:Object.entries(b.workspaceLinks).slice(0,2)},null,2));
} else throw new Error('unknown mode '+mode);
write('inspected-inputs-'+mode+'.json',[...seen.values()]);
