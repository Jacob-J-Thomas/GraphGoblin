// Final public reads of the wider store, including the catalog minimal+none deduplication control.
import path from'node:path';import*as L from'./qa.mjs';
const rec=new L.Recorder('postconditions');let g;
try{const dir=L.state.wide.dir;g=await L.startGateway({dir,port:6372,label:'wide-postconditions',env:{GG_CODEX_BINARY:path.join(dir,'fake/codex.exe'),GG_CLAUDE_BINARY:path.join(dir,'fake/claude.exe')},rec});
 const cat=await g.call('/model-catalog');const row=cat.json.items?.find(x=>x.model==='qa205b-custom');rec.check('repaired custom catalog serves unique none, low and default none',cat.status===200&&L.same(row?.efforts,['none','low'])&&row?.defaultEffort==='none',{status:cat.status,row});
 const checks=[];for(const url of['/settings','/loops',...Object.values(L.state.wide.loops).map(id=>'/loops/'+id),...Object.values(L.state.wide.runs).map(id=>'/runs/'+id+'/sessions')]){const r=await g.call(url);checks.push({url,status:r.status});}
 rec.check('repaired wider store also serves Settings, loops and all session lists',checks.every(x=>x.status===200),checks);
}catch(e){rec.check('postconditions exception',false,String(e.stack??e));}finally{if(g){await g.stop();g.copyLog('wide-postconditions-gateway.log.txt');}rec.finish();}
