import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
const child=spawn(process.execPath,['-e','setTimeout(()=>process.exit(0),2000)'],{windowsHide:true,stdio:'ignore'});
const closed=once(child,'close');
await once(child,'spawn');
const outcome=spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,encoding:'utf8'});
console.log(JSON.stringify({ownedPid:child.pid,command:'taskkill.exe /PID <ownedPid> /T /F',status:outcome.status,stdout:outcome.stdout,stderr:outcome.stderr,error:outcome.error?.message}));
await closed;
console.log(JSON.stringify({ownedPid:child.pid,exitCode:child.exitCode,signal:child.signalCode}));
