// Public HTTP check: the same immutable main build cannot grant cleanup approval.
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {client,temp,join,here,Evidence,redact,sleep} from './qa-lib.mjs';
const ev=new Evidence('15-main-no-consent');const base=fs.mkdtempSync(join(temp,'gg-qa-412f-main-consent-'));
const dataDir=join(base,'data');fs.mkdirSync(dataDir);
const child=spawn(process.execPath,['--experimental-loader',pathToFileURL(join(here,'main-resolver.mjs')).href,join(here,'qa-server-main.mjs'),dataDir,'6620','unused'],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,QA_LOG_LEVEL:'warn'}});
const exited=new Promise(res=>child.once('exit',(code,signal)=>res({code,signal})));
let buffer='';const ready=new Promise((res,rej)=>{const on=c=>{const s=redact(String(c));fs.appendFileSync(join(base,'server-main.log.txt'),s);buffer+=String(c);const m=/QA_READY (\S+)/.exec(buffer);if(m)res(m[1]);};child.stdout.on('data',on);child.stderr.on('data',on);child.once('exit',code=>rej(Error('main exited '+code)));});
try{
 const api=client(await ready);
 const loop=await api.createLoop({schemaVersion:4,name:'Main has no consent',nodes:[{id:'start',kind:'trigger',label:'Start',config:{type:'manual'}},{id:'done',kind:'exit',label:'Done',config:{outcome:'success'}}],edges:[{id:'e',from:{node:'start',port:'out'},to:{node:'done',port:'in'}}]});
 const id=(await api.startRun(loop,{})).id;await api.waitFinal(id);
 const p=await api.preview([id]),c=await api.confirm([id],'0'.repeat(64));
 ev.log('main preview',p.status,p.text,'main confirm',c.status,c.text);
 ev.check('main refuses approval endpoints (404)',p.status===404&&c.status===404);
 ev.check('main history has no approval',!(await api.run(id)).deletionApproval);
}catch(e){ev.log('ERROR',String(e.stack??e));process.exitCode=1;}
finally{child.stdin.write('stop\n');const timer=setTimeout(()=>child.kill('SIGKILL'),15000);ev.log('main stop',await exited);clearTimeout(timer);ev.log('failures',ev.failures??0);}
