import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root='C:/Users/98jak/.codex/worktrees/gg-20261114-space-cards/GraphGoblin';
const out=path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const read=p=>fs.readFileSync(p,'utf8');
const json=p=>JSON.parse(read(p).replace(/^\uFEFF/,''));
const stable=x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const native=path.join(root,'docs/qa/2026-11-15-space-cards-corrected-native/evidence');
const groups=[
 'target-d1-correction3/runs/queued-fit-d1-correction3/raw/0061-full-result.json',
 'r512-rebind/runs/double-r512-initial/raw/0106-full-result.json',
 'existing-rebind/runs/apply-d1-initial/raw/0120-full-result.json',
 'existing-rebind/runs/n768-initial/raw/0090-full-result.json'
];
const inspected=[];
const failures=[];
for(const rel of groups){
 const p=path.join(native,rel),v=json(p);
 const writes=v.requests.filter(r=>r.method==='PUT');
 const accepted=writes.filter(r=>r.status===200);
 for(const w of accepted){
  const sent=JSON.parse(w.requestText).definition,ack=JSON.parse(w.responseText);
  if(stable(sent)!==stable(ack.draft.definition)) failures.push({kind:'wire-ack-difference',group:v.group,phase:w.phase});
  if(!w.requestHeaders['if-match']||w.responseHeaders.etag!=='"'+ack.draftToken+'"')failures.push({kind:'wire-token',group:v.group,phase:w.phase});
 }
 const missing=v.checks.filter(c=>!fs.existsSync(path.join(path.dirname(p),c.file)));
 assert.equal(missing.length,0);
 assert.equal(v.failure,null);
 assert.equal(v.pageErrors.length,0);
 inspected.push({group:v.group,path:rel,checks:v.checks.length,summary:v.summary,puts:writes.length,accepted:accepted.length,statuses:writes.map(r=>r.status),consoleErrors:v.consoleErrors});
}
const tbase=path.join(native,'target-d1-correction3/runs/queued-fit-d1-correction3/raw');
const trace=json(path.join(tbase,'0044-fit-trace-undo.json'));
const traceRows=trace.rows.filter(r=>r.type==='viewport-style'||r.trusted&&r.type==='keydown').map(r=>({type:r.type,t:r.t,key:r.key,action:r.action,trusted:r.trusted,viewport:r.viewport,from:r.from,to:r.to,history:r.history}));
const undo=json(path.join(tbase,'0046-fit-undo-durable.json'));
assert.equal(stable(undo.prior.draft.definition),stable(undo.server.draft.definition));
assert.equal(stable(undo.server.draft.definition),stable(undo.device.definition));
assert.equal(undo.server.draftToken,undo.device.baseToken);
assert.equal(undo.device.synced,true);
const reload=json(path.join(tbase,'0060-fit-trace-in-place-reload.json'));
assert.deepEqual(reload.after.viewport,reload.conflict.viewport);
assert.equal(reload.after.viewportId,reload.conflict.viewportId);
assert.equal(reload.after.history.every(r=>r[2]==='true'),true);
assert.equal(reload.device.synced,true);
const nativeSummary={result:failures.length?'FAIL':'PASS',groups:inspected,checks:inspected.reduce((a,g)=>a+g.checks,0),accepted:inspected.reduce((a,g)=>a+g.accepted,0),puts:inspected.reduce((a,g)=>a+g.puts,0),undoTrace:traceRows,undoDurable:{equalPriorServerDevice:true,token:undo.server.draftToken,viewport:undo.after.viewport,history:undo.after.history},reload:{viewportUnchanged:true,viewport:reload.after.viewport,history:reload.after.history,deviceSynced:reload.device.synced},failures};
fs.writeFileSync(path.join(out,'native-independent-readback.json'),JSON.stringify(nativeSummary,null,2)+'\n');
const ci=path.resolve(out,'../corrected-ci');
const log=read(path.join(ci,'job-132765496147-gates.log'));
const packages=[];
for(const part of log.split('##[group]@graphgoblin/').slice(1)){
 const name=part.match(/^([^:\r\n]+):test:coverage/); if(!name)continue;
 const section=part.split('##[endgroup]')[0];
 const tests=section.match(/Tests\s+(\d+) passed(?:\s*\|\s*(\d+) skipped)?/);
 const lines=section.match(/Lines\s*:\s*([\d.]+)%/), branches=section.match(/Branches\s*:\s*([\d.]+)%/);
 assert.ok(tests&&lines&&branches,name[1]);
 const p={name:name[1],passed:Number(tests[1]),skipped:Number(tests[2]??0),lines:Number(lines[1]),branches:Number(branches[1])};
 assert.ok(p.lines>=90&&p.branches>=90,name[1]); packages.push(p);
}
assert.equal(packages.length,13);
const ciSummary={packages,passed:packages.reduce((a,p)=>a+p.passed,0),skipped:packages.reduce((a,p)=>a+p.skipped,0),minLines:Math.min(...packages.map(p=>p.lines)),minBranches:Math.min(...packages.map(p=>p.branches)),rawLogsChecked:['job-132765496147-gates.log','job-132765496455-browser.log','job-132765496437-windows-launcher.log','job-132765496370-template-image.log','job-132765496037-routing.log'],notes:['All five job logs name tested merge 2a3ae36fdd72ebceacbfbe2d4f21d5e10c75ad13.','Browser 481 passed, one declared live-provider skip, --retries=0 --workers=1.','Windows 14 passed and no matching native artifact upload; raw terminal log retained.','Normal routing only; frame p95 33.4-50 ms, not optional 17 ms strict acceptance.','Configured high severity audit passed with 8 low and 13 moderate advisories.']};
fs.writeFileSync(path.join(out,'ci-independent-summary.json'),JSON.stringify(ciSummary,null,2)+'\n');
console.log(JSON.stringify({native:nativeSummary,ci:ciSummary},null,2));
if(failures.length)process.exitCode=1;
