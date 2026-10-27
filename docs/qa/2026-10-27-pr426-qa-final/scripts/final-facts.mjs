import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';
const browser=await L.launchEdge();let edge;
try{edge=browser.version();}finally{await browser.close();}
const git=(...args)=>execFileSync('git',args,{cwd:L.PR_ROOT,encoding:'utf8',windowsHide:true});
const pids=fs.readFileSync(path.join(L.OUT,'pids.log.txt'),'utf8').trim().split('\n').map(x=>JSON.parse(x));
const exits=fs.readFileSync(path.join(L.OUT,'exits.log.txt'),'utf8').trim().split('\n').map(x=>JSON.parse(x));
const disk=JSON.parse(fs.readFileSync(path.join(L.OUT,'durable-http.log.txt'),'utf8')).rows;
const probe=JSON.parse(fs.readFileSync(path.join(L.OUT,'termination-probe.log.txt'),'utf8'));
const owned=[...new Set([...pids.map(x=>x.pid),...disk.flatMap(x=>[x.producedPid,x.reopenedPid]),probe.ownedPid])];
const states=owned.map(pid=>{try{process.kill(pid,0);return {pid,state:'present'};}catch(e){return {pid,state:e.code==='ESRCH'?'exited':'not observable',code:e.code};}});
const facts={head:git('rev-parse','HEAD').trim(),branch:git('branch','--show-current').trim(),node:process.version,nodeExecutable:process.execPath,edge,gatewaysStarted:pids.length,gatewayExits:exits,ownedProcessStates:states,trackedDiff:git('diff','--name-only'),stagedDiff:git('diff','--cached','--name-only'),status:git('status','--short','--untracked-files=all')};
fs.writeFileSync(path.join(L.OUT,'final-state.json'),L.redact(JSON.stringify(facts,null,2))+'\n');
console.log(JSON.stringify({head:facts.head,edge,gatewaysStarted:pids.length,gatewayExits:exits.length,ownedProcesses:states.length,stillPresent:states.filter(s=>s.state!=='exited'),trackedDiff:facts.trackedDiff,stagedDiff:facts.stagedDiff}));
if(states.some(s=>s.state!=='exited'))process.exitCode=1;
