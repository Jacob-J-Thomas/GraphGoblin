// Read-only final process/evidence audit. No termination or directory deletion.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import * as L from './lib.mjs';
const pids=new Set();
const walk=v=>{if(v&&typeof v==='object'){if(typeof v.pid==='number')pids.add(v.pid);for(const x of Object.values(v))walk(x);}};
for(const file of fs.readdirSync(L.OUT)){
  if(file.endsWith('.json')){try{walk(JSON.parse(fs.readFileSync(path.join(L.OUT,file),'utf8')));}catch{}}
  if(file.endsWith('.log.txt'))for(const line of fs.readFileSync(path.join(L.OUT,file),'utf8').split('\n')){try{walk(JSON.parse(line));}catch{}}
}
const query=`$qaIds=@(${[...pids].join(',')}); @(Get-CimInstance Win32_Process | Where-Object { $qaIds -contains $_.ProcessId } | Select-Object ProcessId,ParentProcessId,Name,CommandLine) | ConvertTo-Json -Compress`;
const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',query],{windowsHide:true,encoding:'utf8',timeout:15000});
let remaining=[];
if(result.status===0&&result.stdout.trim()){
  const values=JSON.parse(result.stdout);remaining=(Array.isArray(values)?values:[values]).map(p=>({pid:p.ProcessId,ppid:p.ParentProcessId,name:p.Name,qaOwned:!!p.CommandLine&&(/gg-qa423b-/i.test(p.CommandLine)||p.CommandLine.includes(path.join(L.ROOT,'apps','api','dist','main.js')))}));
}
const issues=[],inventory=[];
for(const name of [...fs.readdirSync(L.OUT),'../RECHECK.md']){
  const file=path.join(L.OUT,name);if(!fs.statSync(file).isFile()||name==='evidence-audit.json')continue;
  const bytes=fs.readFileSync(file);inventory.push({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  if(bytes.length>1000000)issues.push({name,issue:'over byte bound'});
  if(bytes[0]===239&&bytes[1]===187&&bytes[2]===191)issues.push({name,issue:'UTF-8 BOM'});
  if(!name.endsWith('.png')){
    const text=bytes.toString('utf8');if(text!==L.redact(text))issues.push({name,issue:'unredacted profile, host, or SID'});
    if(/S-1-\d+(?:-\d+)+/.test(text))issues.push({name,issue:'SID'});
    if(name.endsWith('.log'))issues.push({name,issue:'wrong log extension'});
  }
}
L.write('evidence-audit.json',{at:new Date().toISOString(),trackedPidCount:pids.size,processQueryStatus:result.status,processQueryError:result.error?.message,remainingTrackedPids:remaining,qaProcessesRemaining:remaining.filter(p=>p.qaOwned),issues,inventory});
console.log(JSON.stringify({trackedPidCount:pids.size,queryStatus:result.status,qaProcessesRemaining:remaining.filter(p=>p.qaOwned),issues,files:inventory.length,largest:inventory.sort((a,b)=>b.bytes-a.bytes)[0]}));
