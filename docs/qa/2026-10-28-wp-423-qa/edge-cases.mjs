// Extra ordinary-string edge cases for server names, via the published-loop API and real SDK.
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';
const prior=JSON.parse(fs.readFileSync(path.join(L.OUT,'results.json')));
const original=prior.disposableStores[0].replaceAll('%USERPROFILE%',process.env.USERPROFILE);
const dir=L.store('server-names'),cli=L.cli(dir,path.join(original,'fake/codex.exe'));
let g;
try{
  g=await L.gateway(dir,6395,cli.env,'server-names');
  for(const names of [['__proto__'],['constructor'],['toString'],['normal','__proto__','other']]){
    const label='server-'+names.join('-');
    cli.set('listing.json',JSON.stringify(names.map(name=>({name,enabled:true,transport:{type:'stdio',command:'qa423'}}))));
    const before=cli.requests().length;const id=await L.start(g,await L.publish(g,L.inference(label)));await L.end(g,id);const snap=await L.snapshot(g,id,label);const requests=cli.requests().slice(before);L.write(label+'-requests.log.txt',requests.map(JSON.stringify).join('\n'));
    L.check(label+' every listed name disabled or turn refused',snap.run.status==='failed'||names.every(n=>L.configs(requests.find(q=>q.kind==='turn')?.argv??[]).includes(`mcp_servers.${n}.enabled=false`)),{run:snap.run,configs:L.configs(requests.find(q=>q.kind==='turn')?.argv??[])});
  }
}catch(error){L.check('server-name driver completed',false,String(error.stack));}
finally{await g?.stop();L.write('server-names-results.json',{checks:L.checks,process:g?{pid:g.pid,exit:g.exit()}:null,store:dir});}
