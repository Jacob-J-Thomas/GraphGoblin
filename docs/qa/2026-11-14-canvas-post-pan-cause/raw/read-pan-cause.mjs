import fs from 'node:fs';
import {createHash} from 'node:crypto';
const x=JSON.parse(fs.readFileSync('runs/corrected-decisions-pan-cause/observed.json','utf8'));
const first=x.checkpoints.find(e=>e.label==='post-pan');
const second=x.checkpoints.find(e=>e.label==='same unchanged edge, listener-clear native control');
const undo=x.checkpoints.find(e=>e.label==='single Undo exact history');
const classified=x.checkpoints.find(e=>e.label==='causal classification before positive control');
const trace=second?.trace??first?.events??[];
const eventSummary=[];
const mouseup=trace.find(e=>e.stage==='pan from empty pane'&&e.phase==='capture'&&e.type==='mouseup');
const sh=text=>createHash('sha256').update(text).digest('hex');
function present(els){
  return els?.filter(x=>x.type==='click'&&x.name==='drag').map(x=>({
    name:x.name,type:x.type,capture:x.capture,passive:x.passive,valueKey:x.valueKey,
    wrappedKey:x.wrappedKey,valueText:x.valueText,valueSha256:x.valueText?sh(x.valueText):null
  }))??[];
}
for(const e of trace){
  if(e.phase==='bubble'||!['mouseup','mousedown','pointerdown','pointerup','click','sample'].includes(e.type))continue;
  if(!/pan from empty pane|Remove native click|immediately|same edge listener/.test(e.stage))continue;
  eventSummary.push({stage:e.stage,type:e.type,timeFromPanMouseupMs:Math.round(10*(e.time-(mouseup?.time??0)))/10,
    trusted:e.trusted,buttons:e.buttons,target:e.target?.key,targetTag:e.target?.tag,buttonKey:e.state?.button?.key,
    hitKey:e.state?.hits?.[0]?.key,dragging:e.state?.dragging?.length,canceled:e.defaultAfterDispatch,
    capture:present(e.state?.d3WindowListeners),afterMicrotask:present(e.d3AfterMicrotask),afterTask:present(e.d3AfterTask)});
}
const result={head:'64a955887962f72287e532824be1b8cb32c5f055',allWrites:x.writes.length,pageErrors:x.pageErrors,
  failure:x.failure,classified,firstAction:first?{puts:first.putCount,token:first.before.draftToken,
  persistedTokenAfter:first.after.draftToken,deviceTokenAfter:first.deviceAfter.baseToken,edge:first.edge}:null,
  sameEdgeAfterRemoval:second?{token:second.persisted.draftToken,device:second.device.baseToken,absent:second.absent}:null,
  undo:undo?{token:undo.undone.draftToken,device:undo.device.baseToken}:null,eventSummary};
fs.writeFileSync('pan-cause-summary.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...result,eventSummary:eventSummary.map(e=>({...e,
  capture:e.capture.map(x=>x.valueKey),afterMicrotask:e.afterMicrotask.map(x=>x.valueKey),afterTask:e.afterTask.map(x=>x.valueKey)}))},null,2));
