import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import * as L from './lib.mjs';
const names=process.argv.slice(2);
for(const name of names) {
  if(!/^[a-z0-9-]+$/.test(name)) throw Error('Bad driver name');
  const start=Date.now();
  console.log('START '+name);
  const child=spawn(process.execPath,[path.join(L.OUT,'scripts',name+'.mjs')],{cwd:L.PR_ROOT,env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';
  child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const [exit,signal]=await once(child,'exit');
  fs.writeFileSync(path.join(L.OUT,name+'-console.log.txt'),L.redact(output)+'\n'+JSON.stringify({exit,signal,pid:child.pid,elapsedMs:Date.now()-start})+'\n');
  const resultPath=path.join(L.OUT,name+'-result.json');
  const result=fs.existsSync(resultPath)?JSON.parse(fs.readFileSync(resultPath,'utf8')):null;
  console.log(JSON.stringify({driver:name,exit,signal,elapsedMs:Date.now()-start,...(result?{passed:result.passed,failed:result.failed,observations:result.observations}:{}),tail:L.redact(output.slice(-500))}));
  if(exit!==0||result?.failed) process.exitCode=1;
}
