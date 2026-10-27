// Measure taskkill using one disposable process started here, then stop only that PID directly.
import {spawn,spawnSync} from 'node:child_process';
import * as L from './lib.mjs';
const rec=new L.Recorder('native-limit');
const child=spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{windowsHide:true,stdio:'ignore'});
let exit=null;
child.once('exit',(code,signal)=>{exit={code,signal};});
try {
  await L.sleep(300);
  const kill=spawnSync('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,encoding:'utf8',timeout:10_000});
  rec.observe('taskkill against this script owned disposable PID',{pid:child.pid,status:kill.status,stdout:kill.stdout,stderr:kill.stderr,error:kill.error?.message});
}finally{
  if(!exit)child.kill();
  await L.waitFor(()=>exit,{timeoutMs:5000});
  rec.check('owned disposable process ended',exit!==null,exit);
  rec.finish();
}
