import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const folder=dirname(fileURLToPath(import.meta.url));
const head='b1810e03402cbc5d1bdceac899dbcc40b1ac317e';
const jobs={gates:132619487877,browser:132619488144,windows:132619488123,template:132619488093,routing:132619487900};
const records=[];
for(const [name,jobId] of Object.entries(jobs)){
 const source=join(folder,name+'-transport.json');if(!existsSync(source))continue;
 const data=JSON.parse(readFileSync(source,'utf8'));if(typeof data.content!=='string')throw new Error('Invalid log '+name);
 const bytes=Buffer.from(data.content,'utf8'), output=join(folder,name+'.log');
 if(existsSync(output)&&!readFileSync(output).equals(bytes))throw new Error('Changed retained log '+name);
 writeFileSync(output,bytes);
 records.push({name,head,runId:name==='routing'?43651091052:43651091055,jobId,path:name+'.log',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 const lines=data.content.split(/\r?\n/);
 console.log(JSON.stringify({name,bytes:bytes.length,summary:lines.filter(l=>/Tests\s+\d+|Test Files\s+\d+|[0-9]+ passed \(|tests [0-9]+$|fail [0-9]+$|vulnerabilities|Tasks:\s|Code style|All matched files|p95|PASS$/.test(l)).slice(name==='gates'?-35:-12)}));
}
writeFileSync(join(folder,'log-manifest.json'),JSON.stringify({at:new Date().toISOString(),head,complete:records.length===5,records},null,2)+'\n');
