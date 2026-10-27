// Validate the final record, not product internals. No mutations outside this record.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {here,root,Evidence} from './qa-lib.mjs';
const ev=new Evidence('evidence-validation');
const required=['01b-mkstore-main','02b-migrated','03-d1-cursors','04b-datadir-alias','04-integrated','05-artifact-alias','06-realistic','06b-realistic-upgraded','07-interrupt-phases','07-ui-loop-deletion-child','08-startup-latency','08-ui-edge','09-ui-edge-followup','10-r3-focus','11f-ui-matrix-live','12-latency','13-child-consent','14b-missing-child-detail','15-main-no-consent'];
for(const n of required){const s=fs.readFileSync(path.join(here,n+'.log.txt'),'utf8');ev.check(n+': completed without assertion/harness error',/failures 0\s*$/.test(s)&&!/^FAIL |^ERROR /m.test(s));}
const manifest=[];const bad=[];
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
 const p=path.join(dir,e.name);if(e.isDirectory()){walk(p);continue;}
 const rel=path.relative(here,p).replaceAll(path.sep,'/');if(['evidence-validation.log.txt','evidence-manifest.json'].includes(rel))continue;
 const b=fs.readFileSync(p);manifest.push({file:rel,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
 if(b.length>1_000_000)bad.push(rel+': oversize');
 if(/\.(md|mjs|py|json|txt)$/.test(rel)){
  if(b[0]===0xef&&b[1]===0xbb&&b[2]===0xbf)bad.push(rel+': BOM');
  let s;try{s=new TextDecoder('utf-8',{fatal:true}).decode(b);}catch{bad.push(rel+': invalid UTF-8');continue;}
  for(const v of [os.homedir(),os.homedir().replaceAll('\\','/'),os.homedir().replaceAll('\\','\\\\'),os.hostname()])if(s.toLowerCase().includes(v.toLowerCase()))bad.push(rel+': unredacted identity');
  if(/S-1-\d+(?:-\d+){3,}/.test(s))bad.push(rel+': unredacted SID');
 }
}}
walk(here);manifest.sort((a,b)=>a.file.localeCompare(b.file));
ev.check('UTF-8 without BOM, redaction, every retained file <= 1,000,000 bytes',bad.length===0,bad);
const readme=fs.readFileSync(path.join(here,'README.md'),'utf8');const missing=[];
for(const m of readme.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)){const target=m[1];if(!/^(https?:|\/)/.test(target)&&!fs.existsSync(path.join(here,target)))missing.push(target);}
ev.check('README evidence links resolve',missing.length===0,missing);
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();ev.check('exact requested head',head==='fa53e34a475bcf3c6adb6f088173c1f7abfa37fa',head);
try{execFileSync('git',['diff','--quiet'],{cwd:root});execFileSync('git',['diff','--cached','--quiet'],{cwd:root});ev.check('tracked source and index unchanged',true);}catch{ev.check('tracked source and index unchanged',false);}
fs.writeFileSync(path.join(here,'evidence-manifest.json'),JSON.stringify(manifest,null,2)+'\n','utf8');
ev.log('files hashed',manifest.length,'total retained bytes',manifest.reduce((a,b)=>a+b.bytes,0));ev.log('failures',ev.failures??0);
