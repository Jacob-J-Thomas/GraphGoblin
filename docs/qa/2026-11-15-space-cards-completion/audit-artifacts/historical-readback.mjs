import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const base='C:/Users/98jak/.codex/worktrees/gg-20261114-space-cards/GraphGoblin/docs/qa/2026-11-15-space-cards-final-native';
const out=path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const read=rel=>JSON.parse(fs.readFileSync(path.join(base,rel),'utf8').replace(/^\uFEFF/,''));
const rows=[];
for(const group of fs.readdirSync(path.join(base,'runs'))){
 const raw=`runs/${group}/raw`;
 for(const file of fs.readdirSync(path.join(base,raw)).filter(n=>n.endsWith('full-result.json'))){
  const v=read(`${raw}/${file}`);
  const puts=v.requests.filter(x=>x.method==='PUT');
  rows.push({group:v.group,run:group,summary:v.summary,failure:v.failure,checks:v.checks.length,statuses:puts.map(x=>x.status),pageErrors:v.pageErrors});
 }
}
const passing=rows.filter(r=>r.failure===null);
assert.equal(passing.length,7);
assert.equal(passing.reduce((a,r)=>a+r.checks,0),310);
assert.equal(passing.reduce((a,r)=>a+r.statuses.length,0),48);
assert.equal(passing.flatMap(r=>r.statuses).filter(s=>s===200).length,46);
const pane=read('runs/outside-d1-initial/raw/0015-outside-pane.json');
assert.ok(pane.before.result);assert.equal(pane.after.result,null);
assert.ok(pane.before.selected.length);assert.equal(pane.after.selected.length,0);
assert.deepEqual(pane.after.viewport,pane.before.viewport);
const press=pane.trusted.find(e=>e.type==='pointerdown');
assert.equal(press.trusted,true);assert.equal(press.target,'pane');assert.equal(press.canceledAfterDispatch,false);
const gate=read('runs/gestures-d1-initial/raw/0067-pan-states-space.json');
assert.ok(gate.whilePan.buttons.every(b=>b.unavailable&&b.gesture==='panning'&&!b.disabled&&b.attached));
assert.equal(gate.heldAfter.live.text,'');assert.equal(gate.heldAfter.result,null);
assert.equal(gate.first.button.unavailable,false);assert.equal(gate.after.result.text,'Spaced 6 cards.');
const touch=read('runs/touch-d2-initial/raw/0016-stable-result-coarse-repeats.json');
assert.deepEqual(touch.before,touch.after.box);assert.equal(touch.after.focusable,false);assert.equal(touch.after.live,false);
const reload=read('runs/device-d1-initial/raw/0028-conflict-reload.json');
assert.deepEqual(reload.device.definition,reload.server.draft.definition);
assert.equal(reload.device.baseToken,reload.server.draftToken);assert.equal(reload.device.synced,true);
const summary={result:'PASS',source:'af583977ef1ace8fa086eb54b0b66c38f263b1ef',tier:'retained historical native evidence; not rerun on e123 or by this auditor',rows,passingGroups:7,checks:310,acceptedPuts:46,putAttempts:48,selectedIndependentRawChecks:{outsidePane:{beforeResult:!!pane.before.result,afterResult:pane.after.result,beforeSelected:pane.before.selected,afterSelected:pane.after.selected,viewportUnchanged:true,trustedPointerDownDeliveredUncancelled:true},gate:{activeUnavailable:true,heldEnterNoResult:true,firstAvailableActs:true},coarseResult:{box:touch.after.box,stable:true,physicalHardware:false},deviceReload:{exactServerDeviceDefinition:true,token:reload.device.baseToken,synced:true}},limits:['Original fit is superseded; only unchanged result, gesture, keyboard and recovery observations are used from this source.','Native mouse gate observation used trusted Enter while mouse held; no separate unavailable pointer-click observation.','Coarse pointer is emulated.']};
fs.writeFileSync(path.join(out,'historical-native-independent-readback.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
