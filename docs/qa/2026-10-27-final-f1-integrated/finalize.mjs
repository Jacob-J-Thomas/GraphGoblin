// Final scoped process/encoding/identity audit. Does not remove any file or directory.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import * as L from './lib.mjs';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const pids=new Set();
function collect(v){if(Array.isArray(v)){for(const x of v)collect(x);return;}if(!v||typeof v!=='object')return;for(const [k,x]of Object.entries(v)){if(/pid$/i.test(k)&&Number.isInteger(x)&&x>0)pids.add(x);else collect(x);}}
for(const name of fs.readdirSync(L.RECORD)){
 if(name==='process-closure.json'||name==='evidence-manifest.json')continue;
 const file=path.join(L.RECORD,name);if(!fs.statSync(file).isFile())continue;
 if(name.endsWith('.json')){try{collect(JSON.parse(fs.readFileSync(file,'utf8')));}catch{}}
 const m=/-(\d+)\.log\.txt$/.exec(name);if(m)pids.add(Number(m[1]));
 if(name.endsWith('.log.txt')){const text=fs.readFileSync(file,'utf8');for(const match of text.matchAll(/console-host child (\d+)|\bpid[=: ](\d+)|\bSTART (\d+)/g))pids.add(Number(match[1]??match[2]??match[3]));}
}
for(const dir of [L.ROOT,L.CLI,path.join(L.ROOT,'format-cli')])if(fs.existsSync(dir))for(const name of fs.readdirSync(dir))if(name.endsWith('.jsonl'))for(const line of fs.readFileSync(path.join(dir,name),'utf8').trim().split('\n')){try{collect(JSON.parse(line));}catch{}}
// Ledger is append-only; add all API PIDs even if an earlier driver's summary was overwritten.
for(const line of fs.readFileSync(path.join(L.RECORD,'api-ledger.log.txt'),'utf8').trim().split('\n'))collect(JSON.parse(line));
const ownAuditProcesses=[process.pid,process.ppid];
const audit=[...pids].sort((a,b)=>a-b).filter(pid=>!ownAuditProcesses.includes(pid)).map(pid=>{try{process.kill(pid,0);return {pid,exists:true};}catch(e){return {pid,exists:e.code!=='ESRCH',probeCode:e.code};}});
let alive=audit.filter(a=>a.exists);
let nativeReadback;
L.save('process-closure.json',{registeredPids:audit,alive});
if(alive.length){
 const raw=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(L.RECORD,'process-probe.ps1')],{windowsHide:true,encoding:'utf8'});
 nativeReadback=JSON.parse(raw);if(!Array.isArray(nativeReadback))nativeReadback=[nativeReadback];
 for(const row of nativeReadback){if((row.queried&&row.exitCode!==259)||(!row.opened&&row.error===87)){const a=audit.find(a=>a.pid===row.pid);a.exists=false;a.nativeExit=row;}}
 alive=audit.filter(a=>a.exists);
}
L.save('process-closure.json',{checkedAt:new Date().toISOString(),registeredPids:audit,alive,nativeReadback,excludedCurrentAudit:ownAuditProcesses,browserAndMcpClosure:'All awaited in the completed drivers. No process was ended by name; only started-child handles were used.'});
if(alive.length)throw Error('Live PID candidates require identity review: '+alive.map(a=>a.pid));
const originalCli=path.join(L.CLI,'requests.jsonl');
L.save('fake-cli-requests.log.txt',fs.readFileSync(originalCli,'utf8'));
L.save('format-cli-requests.log.txt',fs.readFileSync(path.join(L.ROOT,'format-cli','requests.jsonl'),'utf8'));
const git=(...args)=>execFileSync('git',args,{cwd:L.REPO,encoding:'utf8',windowsHide:true});
L.save('final-git-readback.log.txt',`HEAD ${git('rev-parse','HEAD')}BRANCH ${git('branch','--show-current')}TRACKED DIFF\n${git('diff','--stat')}INDEX DIFF\n${git('diff','--cached','--stat')}STATUS\n${git('status','--short')}`);
L.save('environment.json',{nodeVersion:process.version,nodePath:process.execPath,head:git('rev-parse','HEAD').trim(),branch:git('branch','--show-current').trim(),edgeVersion:'156.0.4314.42',windows:'10.0.26300.0',pnpm:'12.8.1',dataRoot:L.ROOT,appPorts:[6630,6639],GG_TEST_PORT_START:6850,GG_TEST_PORT_COUNT:40,initialTrackedStatus:'clean',source:'Live shell and browser readbacks captured during F1'});
// List selected retained disposable inputs; none are copied into the record.
const omitted=[];
for(const folder of fs.readdirSync(L.ROOT)){
 const dir=path.join(L.ROOT,folder);if(!fs.lstatSync(dir).isDirectory())continue;
 for(const name of fs.readdirSync(dir))if(/^graphgoblin\.db(?:-(?:wal|shm|journal))?$/.test(name)||/\.exe$/.test(name)){
  const file=path.join(dir,name);if(fs.lstatSync(file).isFile()){const b=fs.readFileSync(file);omitted.push({name:'temp/'+folder+'/'+name,bytes:b.length,sha256:sha(b)});}
 }
}
const sse=JSON.parse(fs.readFileSync(path.join(L.RECORD,'sustained-results.json'),'utf8')).evidence.sse;
let notKept='# Not kept in the record\n\nThe raw direct SSE stream was counted and hashed incrementally, without retaining its frames. The size/hash below describe the delivered bytes; this is not a preserved stream capture. Disposable stores and executable fixture inputs remain under the recorded temp allocation and were not copied into this record. Workspace files likewise remain disposable fixtures.\n\n| Input | Bytes | SHA-256 |\n| --- | ---: | --- |\n';
notKept+=`| sustained direct SSE bytes | ${sse.bytes} | ${sse.sha256} |\n`;
for(const row of omitted)notKept+=`| ${row.name} | ${row.bytes} | ${row.sha256} |\n`;
fs.writeFileSync(path.join(L.RECORD,'NOT-KEPT.md'),notKept,'utf8');
fs.writeFileSync(path.join(L.RECORD,'format.ignore.txt'),'','utf8');
const checks=[];
for(const name of fs.readdirSync(L.RECORD)){
 const file=path.join(L.RECORD,name);if(!fs.statSync(file).isFile())continue;
 const raw=fs.readFileSync(file);checks.push({name,bytes:raw.length,underLimit:raw.length<=1000000});
 if(raw.length>1000000)throw Error('Record file exceeds size bound: '+name);
 if(/\.(md|mjs|cs|ps1|json|txt)$/.test(name)){
  if(raw[0]===0xEF&&raw[1]===0xBB&&raw[2]===0xBF)throw Error('UTF8 BOM '+name);
  let text=new TextDecoder('utf8',{fatal:true}).decode(raw);const redacted=L.redact(text);if(text!==redacted){fs.writeFileSync(file,redacted,'utf8');text=redacted;}
  if(text.includes(os.homedir())||text.includes(os.homedir().replaceAll('\\','/'))||/S-1-\d+(?:-\d+)+/.test(text))throw Error('Unredacted identity in '+name);
 }
}
L.save('validation.json',{checkedAt:new Date().toISOString(),processesClosed:true,trackedSourceAndIndexUnchanged:git('diff','--stat').trim()===''&&git('diff','--cached','--stat').trim()==='',headMatches:git('rev-parse','HEAD').trim()==='a0470cb51399aa3e7fff3239487753fdacc5ed28',utf8NoBom:true,redaction:true,under1000000Bytes:checks.every(c=>c.underLimit),filesChecked:checks.length});
console.log(`PASS scoped closure: ${audit.length} registered process candidates exited; ${checks.length} files meet encoding/redaction/size checks.`);
