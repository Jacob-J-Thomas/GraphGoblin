import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import * as L from './lib.mjs';
const rows=[];
for(const name of ['behaviour','lineage','restart','fresh','race','final','force-http','upgrade','child-races','snapshot-cost','failure-projection-native','atomic-definition','script-replay','accessibility','wording']){
 const file=path.join(L.RECORD,name+'-results.json');
 const r=JSON.parse(fs.readFileSync(file,'utf8'));
 rows.push({file:path.basename(file),passed:r.checks.filter(c=>c.passed).length,failed:r.checks.filter(c=>!c.passed).map(c=>c.name),qualification:name==='restart'?'Copied driver stopped on ambiguous locator; preceding checks retained; fresh-results.json completes the same fixture without repeating the native crash.':undefined});
}
const projections=JSON.parse(fs.readFileSync(path.join(L.RECORD,'failure-projection-race-results.json'),'utf8'));
const ports=[];
for(const port of [...Array.from({length:10},(_,i)=>6660+i),...Array.from({length:30},(_,i)=>6970+i)]){
 const listening=await new Promise(resolve=>{const s=net.createConnection({host:'127.0.0.1',port});s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',()=>resolve(false));s.setTimeout(1000,()=>{s.destroy();resolve('unverified');});});
 ports.push({port,listening});
}
if(fs.existsSync(path.join(L.CLI,'requests.jsonl')))L.save('fake-cli-requests.log.txt',fs.readFileSync(path.join(L.CLI,'requests.jsonl'),'utf8'));
L.save('results-summary.json',{rows,projectionScenarios:projections.map(r=>({scenario:r.scenario,refusal:r.refusal?.code,dispatches:r.after.dispatches,afterRestart:r.afterRestart?.recovery.resume.code})),acceptance:JSON.parse(fs.readFileSync(path.join(L.RECORD,'batch-acceptance.json'),'utf8'))});
L.save('cleanup.log.txt',JSON.stringify({ports,allAllocatedPortsClosed:ports.every(p=>p.listening===false),note:'112 recorded owned PIDs absent in owned-pid-check.json; API/MCP exit and Edge close awaited. No directories deleted.'},null,2));
console.log(JSON.stringify({rows:rows.map(r=>({file:r.file,passed:r.passed,failed:r.failed})),allAllocatedPortsClosed:ports.every(p=>p.listening===false)}));
process.exitCode=ports.some(p=>p.listening!==false)?1:0;
