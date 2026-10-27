import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));const files=[];
for(const name of fs.readdirSync(here).sort()){if(name==='evidence-manifest.json'||name==='manifest-console.log.txt')continue;const p=path.join(here,name);if(!fs.statSync(p).isFile())continue;const b=fs.readFileSync(p);if(b.length>1000000)throw Error(name);files.push({name,bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')});}
fs.writeFileSync(path.join(here,'evidence-manifest.json'),JSON.stringify({algorithm:'SHA-256',excludes:['evidence-manifest.json','manifest-console.log.txt'],files},null,2)+'\n','utf8');
console.log('PASS final manifest: '+files.length+' retained files');
