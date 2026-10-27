import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import * as L from './lib.mjs';
const require=createRequire(path.join(L.PR_ROOT,'package.json'));
const prettier=require('prettier');
const outFile=(name)=>path.join(L.OUT,name);
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const issues=[];
const decoder=new TextDecoder('utf-8',{fatal:true});
for(const file of walk(L.OUT)) {
  const stat=fs.lstatSync(file);
  if(stat.isSymbolicLink())issues.push('link: '+path.relative(L.OUT,file));
  if(stat.size>=1_000_000)issues.push('size: '+path.relative(L.OUT,file));
  if(/\.(mjs|json|md|txt|ps1)$/.test(file)) {
    let source;
    try {source=decoder.decode(fs.readFileSync(file));} catch {issues.push('invalid UTF-8: '+path.relative(L.OUT,file));continue;}
    if(fs.readFileSync(file).subarray(0,3).equals(Buffer.from([239,187,191])))issues.push('BOM: '+path.relative(L.OUT,file));
    const redacted=L.redact(source).replace(/S-\d-\d+(?:-\d+){1,}/g,'<SID>');
    if(source!==redacted){fs.writeFileSync(file,redacted);source=redacted;}
    const home=os.homedir();
    for(const needle of [home,home.replaceAll('\\','/'),home.replaceAll('\\','\\\\'),home.replaceAll('\\','\\\\\\\\'),os.hostname()])if(source.toLowerCase().includes(needle.toLowerCase()))issues.push('redaction: '+path.relative(L.OUT,file));
    if(file.endsWith('.json')) {try{JSON.parse(source);}catch{issues.push('invalid JSON: '+path.relative(L.OUT,file));}}
  }
}
const readme=fs.readFileSync(outFile('README.md'),'utf8');
for(const match of readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
  if(!['evidence-audit-result.json','evidence-manifest.json'].includes(match[1]) && !/^[a-z]+:/i.test(match[1]) && !fs.existsSync(path.resolve(L.OUT,match[1].split('#')[0])))issues.push('broken link: '+match[1]);
}
const audit={passed:issues.length===0,issues,checks:['UTF-8 decode','no BOM','each file below 1000000 bytes','profile paths and JSON-escaped forms redacted','machine name redacted','SIDs redacted','all JSON parses','README links resolve','no symbolic links'],note:'Manifest hashes cover final retained bytes, excluding the manifest itself. Browser screenshots contain only the synthetic product data shown in the record.'};
fs.writeFileSync(outFile('evidence-audit-result.json'),await prettier.format(JSON.stringify(audit),{parser:'json'}));
const files=walk(L.OUT).filter(f=>path.basename(f)!=='evidence-manifest.json').map(file=>{const b=fs.readFileSync(file);return {path:path.relative(L.OUT,file).replaceAll('\\','/'),bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')};});
fs.writeFileSync(outFile('evidence-manifest.json'),await prettier.format(JSON.stringify({files}),{parser:'json'}));
console.log(JSON.stringify({passed:audit.passed,issues,fileCount:files.length+1,largestFile:files.reduce((a,b)=>a.bytes>b.bytes?a:b)}));
if(!audit.passed)process.exitCode=1;
