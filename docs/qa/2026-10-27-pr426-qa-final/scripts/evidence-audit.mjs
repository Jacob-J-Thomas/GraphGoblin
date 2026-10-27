import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { TextDecoder } from 'node:util';
import * as L from './lib.mjs';
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const mode=process.argv[2];
const rel=file=>path.relative(L.OUT,file).replaceAll('\\','/');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function inspect() {
  const errors=[];const files=walk(L.OUT);
  for(const file of files) {
    const bytes=fs.readFileSync(file);const name=rel(file);
    if(bytes.length>=1000000)errors.push({file:name,problem:'size >= 1000000',bytes:bytes.length});
    if(file.endsWith('.png'))continue;
    if(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)errors.push({file:name,problem:'UTF-8 BOM'});
    let text;try{text=new TextDecoder('utf8',{fatal:true}).decode(bytes);}catch{errors.push({file:name,problem:'invalid UTF-8'});continue;}
    if(L.redact(text)!==text)errors.push({file:name,problem:'unredacted profile, host, SID or sensitive-shaped value'});
    if(file.endsWith('.json'))try{JSON.parse(text);}catch{errors.push({file:name,problem:'invalid JSON'});}
  }
  return {files,errors};
}
if(mode==='--sanitize') {
  const changed=[];
  for(const file of walk(L.OUT)) {
    if(file.endsWith('.png'))continue;
    const text=new TextDecoder('utf8',{fatal:true}).decode(fs.readFileSync(file));
    const clean=L.redact(text).replace(/^\uFEFF/,'');
    if(clean!==text){fs.writeFileSync(file,clean);changed.push(rel(file));}
  }
  console.log(JSON.stringify({sanitizedFiles:changed}));
}else if(mode==='--manifest') {
  const {files,errors}=inspect();if(errors.length)throw Error(JSON.stringify(errors));
  const entries=files.filter(f=>rel(f)!=='evidence-manifest.json').sort().map(file=>{const bytes=fs.readFileSync(file);return {file:rel(file),bytes:bytes.length,sha256:hash(bytes)};});
  fs.writeFileSync(path.join(L.OUT,'evidence-manifest.json'),JSON.stringify({algorithm:'SHA-256',excludes:['evidence-manifest.json'],files:entries},null,2)+'\n');
  console.log(JSON.stringify({manifestFiles:entries.length}));
}else if(mode==='--verify') {
  const {files,errors}=inspect();
  const manifest=JSON.parse(fs.readFileSync(path.join(L.OUT,'evidence-manifest.json'),'utf8'));
  for(const entry of manifest.files) {const bytes=fs.readFileSync(path.join(L.OUT,entry.file));if(bytes.length!==entry.bytes||hash(bytes)!==entry.sha256)errors.push({file:entry.file,problem:'manifest mismatch'});}
  if(files.length!==manifest.files.length+1)errors.push({problem:'manifest inventory mismatch'});
  console.log(JSON.stringify({retainedFiles:files.length,largestBytes:Math.max(...files.map(f=>fs.statSync(f).size)),hashesVerified:manifest.files.length,errors},null,2));
  if(errors.length)process.exitCode=1;
}else {
  const {files,errors}=inspect();
  const result={verdict:errors.length?'FAIL':'PASS',filesBeforeManifest:files.length,utf8WithoutBom:true,profileMachineSidRedaction:true,maxAllowedBytes:999999,largestBytes:Math.max(...files.map(f=>fs.statSync(f).size)),compressedTraces:files.filter(f=>/\.(zip|gz|7z|trace)$/i.test(f)).map(rel),errors};
  fs.writeFileSync(path.join(L.OUT,'evidence-audit-result.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));if(errors.length)process.exitCode=1;
}
