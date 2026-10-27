// Final read-only checks of retained evidence; writes only validation/manifest in this record.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as L from './lib.mjs';
const files=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const profile=new RegExp(process.env.USERPROFILE.split(/[\\/]/).map(escape).join('[\\\\/]+'),'i');
const issues=[];
for(const file of files(L.RECORD)){
  const bytes=fs.readFileSync(file),name=path.relative(L.RECORD,file);
  if(bytes.length>1000000)issues.push({name,kind:'oversize'});
  if(bytes[0]===239&&bytes[1]===187&&bytes[2]===191)issues.push({name,kind:'BOM'});
  if(/\.(md|json|jsonl|mjs|txt|ps1)$/.test(name)){
    const value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    if(profile.test(value)||value.toLowerCase().includes(os.hostname().toLowerCase())||/S-1-\d+(?:-\d+)+/.test(value))issues.push({name,kind:'redaction'});
    if(name.endsWith('.json'))try{JSON.parse(value);}catch{issues.push({name,kind:'invalid JSON'});}
  }
}
const pids=JSON.parse(fs.readFileSync(path.join(L.RECORD,'owned-pid-check.json'),'utf8')).processes;
const remaining=pids.filter(p=>{try{process.kill(p.pid,0);return true;}catch(e){return e.code!=='ESRCH';}});
const diff=spawnSync('git',['diff','--name-only'],{cwd:L.REPO,encoding:'utf8'});
const head=spawnSync('git',['rev-parse','HEAD'],{cwd:L.REPO,encoding:'utf8'}).stdout.trim();
if(diff.stdout.trim())issues.push({kind:'tracked diff',files:diff.stdout});
if(head!=='ef349181691a97b1fbe0d50a7ed8b4a4ba01175e')issues.push({kind:'head changed',head});
L.save('validation.json',{issues,remaining,knownPids:pids.length,head,trackedDiffEmpty:!diff.stdout.trim(),utf8WithoutBom:true});
L.save('evidence-manifest.json',{generatedAt:new Date().toISOString(),excludes:'This manifest itself',files:files(L.RECORD).filter(file=>path.basename(file)!=='evidence-manifest.json').map(file=>{const bytes=fs.readFileSync(file);return{name:path.relative(L.RECORD,file),bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};})});
console.log(JSON.stringify({issues,remaining,knownPids:pids.length,head,trackedDiffEmpty:!diff.stdout.trim()}));
process.exitCode=issues.length||remaining.length?1:0;
