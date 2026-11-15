import fs from 'node:fs';
const a=JSON.parse(fs.readFileSync('runs/corrected-pan-after-fit-viewport/observed.json'));
const stage=(rows)=>rows.filter(e=>e.phase==='capture'&&['mouseup','click','wheel'].includes(e.type)||e.type==='sample').map(e=>({
  stage:e.stage,type:e.type,trusted:e.trusted,ms:e.time,aria:e.state.button?.ariaDisabled,
  gesture:e.state.button?.gesture,blocked:e.state.d3WindowListeners.some(v=>v.type==='click'&&v.name==='drag'),
  prevented:e.defaultAfterDispatch,target:e.target?.key,transform:e.state.viewportStyle}));
const main=a.checkpoints.find(e=>e.label==='first observed enabled pointer'&&e.trace);
const over=a.checkpoints.find(e=>e.label==='actual post-overlap availability and viewport hit');
const filtered=stage(over.events).filter(e=>/repeated|wheel|Fit|post-overlap/.test(e.stage));
const source=stage(main.trace);
const projected={first:source,overlap:filtered,reportedLayout:over.layout};
fs.writeFileSync('pan-event-projection.json',JSON.stringify(projected,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(projected,null,2));
