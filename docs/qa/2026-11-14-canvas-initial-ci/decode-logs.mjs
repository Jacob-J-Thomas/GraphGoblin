import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const dir=dirname(fileURLToPath(import.meta.url));const records=[];
for(const [name,job] of [['windows',132594480860],['template',132594481177],['routing',132594480742],['gates',132594481187],['browser',132594481017]]){
 const file=join(dir,name+'.transport.json');if(!existsSync(file))continue;
 const r=JSON.parse(readFileSync(file,'utf8'));const content=r.structuredContent?.content;
 if(typeof content!=='string')throw new Error('Missing decoded string '+name);
 const bytes=Buffer.from(content,'utf8');writeFileSync(join(dir,name+'.log'),bytes);
 records.push({name,job,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
writeFileSync(join(dir,'log-manifest.json'),JSON.stringify({head:'64a955887962f72287e532824be1b8cb32c5f055',comparisonTarget:'35bb3fbdc724a82064d0d9e65b551608542c6b22',actualMain:'a817e5ccb4fd598ca56089b97b4ce55e9cb6f58c',ci:43643000955,routing:43643000960,records},null,2)+'\n');
console.log(JSON.stringify(records));
