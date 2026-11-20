import fs from 'node:fs/promises';
import path from 'node:path';
const [root,runtime]=process.argv.slice(2);
const capture=JSON.parse(await fs.readFile(path.join(root,'replay-inputs/prior-live-collision.json'),'utf8'));
const {url,token}=JSON.parse(await fs.readFile(path.join(runtime,'private-session.json'),'utf8'));
const cases=[['restored-delete','restore'],['fresh-delete','fresh'],['unique-delete','unique'],['both-owned-delete','owned'],['description-control','description'],['target-rename','rename']];
const loops={},receipts=[];
for(const[key,kind]of cases){
 const definition=structuredClone(capture.definition);definition.name='Topology '+key;
 definition.nodes.find(n=>n.id==='pick').config.routes[1].id=['restore','owned'].includes(kind)?'no':'affirm';
 if(kind==='unique')definition.edges[2].id='e2';
 const response=await fetch(url+'/loops',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({definition})}),body=await response.json();
 if(response.status!==201)throw new Error('Fixture POST '+key+' returned '+response.status+' '+JSON.stringify(body));
 loops[key]={id:body.loop.id,name:definition.name,kind};
 receipts.push({case:key,method:'POST',route:'/loops',status:response.status,input:definition,definition:body.draft.definition,issues:body.draft.issues});
}
await fs.mkdir(path.join(root,'records'),{recursive:true});
await fs.writeFile(path.join(root,'records/loops.json'),JSON.stringify(loops,null,2));
await fs.writeFile(path.join(root,'records/api-fixtures.json'),JSON.stringify(receipts,null,2));
console.log(JSON.stringify({fixtures:cases.length,apiStatuses:receipts.map(r=>r.status)}));
