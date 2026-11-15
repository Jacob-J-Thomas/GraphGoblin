import assert from 'node:assert/strict';
import fs from 'node:fs';
let source=fs.readFileSync('verify-pan-diagnostic.playwright.js','utf8');
function replace(before,after) {
  assert.equal(source.split(before).length,2,'Cannot bind driver hunk: '+before);
  source=source.replace(before,after);
}
replace("const trace=[], identities=new WeakMap();","const trace=[], identities=new WeakMap(), fnKeys=new WeakMap();\n      let fnSequence=0;");
replace("      const getButton=()=>","      function functionKey(value) {\n        if(typeof value!=='function')return null;\n        if(!fnKeys.has(value))fnKeys.set(value,++fnSequence);\n        return fnKeys.get(value);\n      }\n      function listeners() {\n        const raw=Array.isArray(window.__on)?window.__on:[];\n        return raw.map(({type,name,options,value,listener})=>({type,name,\n          capture:typeof options==='boolean'?options:options?.capture??false,\n          passive:typeof options==='object'?options?.passive??null:null,\n          valueKey:functionKey(value), wrappedKey:functionKey(listener),\n          valueText:typeof value==='function'&&type==='click'&&name==='drag'?Function.prototype.toString.call(value):null}));\n      }\n      const getButton=()=>");
replace("return { button:name(button), box:", "return { d3WindowListeners:listeners(), button:name(button), box:");
replace("setTimeout(()=>{entry.defaultAfterDispatch=event.defaultPrevented;},0);", "queueMicrotask(()=>{entry.defaultAfterDispatch=event.defaultPrevented;entry.d3AfterMicrotask=listeners();});\n          setTimeout(()=>{entry.defaultAfterDispatch=event.defaultPrevented;entry.d3AfterTask=listeners();},0);");
replace("    await one('post-pan',id,tracked,last,true);\n    // Real second independent loop in the same isolated gateway and browser session,\n    // with the byte-equivalent selected edge and exact previously accepted topology.\n    const copy=structuredClone(last.draft.definition);\n    copy.name+=' zoom control';\n    const controlId=await create(copy);\n    await open(controlId,copy.name);\n    const current=await get(controlId);\n    same(current.draft.definition,copy,'Steady zoom control starts with the identical graph edges');\n    await one('zoom-control',controlId,tracked,current,false);",`    await one('post-pan',id,tracked,last,true);
    const primary=checkpoints.find(e=>e.label==='post-pan');
    const wanted='Remove native click';
    const active=primary.events.find(e=>e.stage===wanted&&e.type==='click'&&e.phase==='capture');
    const suppressed=active?.state.d3WindowListeners.find(e=>e.type==='click'&&e.name==='drag'&&e.capture);
    checkpoints.push({label:'causal classification before positive control',won:primary.putCount===1,
      clickExists:Boolean(active),metadata:suppressed??null,canceled:active?.defaultAfterDispatch});
    if(primary.putCount!==0||!suppressed||!active.defaultAfterDispatch)return;
    const beforeSettled=await get(id);
    const beforeDevice=await device(id,beforeSettled.draftToken);
    same(beforeSettled,last,'The same exact unchanged edge is still available');
    same(beforeDevice,primary.deviceBefore,'Settled control starts from the same exact device and token');
    const button=page.getByRole('button',{name:delivered.removeName,exact:true});
    await page.waitForFunction(()=>!window.__on?.some(e=>e.type==='click'&&e.name==='drag'),null,wait);
    const position=await center(button);
    await markPan('same edge listener cleared before trusted Remove',position);
    const positive=await editAndRead(id,async()=>{
      await page.mouse.click(position.x,position.y);
    },last,'listener-clear control removes only the same edge once');
    same(delta(last,positive),{gone:[tracked],added:[]},'Settled click removed the exact selected edge');
    const absent=!(await line(tracked.id).count());
    check(absent,'Settled click cleared edge from actual canvas');
    const trace=await panTrace();
    const controlClick=trace.find(e=>e.stage==='same edge listener cleared before trusted Remove'&&
      e.type==='click'&&e.phase==='capture');
    check(controlClick?.trusted,'Settled control emitted trusted actual click');
    same(controlClick.state.d3WindowListeners.some(e=>e.type==='click'&&e.name==='drag'),false,'Listener cleared');
    same(controlClick.defaultAfterDispatch,false,'Settled button click was not prevented');
    checkpoints.push({label:'same unchanged edge, listener-clear native control',position,trace,absent,
      persisted:positive,device:await device(id,positive.draftToken)});
    const restored=await editAndRead(id,undo,positive,'one Undo restores only the removed edge');
    same(restored.draft.definition,last.draft.definition,'One Undo restores the exact pre-click graph');
    await edgeEvidence(tracked.id);
    const undone=await get(id);
    checkpoints.push({label:'single Undo exact history',undone,device:await device(id,undone.draftToken)});
`);
fs.writeFileSync('verify-pan-cause.playwright.js',source,{flag:'wx'});
const prior=fs.readFileSync('run-pan-diagnostic.mjs','utf8');
assert(prior.includes("'verify-pan-diagnostic.playwright.js'"));
fs.writeFileSync('run-pan-cause.mjs',prior.replace("'verify-pan-diagnostic.playwright.js'","'verify-pan-cause.playwright.js'"),{flag:'wx'});
