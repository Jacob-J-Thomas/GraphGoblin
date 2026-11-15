import fs from 'node:fs';
const dirs=fs.readdirSync('runs').sort();
let cases=[];
for(const dir of dirs){
 const data=JSON.parse(fs.readFileSync('runs/'+dir+'/run.json'));
 cases.push({dir,puts:data.puts,checkpoints:data.checkpoints,pageErrors:data.pageErrors.length,port:new URL(data.origin).port,
   failure:data.failure?.message??null,browserClose:data.browserClose,gatewayExit:data.gatewayExit.code});
}
const graph=JSON.parse(fs.readFileSync('runs/corrected-blank-recovery-first/observed.json'));
const coarse=JSON.parse(fs.readFileSync('runs/corrected-coarse-first/observed.json'));
const o={cases,
   successfulWrites:cases.filter(c=>!c.failure).reduce((a,c)=>a+c.puts,0),
   allWrites:cases.reduce((a,c)=>a+c.puts,0),
   allPageErrors:cases.reduce((a,c)=>a+c.pageErrors,0),
   coarse:coarse.checkpoints.find(e=>e.measure)?.measure,
   recovery:graph.checkpoints.filter(x=>x.local&&x.ownership).map(e=>({label:e.label,token:e.local.baseToken,
     owner:e.local.decisionRoutes.subject.rows[2],edge:e.local.definition.edges.find(e=>e.ui?.route?.[0]===510)??null}))};
fs.writeFileSync('corrected-native-summary.json',JSON.stringify(o,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(o,null,2));