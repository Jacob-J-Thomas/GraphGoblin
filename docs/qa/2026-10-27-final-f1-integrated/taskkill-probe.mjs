import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import * as L from './lib.mjs';
const child=spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{windowsHide:true,stdio:'ignore'});
const exited=new Promise(r=>child.on('exit',(code,signal)=>r({code,signal})));
let result;try{result=await promisify(execFile)('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:10000});}catch(e){result={code:e.code,message:e.message,stdout:e.stdout,stderr:e.stderr};}
const before={exitCode:child.exitCode,signalCode:child.signalCode};if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
L.save('taskkill-probe-results.json',{pid:child.pid,result,before,after:await exited});console.log(L.redact(JSON.stringify(result)));
