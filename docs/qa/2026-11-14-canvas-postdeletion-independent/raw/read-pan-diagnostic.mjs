import fs from 'node:fs';
const x=JSON.parse(fs.readFileSync('runs/corrected-decisions-pan-diagnostic/observed.json'));
const pan=x.checkpoints.find(e=>e.label==='post-pan');
console.log(JSON.stringify({writes:x.writes.length,checkpoints:x.checkpoints.map(e=>e.label),putCount:pan?.putCount,
  response:pan?.response && (pan.response.error??'200'),token:[pan?.before.draftToken,pan?.after.draftToken],
  device:[pan?.deviceBefore.baseToken,pan?.deviceAfter.baseToken]},null,2));
for(const e of pan?.events??[]) { if(e.phase==='bubble') continue;
  console.log(e.stage,e.type,e.trusted,e.buttons,e.defaultAtCapture,e.defaultAfterDispatch,
    e.target?.tag,e.target?.key,e.target?.label,e.target?.className?.slice(0,120),
    'hit:',e.state?.hits?.[0]?.tag,e.state?.hits?.[0]?.key,
    'button:',e.state?.button?.key,e.state?.button?.disabled,
    'selected:',e.state?.selected,'dragging:',e.state?.dragging?.length,e.state?.viewportStyle);
}