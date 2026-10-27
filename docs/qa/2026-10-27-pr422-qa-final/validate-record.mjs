// Read-only final record verification; does not alter the manifest it checks.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'evidence-manifest.json'),'utf8'));
const errors=[];
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const profile=new RegExp(process.env.USERPROFILE.split(/[\\/]/).map(escape).join('[\\\\/]+'),'i');
for(const item of manifest.files){
 const file=path.join(dir,item.name),b=fs.readFileSync(file);
 if(b.length!==item.bytes||crypto.createHash('sha256').update(b).digest('hex')!==item.sha256)errors.push('manifest: '+item.name);
 if(b.length>1000000)errors.push('size: '+item.name);
 if(b[0]===239&&b[1]===187&&b[2]===191)errors.push('BOM: '+item.name);
 if(/\.(?:md|json|jsonl|mjs|ps1|txt)$/.test(file)){
  const s=b.toString('utf8');
  if(profile.test(s)||s.toLowerCase().includes(os.hostname().toLowerCase())||/S-1-\d+(?:-\d+)+/.test(s))errors.push('redaction: '+item.name);
  if(file.endsWith('.json'))try{JSON.parse(s);}catch{errors.push('JSON: '+item.name);}
 }
}
for(const match of fs.readFileSync(path.join(dir,'README.md'),'utf8').matchAll(/\]\(([^)]+)\)/g))if(!fs.existsSync(path.resolve(dir,match[1])))errors.push('link: '+match[1]);
const files=fs.readdirSync(dir).filter(n=>n!=='evidence-manifest.json');
if(files.length!==manifest.files.length)errors.push('manifest file count');
console.log(JSON.stringify({files:manifest.files.length,errors}));
process.exitCode=errors.length?1:0;
