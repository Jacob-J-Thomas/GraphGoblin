import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
export { assert };
export const ROOT='G:/ggq/gg-i4-486-d204-qa/GraphGoblin';
export const E='G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-supplemental-independent-01';
export const SCRATCH='G:/ggq/qa-scratch/i4-486-supplemental-independent-01';
export const imp=(p)=>import(pathToFileURL(join(ROOT,p)).href);
export const testing=await imp('packages/engine/dist/testing/index.js');
export const engine=await imp('packages/engine/dist/index.js');
export const domain=await imp('packages/domain/dist/index.js');
export const pub=await imp('packages/engine/dist/failure-publication.js');
export const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
export const canon=(v)=>JSON.stringify(v);
export const turns=(evs)=>evs.filter(x=>x.type==='harness.turn');
export const inf=(config={})=>({id:'infer',kind:'inference',label:'Infer',config:{prompt:{template:'D205 exact original task'},...config}});
export const loop=(name,config={},settings)=>({...testing.singleNodeLoop(name,inf(config)),...(settings?{settings}:{})});
export function recorder(group){
 const attempt=Number(process.env.QA_ATTEMPT??1),out=join(E,'results',group,`attempt-${attempt}`);mkdirSync(out,{recursive:true});
 const rows=[];const raw=(kind,data)=>appendFileSync(join(out,'raw.jsonl'),JSON.stringify({t:new Date().toISOString(),kind,data})+'\n');
 const record=(name,value)=>{writeFileSync(join(out,name),JSON.stringify(value,null,2)+'\n');};
 raw('identity',{pid:process.pid,node:process.version,cwd:process.cwd(),group,attempt,source:'4d982162ca60e885d5af22f66076383a048215db'});
 async function scenario(id,fn){
  try{const actual=await fn();const row={id,pass:true,class:'BUILT-PUBLIC-RUNMANAGER+SCRIPTED',actual};rows.push(row);raw('scenario',row);}
  catch(error){const row={id,pass:false,error:String(error.stack??error)};rows.push(row);raw('scenario',row);record('results.json',{group,rows});throw error;}
 }
 function finish(extra={}){const summary={group,total:rows.length,passed:rows.filter(x=>x.pass).length,failed:rows.filter(x=>!x.pass).length,pid:process.pid,...extra};record('results.json',{summary,rows});process.stdout.write(JSON.stringify(summary)+'\n');return summary;}
 return {out,raw,record,scenario,finish};
}
export async function withEngine(fn,settings={},portOptions={}){const e=await testing.createTestEngine(settings,portOptions);try{return await fn(e);}finally{e.manager.stop();await e.manager.waitForIdle();}}
export function snapshot(e,id){return {events:e.events(id),logs:e.ports.logger.lines,starts:e.ports.harness.started,resumes:e.ports.harness.resumed,cancels:e.ports.harness.cancelled,sessions:e.ports.sessions.rows};}
export function noAuthored(f){assert.ok(!f.details?.phase);assert.ok(!f.details?.boundary);assert.ok(!f.message.includes('received the provider result'));}
export function parity(e,run){const failed=e.events(run.id).filter(x=>x.type==='run.failed').at(-1);assert.deepEqual(failed?.failure,run.failure);}
export function inferEvidence(f,kind='authored'){assert.equal(f.inference?.promptKind,kind);assert.ok(f.inference?.turnId);assert.equal(f.inference?.submission,'delivery-uncertain');}
export const coerce=(target='/vars/repaired',repair={})=>({op:'coerce',source:'/lastOutput/value',target,jsonSchema:{type:'boolean'},repair:{enabled:true,maxAttempts:1,...repair}});
export const set=(path,value)=>({op:'set',path,value:{kind:'literal',value}});
