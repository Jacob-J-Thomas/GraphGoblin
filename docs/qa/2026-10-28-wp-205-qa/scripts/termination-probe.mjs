import {spawn,spawnSync}from'node:child_process';import{once}from'node:events';import fs from'node:fs';import path from'node:path';import*as L from'./qa.mjs';
const child=spawn(process.execPath,['-e','setTimeout(()=>{},3000)'],{windowsHide:true,stdio:'ignore'});const closed=once(child,'close');await once(child,'spawn');
const r=spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,encoding:'utf8'});const [exitCode,signal]=await closed;
const record={register:'D-015',ownedPid:child.pid,status:r.status,stdout:r.stdout,stderr:r.stderr,error:r.error?.message,ownedChildExited:true,exitCode,signal};fs.writeFileSync(path.join(L.OUT,'termination-probe.log.txt'),L.redact(JSON.stringify(record,null,2))+'\n');console.log(L.redact(JSON.stringify(record)));
