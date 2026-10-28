// Read-only QA telemetry in the gateway, not a product patch or private-method hook.
// All stimuli still enter through the public HTTP API. Object.prototype is never modified here.
import fs from 'node:fs';
const file=process.env.QA423B_PROTOTYPE_RECORD;
if(file){
  const baseline=Object.getOwnPropertyDescriptors(Object.prototype);
  let previous='',samples=0;
  function sample(label){
    const current=Object.getOwnPropertyDescriptors(Object.prototype);
    const names=Reflect.ownKeys(current);
    const changed=names.filter(k=>!Object.hasOwn(baseline,k)||!['value','get','set','enumerable','configurable','writable'].every(p=>current[k][p]===baseline[k]?.[p]));
    const removed=Reflect.ownKeys(baseline).filter(k=>!Object.hasOwn(current,k));
    const state=JSON.stringify({names:names.map(String),changed:changed.map(String),removed:removed.map(String)});
    if(state!==previous||label!=='sample'||++samples%10===0)fs.appendFileSync(file,JSON.stringify({at:new Date().toISOString(),pid:process.pid,label,...JSON.parse(state)})+'\n');
    previous=state;
  }
  sample('baseline');
  setInterval(()=>sample('sample'),20).unref();
  process.on('exit',()=>sample('exit'));
}
