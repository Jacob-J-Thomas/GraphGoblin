import fs from'node:fs';import path from'node:path';import*as L from'./qa.mjs';
const rec=new L.Recorder('last-checks');
try{
 const call=L.makeCall(L.state.api.origin);const exp=await call('/loops/'+L.state.api.editor+'/export?draft=true');const body=structuredClone(exp.json);const walk=x=>{if(x&&typeof x==='object')for(const k of Object.keys(x)){if(k==='effort'&&typeof x[k]==='string')x[k]='minimal';else walk(x[k]);}};walk(body);
 const imp=await call('/loops/import',{method:'POST',body});rec.check('minimal import is still refused 400 with effort enum explanation',imp.status===400&&imp.json.code==='LOOP_IMPORT_ERROR'&&imp.text.includes('effort'),imp);
 const results=JSON.parse(fs.readFileSync(path.join(L.OUT,'wide-result.json'),'utf8'));const originalDiscovery=results.checks.find(c=>c.id.startsWith('full SELECT')).detail.found;
 const ids=(await L.sql(L.state.wide.dir,'SELECT id FROM loop_versions WHERE loop_id=?',[L.state.wide.loops.authored])).rows.map(r=>r.id);
 rec.check('original pre-repair SELECT did not include any authored-only version',ids.length>0&&!originalDiscovery.some(r=>r.place==='loop_versions'&&ids.some(id=>r.ref.includes(id))),{authoredVersionIds:ids,originalDiscovery});
}catch(e){rec.check('last-checks exception',false,String(e.stack??e));}finally{fs.writeFileSync(path.join(L.state.api.dir,'stop.txt'),'QA re-check complete');rec.finish();}
