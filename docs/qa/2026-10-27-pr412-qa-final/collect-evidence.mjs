// Redact and retain QA captures only. Never remove files/directories or follow fixture links.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {here,redact,Evidence} from './qa-lib.mjs';
const ev=new Evidence('evidence-collection');
const target=path.join(here,'server-logs');fs.mkdirSync(target,{recursive:true});
const skipped=[];let logs=0;
const sha=b=>createHash('sha256').update(b).digest('hex');
function capture(file,name){
 const b=Buffer.from(redact(fs.readFileSync(file,'utf8')),'utf8');
 if(b.length>1_000_000){skipped.push({name,size:b.length,sha256:sha(b)});return;}
 fs.writeFileSync(path.join(target,name),b);logs++;
}
function walk(dir,base){
 for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  if(e.isSymbolicLink())continue;
  const p=path.join(dir,e.name);
  if(e.isDirectory())walk(p,base);
  else if(/^server.*\.log\.txt$/.test(e.name))capture(p,path.basename(base)+'--'+path.relative(base,p).replaceAll(path.sep,'--'));
 }
}
const roots=fs.readdirSync(os.tmpdir(),{withFileTypes:true}).filter(e=>e.isDirectory()&&e.name.startsWith('gg-qa-412f-'));
for(const r of roots){
 const p=path.join(os.tmpdir(),r.name);
 if(r.name.startsWith('gg-qa-412f-main-')){
  const archive=path.join(p,'source.tar');if(fs.existsSync(archive)){const hash=createHash('sha256');for await(const chunk of fs.createReadStream(archive))hash.update(chunk);skipped.push({name:r.name+'/source.tar (immutable main build input, left in temp)',size:fs.statSync(archive).size,sha256:hash.digest('hex')});}else walk(p,p);
 }else walk(p,p);
}
// Raw configuration files are useful for provenance; redact complete strings after consumers stop.
for(const e of fs.readdirSync(here,{withFileTypes:true})) if(e.isFile()&&/\.(mjs|py|md|json|txt)$/.test(e.name)){
 const p=path.join(here,e.name),s=fs.readFileSync(p,'utf8');fs.writeFileSync(p,redact(s.replace(/^\uFEFF/,'')),'utf8');
}
const lines=['# Captures not retained in the record','','Disposable fixtures and inspection copies stay under `%TEMP%/gg-qa-412f-*` for the orchestrator. They are working data, not a saved database evidence claim. Server logs are copied separately after full-text redaction. No compressed traces were captured.','','| Capture/input omitted | Bytes | SHA-256 |','| --- | ---: | --- |',...skipped.map(s=>`| ${s.name} | ${s.size} | ${s.sha256} |`)];
fs.writeFileSync(path.join(here,'NOT-KEPT.md'),lines.join('\n')+'\n','utf8');
ev.log('Copied redacted server logs',logs,'omitted captures/build inputs',skipped.length,'disposable roots',roots.map(r=>r.name));
