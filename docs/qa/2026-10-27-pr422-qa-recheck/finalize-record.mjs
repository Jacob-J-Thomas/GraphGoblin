import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import * as L from './lib.mjs';
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const profile=new RegExp(process.env.USERPROFILE.split(/[\\/]/).map(escape).join('[\\\\/]+'),'gi');
const clean=s=>s.replace(/^\uFEFF/,'').replace(profile,'%USERPROFILE%').replace(new RegExp(escape(os.hostname()),'gi'),'%COMPUTERNAME%').replace(/S-1-\d+(?:-\d+)+/g,'<SID>');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const files=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);
if(process.argv.includes('--manifest-only')){
  L.save('evidence-manifest.json',{generatedAt:new Date().toISOString(),excludes:'This manifest itself',files:files(L.RECORD).filter(p=>path.basename(p)!=='evidence-manifest.json').map(file=>{const bytes=fs.readFileSync(file);return{name:path.relative(L.RECORD,file),bytes:bytes.length,sha256:sha(bytes)};})});
  console.log('Retained evidence manifest refreshed after formatting.');
  process.exit(0);
}
const omissions=[];const allTemp=files(L.ROOT);
for(const file of allTemp){const size=fs.statSync(file).size;
  if(size>1000000||/graphgoblin\.db(?:-wal|-shm)?$|baseline-main\.tar$|cli[\\/](?:claude|codex)\.exe$/.test(file))
    omissions.push({file:clean(file),bytes:size,sha256:sha(fs.readFileSync(file))});
}
L.save('NOT-KEPT.md','# Raw artifacts not retained in the record\n\nThe following disposable stores, build inputs and large browser scratch captures remain in system temp. They are not preserved as repository evidence. Public results are retained beside this record. No directory was deleted. No compressed trace was captured.\n\n| Artifact | Bytes | SHA-256 |\n| --- | ---: | --- |\n'+omissions.map(e=>`| \`${e.file}\` | ${e.bytes} | \`${e.sha256}\` |`).join('\n')+'\n');
for(const file of files(L.RECORD)) if(/\.(?:md|json|jsonl|mjs|ps1|txt)$/.test(file))fs.writeFileSync(file,clean(fs.readFileSync(file,'utf8')),'utf8');
const ids=new Set([27652,54412,26912]);
const scan=(value,key='')=>{
  if(Array.isArray(value))for(const item of value)scan(item);
  else if(value&&typeof value==='object')for(const[k,v]of Object.entries(value))scan(v,k);
  else if(typeof value==='number'&&/^(?:pid|apiPid|mcpPid|heldPid)$/.test(key))ids.add(value);
};
for(const file of [...files(L.RECORD),...allTemp.filter(p=>!p.includes(path.sep+'baseline-main'+path.sep)&&/\.lock$|\.jsonl$|marker$/.test(p))]){
  if(/\.json$/.test(file))try{scan(JSON.parse(fs.readFileSync(file,'utf8')));}catch{}
  if(/\.jsonl$|\.lock$|marker$/.test(file))for(const line of fs.readFileSync(file,'utf8').split('\n'))try{scan(JSON.parse(line));}catch{}
  const name=path.basename(file),match=name.match(/-(\d+)\.log\.txt$/);if(match)ids.add(Number(match[1]));
  if(/\.log\.txt$/.test(file)){const data=fs.readFileSync(file,'utf8');for(const m of data.matchAll(/(?:"pid"\s*:\s*|\bpid=)(\d+)/g))ids.add(Number(m[1]));}
}
const processes=[...ids].sort((a,b)=>a-b).filter(pid=>pid!==process.pid).map(pid=>{
  try{process.kill(pid,0);return{pid,state:'present'};}catch(error){return{pid,state:error.code==='ESRCH'?'absent':'unverified',error:error.code};}
});
L.save('owned-pid-check.json',{at:new Date().toISOString(),note:'Recorded fixture/API/MCP/script PIDs. Maintained test child cleanup and browser.close also awaited; process inventory via CIM was unavailable (Access denied).',processes});
const issues=[];
for(const file of files(L.RECORD)){
  const bytes=fs.readFileSync(file);const name=path.relative(L.RECORD,file);
  if(bytes.length>1000000)issues.push({name,kind:'oversized',bytes:bytes.length});
  if(bytes[0]===239&&bytes[1]===187&&bytes[2]===191)issues.push({name,kind:'BOM'});
  if(/\.(?:md|json|jsonl|mjs|ps1|txt)$/.test(file)){
    const value=bytes.toString('utf8');if(profile.test(value)||/S-1-\d+(?:-\d+)+/.test(value))issues.push({name,kind:'redaction'});profile.lastIndex=0;
    if(file.endsWith('.json'))try{JSON.parse(value);}catch{issues.push({name,kind:'invalid JSON'});}
  }
}
L.save('validation.json',{issues,remaining:processes.filter(p=>p.state!=='absent'),recordFiles:files(L.RECORD).length,omittedRawFiles:omissions.length});
L.save('evidence-manifest.json',{generatedAt:new Date().toISOString(),excludes:'This manifest itself',files:files(L.RECORD).filter(p=>path.basename(p)!=='evidence-manifest.json').map(file=>{const bytes=fs.readFileSync(file);return{name:path.relative(L.RECORD,file),bytes:bytes.length,sha256:sha(bytes)};})});
console.log(JSON.stringify({issues,remaining:processes.filter(p=>p.state!=='absent'),knownPids:processes.length,omissions:omissions.length}));
process.exitCode=issues.length||processes.some(p=>p.state!=='absent')?1:0;
