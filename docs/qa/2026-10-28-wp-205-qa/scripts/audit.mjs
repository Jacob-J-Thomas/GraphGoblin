// Redact evidence, verify size/encoding, reconcile owned gateway exits and read-only process state.
import fs from'node:fs';import path from'node:path';import os from'node:os';import{execFileSync}from'node:child_process';import*as L from'./qa.mjs';
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const problems=[];const files=walk(L.OUT);
for(const f of files){const bytes=fs.readFileSync(f);if(bytes.length>1000000)problems.push({file:path.relative(L.OUT,f),size:bytes.length});if(f.endsWith('.png'))continue;let text=bytes.toString('utf8').replace(/^\uFEFF/,'');text=L.redact(text);fs.writeFileSync(f,text,'utf8');if(text.includes(os.homedir())||text.includes(os.homedir().replaceAll('\\','\\\\'))||text.toLowerCase().includes(os.hostname().toLowerCase())||/S-1-(?:\d+-)+\d+/.test(text))problems.push({file:path.relative(L.OUT,f),redaction:true});}
const pids=fs.readFileSync(path.join(L.OUT,'pids.log.txt'),'utf8').trim().split('\n').map(JSON.parse);const exits=fs.readFileSync(path.join(L.OUT,'exits.log.txt'),'utf8').trim().split('\n').map(JSON.parse);
const unmatched=pids.filter(p=>!exits.some(e=>e.pid===p.pid));
const probe=JSON.parse(fs.readFileSync(path.join(L.OUT,'termination-probe.log.txt'),'utf8'));
const ids=[...pids.map(p=>p.pid),probe.ownedPid].join(',');
const processOutput=execFileSync('powershell.exe',['-NoProfile','-Command',`$qaIds=@(${ids}); @(Get-Process -Id $qaIds -ErrorAction SilentlyContinue | Select-Object Id,ProcessName) | ConvertTo-Json -Compress`],{windowsHide:true,encoding:'utf8'}).trim();
const observed=processOutput?JSON.parse(processOutput):[];const observedArray=Array.isArray(observed)?observed:[observed];
const nodeProcesses=observedArray.filter(p=>p.ProcessName==='node');
const git=execFileSync('git',['status','--short'],{cwd:L.ROOT,encoding:'utf8'});
const result={files:files.length,largest:files.map(f=>({file:path.relative(L.OUT,f),bytes:fs.statSync(f).size})).sort((a,b)=>b.bytes-a.bytes).slice(0,5),problems,startedGateways:pids.length,exitedGateways:exits.length,unmatched,processInventoryMethod:'Get-Process -Id, only the owned gateway and termination-probe IDs; started executable was node.exe and every child has an exit entry. An ID reused by another executable is not the original process and is left alone.',initialInventoryLimitation:'Get-CimInstance Win32_Process: Access denied; HRESULT 0x80041003. Replaced with the bounded Get-Process check, not treated as an empty inventory.',observedProcessesAtOldIds:observedArray,stillPresentNodeProcesses:nodeProcesses,gitStatus:git};
fs.writeFileSync(path.join(L.OUT,'evidence-audit.json'),L.redact(JSON.stringify(result,null,2))+'\n');console.log(L.redact(JSON.stringify(result)));if(problems.length||unmatched.length||nodeProcesses.length)process.exitCode=1;
