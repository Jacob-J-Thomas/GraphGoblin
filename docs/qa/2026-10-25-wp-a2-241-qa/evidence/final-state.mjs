import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const profile=process.env.USERPROFILE;
const ports=[];
for(const url of ['http://127.0.0.1:6170/healthz','http://127.0.0.1:6171/']){
 try{const r=await fetch(url,{signal:AbortSignal.timeout(2000)});ports.push({url,status:r.status,closed:false});}
 catch(error){ports.push({url,closed:true,error:error.cause?.code??error.name});}
}
const result={atUtc:new Date().toISOString(),node:process.version,head:git('rev-parse','HEAD'),branch:git('branch','--show-current'),nonQaTrackedChanges:git('diff','--name-only','--','.',':!docs/qa'),stagedChanges:git('diff','--cached','--name-only'),status:git('status','--short','--untracked-files=all'),ports};
await writeFile(new URL('final-state.log.txt',import.meta.url),JSON.stringify(result,null,2).replaceAll(profile,'%USERPROFILE%')+'\n');
console.log(JSON.stringify({...result,status:'See retained log'}));
