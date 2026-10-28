// Disposable bounded fake process for the exact D-015 sandbox-refusal record.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import * as L from './lib.mjs';
const file=path.join(L.OUT,'native-probe.json');
if(process.argv.includes('--release')){
  const p=JSON.parse(fs.readFileSync(file));fs.writeFileSync(path.join(p.store.replaceAll('%USERPROFILE%',process.env.USERPROFILE),'release.txt'),'go');console.log('released fixture '+p.pid);
}else{
  const prior=JSON.parse(fs.readFileSync(path.join(L.OUT,'results.json')));const source=prior.disposableStores[0].replaceAll('%USERPROFILE%',process.env.USERPROFILE);
  const dir=L.store('native-probe');fs.copyFileSync(path.join(source,'fake/codex.exe'),path.join(dir,'codex.exe'));fs.writeFileSync(path.join(dir,'hold.txt'),'on');
  const child=spawn(path.join(dir,'codex.exe'),['exec','--experimental-json'],{windowsHide:true,detached:true,stdio:'ignore'});child.unref();L.write('native-probe.json',{pid:child.pid,store:dir,boundSeconds:90});console.log('native fixture PID '+child.pid);
}
