import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as L from './lib.mjs';
export * from './lib.mjs';
export const stateFile=path.join(os.tmpdir(),'gg-qa205b-state.json');
export const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
export const saveState=()=>fs.writeFileSync(stateFile,JSON.stringify(state));
export function fake(dir) {
  const cli=path.join(dir,'fake');fs.mkdirSync(cli,{recursive:true});
  for(const n of ['codex.exe','claude.exe']) fs.copyFileSync(path.join(state.tools,'fake',n),path.join(cli,n));
  const read=n=>fs.existsSync(path.join(cli,n))?fs.readFileSync(path.join(cli,n),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
  return {cli,env:{GG_CODEX_BINARY:path.join(cli,'codex.exe'),GG_CLAUDE_BINARY:path.join(cli,'claude.exe')},requests:()=>read('requests.jsonl'),argv:()=>read('argv.jsonl')};
}
export async function run(g,id,body={input:null}) {
  const start=await g.call(`/loops/${id}/runs`,{method:'POST',body});
  if(start.status!==202) throw new Error('start '+JSON.stringify(start));
  const id2=start.json.run.id;
  const done=await L.waitRun(g.call,id2,['succeeded','failed','cancelled'],20000);
  return {id:id2,done,events:await L.events(g.call,id2)};
}
export const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export async function sql(dir,sql,args=[]) {return L.withDb(dir,db=>db.execute({sql,args}));}
export const scale=['none','low','medium','high','xhigh','max'];
export async function catalogEfforts(dir,harness,model,efforts) {return sql(dir,'UPDATE model_catalog SET efforts=? WHERE harness=? AND model=?',[JSON.stringify(efforts),harness,model]);}
export const findIssues=r=>(r.json?.issues??r.json?.details?.issues??[]);
