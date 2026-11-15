import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const repo='C:/Users/98jak/.codex/worktrees/gg-20261115-runtime/GraphGoblin';
const batch='C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch';
const out=path.join(batch,'audit-484-astra-scan2');
const q=path.join(repo,'docs/qa');
const corrected=path.join(q,'2026-11-15-poll-dedupe-corrected');
const driver=path.join(corrected,'corrected-preparation-v3');
const attempt=path.join(driver,'corrected-attempt-1');
const read=f=>fs.readFileSync(f); const str=f=>read(f).toString('utf8').replace(/^\uFEFF/,''); const json=f=>JSON.parse(str(f));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const report={at:new Date().toISOString(),runtime:process.version};
const plainRows=rows=>rows.map(({status,...r})=>r);
try {
  const wire=json(path.join(corrected,'wire-fixtures.json')); const result=json(path.join(attempt,'result.json'));const final=json(path.join(attempt,'post-drain-readback.json'));
  const requests=json(path.join(attempt,'probe-requests.json'));const completions=json(path.join(driver,'execution-completions.json'));
  assert.equal(result.verdict,'unconfirmed or incomplete');assert.match(result.failure.message,/^corrected-lone-P3/);assert.equal(completions.correctedNative.exitCode,1);assert.equal(result.observations.length,21);
  assert.equal(requests.filter(x=>x.label).length,21);assert.equal(requests.filter(x=>x.label===null).length,29);assert.equal(requests.filter(x=>x.unexpected).length,0);
  const tagFor=new Map(Object.entries(wire.sources).map(([k,v])=>[v.value,k]));const observed=[];const allIds=new Set();let sampleGroups=0;
  for(const target of wire.targetOrder){let previous=[];const seen=new Set();const summaries=[];
    for(const input of wire.phases.corrected[target]){
      const data=JSON.parse(input.body);const newKeys=[];
      if(target==='items'){for(const item of data.items){if(!item.key.isWellFormed()||seen.has(item.key))continue;seen.add(item.key);newKeys.push(tagFor.get(item.key));}}
      else if(target==='unkeyed')newKeys.push('omitted');
      else{const key=data.key.slice(0,512);if(key.isWellFormed()&&!seen.has(key)){seen.add(key);newKeys.push(tagFor.get(key));}}
      assert.deepEqual([...newKeys].sort(),[...input.expectedNew].sort(),`wire oracle ${input.label}`);
      const durable=json(path.join(attempt,input.label+'-durable.json'));
      assert.deepEqual(plainRows(durable.before),plainRows(previous),`prior durability ${input.label}`);
      const beforeIds=new Set(durable.before.map(r=>r.id));const added=durable.after.filter(r=>!beforeIds.has(r.id));
      assert.deepEqual(added.map(r=>r.keyTag).sort(),newKeys.sort(),`new identity ${input.label}`);
      for(const row of durable.after){const thread=JSON.parse(row.initialThreadText);const event=JSON.parse(row.queued.payloadText);
        assert.equal(Buffer.from(row.initialThreadHex,'hex').toString('utf8'),row.initialThreadText);assert.equal(Buffer.from(row.queued.payloadHex,'hex').toString('utf8'),row.queued.payloadText);
        assert.deepEqual(event.initialThread,thread);assert.equal(row.queued.seq,1);assert.equal(thread.run.id,row.id);assert.equal(thread.invocation.trigger.nodeId,'poll');
        const trigger=thread.invocation.trigger;assert.equal(Object.hasOwn(trigger,'dedupeKey'),row.hasKey);
        if(row.hasKey){assert.equal(trigger.dedupeKey,row.key);assert(row.key.isWellFormed());assert.equal(Buffer.from(row.key,'utf8').toString('hex').toUpperCase(),row.sqliteExtractedKeyHex);}
      }
      for(const row of added){assert(!allIds.has(row.id));allIds.add(row.id);assert.equal(row.caseLabel,input.label);const trigger=JSON.parse(row.initialThreadText).invocation.trigger;const expectedPayload=target==='items'?data.items.find(item=>item.key===row.key):undefined;if(expectedPayload)assert.deepEqual(trigger.payload,expectedPayload);else assert.deepEqual(trigger.payload.json,data);}
      const rest=json(path.join(attempt,input.label+'-rest.json'));const ids=rest.list.flatMap(page=>{assert.equal(page.status,200);assert.deepEqual(JSON.parse(page.text),page.json);return page.json.items.map(r=>r.id);});assert.equal(rest.list.at(-1).json.nextCursor,null);assert.deepEqual(ids.sort(),durable.after.map(r=>r.id).sort());
      for(const sample of Object.values(rest.samples)){assert.equal(sample.length,3);assert(sample.every(x=>x.status===200));sampleGroups++;}
      const request=requests.find(r=>r.label===input.label);assert.equal(Buffer.from(request.wireBase64,'base64').toString('utf8'),input.body);assert.equal(hash(Buffer.from(request.wireBase64,'base64')),request.wireSha256);assert.deepEqual(request,durable.delivered);
      summaries.push({label:input.label,newTags:newKeys,after:durable.after.length});previous=durable.after;
    }
    assert.deepEqual(plainRows(previous),plainRows(final.rows[target]));observed.push({target,phases:summaries,finalTags:previous.map(r=>r.keyTag)});
  }
  assert.equal(allIds.size,15);assert.equal(sampleGroups,17);assert.equal(final.counts.reduce((n,r)=>n+r.count,0),15);
  const warnings=[];for(const file of ['initial-gateway.log','restart-gateway.log']){const raw=str(path.join(attempt,file));assert(!/canary/i.test(raw));for(const [i,line] of raw.split(/\r?\n/).entries()){if(!line)continue;const entry=JSON.parse(line);if(entry.level>=40)warnings.push({file,line:i+1,entry});}}
  assert.equal(warnings.length,20);const used=new Set();const windows=[];const timingExceptions=[];
  for(const o of result.observations){const input=wire.phases.corrected[o.target].find(x=>x.label===o.label);const data=JSON.parse(input.body);const indices=o.target==='items'?data.items.flatMap((x,i)=>x.key.isWellFormed()?[]:[i]):o.target==='unkeyed'||data.key.slice(0,512).isWellFormed()?[]:[null];
    const gateway=result.gatewayProcesses.find(g=>g.label===(/-P[45]$/.test(o.label)?'restart':'initial'));const lower=Date.parse(o.armed.nextPollAt);const upper=Date.parse(o.barrier.received.wall);const probe=Date.parse(o.delivered.received.wall);
    assert(lower<=probe&&Date.parse(o.delivered.finished.wall)<upper);assert.equal(gateway.exit.code,0);assert.equal(gateway.drain.status,202);
    const selected=warnings.filter(w=>w.entry.pid===gateway.pid&&w.entry.loopId===result.loops[o.target].loopId&&w.entry.time>=lower&&w.entry.time<upper);assert.equal(selected.length,indices.length,o.label);
    for(const [n,w] of selected.entries()){assert(!used.has(w));used.add(w);const e=w.entry;assert.equal(e.nodeId,'poll');assert.equal(e.level,40);assert.equal(e.reason,'MALFORMED_DEDUPE_KEY');assert.equal(e.code,o.target==='items'?'POLL_ITEM_REJECTED':'POLL_DEDUPE_KEY_INVALID');assert.equal(e.msg,o.target==='items'?'poll item rejected':'poll trigger failed');const keys=['level','time','pid','hostname','loopId','nodeId','code','reason','msg',...(o.target==='items'?['itemIndex']:[])];assert.deepEqual(Object.keys(e).sort(),keys.sort());if(o.target==='items')assert.equal(e.itemIndex,indices[n]);assert(Buffer.byteLength(JSON.stringify(e))<512);if(e.time<probe)timingExceptions.push({label:o.label,line:w.line,fromDueMs:e.time-lower,fromProbeReceivedMs:e.time-probe});}
    windows.push({target:o.target,label:o.label,lower,upper,expected:indices.length});
  }
  for(const target of wire.targetOrder){const own=windows.filter(w=>w.target===target).sort((a,b)=>a.lower-b.lower);for(let n=1;n<own.length;n++)assert(own[n-1].upper<=own[n].lower);}
  assert.equal(used.size,20);assert.deepEqual(timingExceptions,[{label:'corrected-lone-P3',line:164,fromDueMs:30,fromProbeReceivedMs:-1},{label:'corrected-split-P3',line:165,fromDueMs:31,fromProbeReceivedMs:-1}]);
  assert.deepEqual(result.gatewayProcesses[0].sqlite,result.gatewayProcesses[1].sqlite);assert.notEqual(result.gatewayProcesses[0].pid,result.gatewayProcesses[1].pid);
  const restart=json(path.join(attempt,'restart-first-due.json'));const restartTimes=Object.fromEntries(Object.entries(restart).map(([k,v])=>[k,{readyMs:v.observedMsFromReady,dueMs:v.observedMsFromDue}]));
  const hold=result.heldEvidence[0];assert.equal(result.heldEvidence.length,1);const heldRequest=requests.find(r=>r.label===hold.label);const overlap=requests.filter(r=>r.target==='items'&&r.received.monoMs>heldRequest.received.monoMs&&r.received.monoMs<heldRequest.released.monoMs);assert.deepEqual(overlap,[]);assert.equal(hold.inFlightWhilePastDue,1);assert.equal(hold.maxInFlight,1);assert.equal(hold.unaffectedIds.length,4);assert(hold.duringAt.monoMs<heldRequest.released.monoMs);assert(Date.parse(hold.duringAt.wall)>Date.parse(hold.advanced.nextPollAt));
  const cleanups=[];for(const dir of ['corrected-attempt-1','race-attempt-1']){const c=json(path.join(driver,dir,'cleanup.json'));assert.equal(c.error,null);assert(c.storeRemoved&&c.cleanDrain&&c.allPresentSqliteFilesHeldAtOnce);assert.deepEqual(c.afterOwnership.listeners,[]);assert.deepEqual(c.afterOwnership.presentPids,[]);assert.equal(c.resultSha256,hash(read(path.join(driver,dir,'result.json'))));cleanups.push({attempt:dir,storeRemoved:c.storeRemoved,cleanDrain:c.cleanDrain});}
  const ports=json(path.join(driver,'ports-attempt-1/result.json'));assert.equal(ports.failure,null);assert.equal(ports.cases.length,20);
  const race=json(path.join(driver,'race-attempt-1/result.json'));assert.equal(race.failure,null);assert.equal(race.outcomes.filter(x=>x.admitted).length,1);assert(race.outcomes.every(x=>x.fulfilled));assert.equal(Object.values(race.notifications).flat().length,1);assert.equal(Object.values(race.events).flat().length,1);
  const baselineDir=path.join(q,'2026-11-15-poll-dedupe-baseline/old-attempt-1');const old=json(path.join(baselineDir,'post-drain-readback.json'));const oldRows=Object.values(old.rows).flat();assert.equal(oldRows.length,34);assert.equal(new Set(oldRows.map(r=>r.id)).size,34);assert.equal(oldRows.filter(r=>r.hasKey&&!JSON.parse(r.initialThreadText).invocation.trigger.dedupeKey.isWellFormed()).length,20);
  const binding=json(path.join(attempt,'source-and-build.json'));assert(read(path.join(attempt,'source-and-build.json')).equals(read(path.join(attempt,'source-and-build-after.json'))));
  const sourceDifferences=[];for(const [p,v] of Object.entries(binding.sources)){if(hash(read(path.join(repo,p)))!==v.sha256)sourceDifferences.push(p);}assert.deepEqual(sourceDifferences,['docs/delivery/2026-11-13-four-intents-register.md']);
  for(const [p,digest] of Object.entries(binding.built))assert.equal(hash(read(path.join(repo,p))),digest,p);
  report.corrected={observed,sampleGroups,durableIds:allIds.size,warningCount:warnings.length,timingExceptions,restartTimes,heldMs:heldRequest.released.monoMs-heldRequest.received.monoMs,heldNoOverlappingRequest:true,cleanups,portsCases:ports.cases.length,raceOutcomes:race.outcomes,sourceInputs:Object.keys(binding.sources).length,sourceDifferences,builtFiles:Object.keys(binding.built).length,sourceAndBuildSHA256:hash(read(path.join(attempt,'source-and-build.json'))),originalNativeExit:completions.correctedNative.exitCode,rerunsPerformed:0};
  report.baseline={durableIds:oldRows.length,malformedIds:20,byTarget:Object.fromEntries(Object.entries(old.rows).map(([k,v])=>[k,v.length]))};report.pass=true;
} catch(error){report.pass=false;report.failure={message:error.message,stack:error.stack};process.exitCode=1;}
fs.writeFileSync(path.join(out,'independent-native-readback.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
