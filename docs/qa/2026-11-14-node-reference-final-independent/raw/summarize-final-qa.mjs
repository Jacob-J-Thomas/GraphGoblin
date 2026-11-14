import fs from 'node:fs';
const browser=JSON.parse(fs.readFileSync('runs/corrected-activation-final1/observed.json'));
const domain=JSON.parse(fs.readFileSync('runs/corrected-lookup-final-initial-native/observed.json'));
const groups=browser.checkpoints.filter(x=>x.label.endsWith('initial native down/up')).map(step=>{
  const primary=step.interaction.held.original.key;
  return {gesture:step.label,control:primary,events:step.events.filter(e=>['pointerdown','pointerup','click','bubble-click'].includes(e.type))
    .map(e=>({type:e.type,at:e.at,trust:e.trust,button:e.geometry?.control?.key,box:e.geometry?.control?.box,
      dialogNotice:e.geometry?.dialogReport,pageNotice:e.geometry?.pageReport,source:e.geometry?.source,
      topLayer:e.geometry?.modal,focus:e.focus?.key}))};
});
const result={source:'09167b3ec5d0bd553981ceaa8498ddb9be4c9458',
  browser:{writes:browser.writes.length,checkpoints:browser.checkpoints.length,pageErrors:browser.pageErrors.length,
    outcomes:browser.outcome.map(row=>({action:row.action,kind:row.kind,focus:row.ui?.focused})),groups},
  lookup:{groups:domain.groups.map(x=>x.name),requests:domain.timeline.length,oldPin:domain.groups[0].http.oldRun.result,
    repairedPin:domain.groups[0].newRun.result,rejected:domain.groups[1].rest.attempt.status,
    rejectedCode:domain.groups[1].rest.attempt.data.code,unchangedPin:domain.groups[1].oldRun.result,
    failures:domain.failures.length}};
fs.writeFileSync('final-qa-summary.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
for(const g of groups) console.log(g.gesture, JSON.stringify(g.events.map(e=>[e.type,e.button,e.dialogNotice,e.pageNotice,e.source,e.box?.top])));
console.log(JSON.stringify({browser:result.browser.outcomes,lookup:result.lookup},null,2));
