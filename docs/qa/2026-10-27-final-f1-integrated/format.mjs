import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import * as L from './lib.mjs';
let api;const E={examples:[],templates:[]};const binary=path.join(L.ROOT,'format-cli','codex.exe');
const envFor=dir=>({...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('GG_'))),GG_DATA_DIR:dir,GG_PORT:'6639',GG_HOST:'127.0.0.1',GG_CODEX_BINARY:binary,GG_CLAUDE_BINARY:path.join(L.CLI,'claude.exe'),GG_WEB_DIST:'',GG_LOG_LEVEL:'warn'});
function cli(args,dir){try{return {code:0,stdout:execFileSync(process.execPath,[path.join(L.REPO,'apps/api/dist/main.js'),...args],{env:envFor(dir),encoding:'utf8',windowsHide:true,timeout:120000,stdio:['ignore','pipe','pipe']})};}catch(e){return {code:e.status,stdout:String(e.stdout),stderr:String(e.stderr)};}}
function tree(dir){const out={};if(!fs.existsSync(dir))return out;for(const n of fs.readdirSync(dir).sort()){const p=path.join(dir,n);const s=fs.lstatSync(p);if(s.isSymbolicLink())throw Error('unexpected fixture link');if(s.isDirectory()){out[n+'/']='directory';for(const [k,v]of Object.entries(tree(p)))out[n+'/'+k]=v;}else out[n]=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}return out;}
try{
 api=await L.startApi('format-store',6639,{GG_CODEX_BINARY:binary});const dir=api.dir;
 const source=fs.readFileSync(path.join(L.REPO,'docs/guide/02-build-a-loop.md'),'utf8');
 const blocks=new Map([...source.matchAll(/<!-- guide-example: ([a-z-]+) -->\r?\n\r?\n```\w+\r?\n([\s\S]*?)^```/gm)].map(m=>[m[1],m[2]]));
 for(const name of ['draft-body','first-summary','bounded-repeat']){let def=JSON.parse(blocks.get(name));if(name==='draft-body')def=def.definition;const imported=await api.post('/loops/import',def);await api.post('/loops/'+imported.loop.id+'/publish');const input=name==='first-summary'?{topic:'provider-free integrated QA'}:{};const run=(await api.post('/loops/'+imported.loop.id+'/runs',{input})).run;const done=await L.state(api,run.id,name==='bounded-repeat'?['exhausted','failed']:['succeeded','failed']);L.check('shipped guide example '+name,done.status===(name==='bounded-repeat'?'exhausted':'succeeded'),done);E.examples.push({name,definition:def,run:done});}
 const templates=await api.get('/templates');L.check('fresh store exposes four shipped templates',templates.items.length===4,templates);
 for(const t of templates.items){const id=t.manifest.id;const draft=await api.post('/templates/'+id+'/draft',{});await api.post('/loops/'+draft.loop.id+'/publish');const run=(await api.post('/loops/'+draft.loop.id+'/runs',{input:{task:'Synthetic fixture supplied context only'}})).run;const done=await L.state(api,run.id,['succeeded','failed','exhausted']);L.check('unmodified shipped template '+id+' runs',done.status==='succeeded',done);E.templates.push({id,draft,run:done});}
 // A configured user directory and unrelated data-root entries must survive reset.
 const userDir=path.join(L.ROOT,'format-user-directory');fs.mkdirSync(userDir);fs.writeFileSync(path.join(userDir,'sentinel.txt'),'user owned');
 const userLoop=L.loop('User fixed directory',[L.inference()],{workingDirectory:{kind:'fixed',path:userDir}});const userRun=await L.run(api,await L.publish(api,userLoop));await L.state(api,userRun.id,['succeeded']);
 const unrelated=path.join(dir,'unrelated.txt');fs.writeFileSync(unrelated,'unrelated');const unmatched=path.join(dir,'workspaces','user-not-a-run');fs.mkdirSync(unmatched,{recursive:true});fs.writeFileSync(path.join(unmatched,'sentinel.txt'),'unmatched workspace');
 const ids=(await api.get('/runs?limit=100')).items.map(r=>r.id);const saved=await api.get('/runs/'+E.examples[1].run.id);await api.stop();
 api=await L.startApi('format-store',6639,{GG_CODEX_BINARY:binary});const reopened=await api.get('/runs/'+saved.id);L.check('valid current-format store reopens unchanged',saved.versionId===reopened.versionId && JSON.stringify(saved.result)===JSON.stringify(reopened.result) && saved.lastEventSeq===reopened.lastEventSeq,{saved,reopened});
 const oldExport=await api.call('POST','/loops/import',{format:'graphgoblin-loop',formatVersion:3,exportedAt:'2026-01-01T00:00:00.000Z',loop:{schemaVersion:3}});L.check('older export refuses clearly',oldExport.status===400 && oldExport.body.code==='LOOP_FORMAT_UNSUPPORTED' && oldExport.body.errors?.foundFormat===3,oldExport);E.oldExport=oldExport;
 await api.stop();
 const oldDir=path.join(L.ROOT,'format-old-store');fs.mkdirSync(oldDir);fs.copyFileSync(path.join(dir,'graphgoblin.db'),path.join(oldDir,'graphgoblin.db'));
 execFileSync('python',['-I','-c','import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("UPDATE gg_upgrade_state SET format_version=3"); c.commit(); c.close()',path.join(oldDir,'graphgoblin.db')],{windowsHide:true});
 const beforeOld=tree(oldDir);const oldStart=cli([],oldDir);const afterOld=tree(oldDir);L.check('older store refuses startup and names exact reset dry run',oldStart.code===1 && /Found:.*format 3/.test(oldStart.stderr) && oldStart.stderr.includes('--reset --data-dir') && oldStart.stderr.includes(oldDir),oldStart);L.check('old format database not rewritten',beforeOld['graphgoblin.db']===afterOld['graphgoblin.db'],{beforeOld,afterOld});E.oldStore={oldStart,beforeOld,afterOld};
 const before=tree(dir);const userBefore=tree(userDir);const dry=cli(['--reset'],dir);const afterDry=tree(dir);L.check('reset preview changes no data-root byte',dry.code===0 && JSON.stringify(before)===JSON.stringify(afterDry),{dry,before,afterDry});
 const reset=cli(['--reset','--yes','--data-dir',dir],dir);const after=tree(dir);
 const removed=Object.keys(before).filter(k=>!(k in after));const kept=Object.keys(after);const expected=Object.keys(before).filter(k=>k==='graphgoblin.db'||/^graphgoblin\.db-(wal|shm|journal)$/.test(k)||k.startsWith('artifacts/')||ids.some(id=>k==='workspaces/'+id+'/'||k.startsWith('workspaces/'+id+'/')));
 L.check('confirmed reset removes exactly preview-owned categories',reset.code===0 && JSON.stringify(removed.sort())===JSON.stringify(expected.sort()),{reset,removed,expected,kept});
 L.check('reset keeps unrelated and user directories byte-identical',fs.readFileSync(unrelated,'utf8')==='unrelated' && fs.readFileSync(path.join(unmatched,'sentinel.txt'),'utf8')==='unmatched workspace' && JSON.stringify(tree(userDir))===JSON.stringify(userBefore),{kept,userBefore});
 api=await L.startApi('format-store',6639,{GG_CODEX_BINARY:binary});L.check('explicit reset permits a clean current-format restart',(await api.get('/runs')).items.length===0 && (await api.get('/loops')).items.length===0);E.reset={dry,reset,before,after,expected,removed,userBefore,ids};
}catch(error){E.error=String(error.stack);L.check('format driver completed',false,E.error);}
finally{await L.cleanup();L.save('format-results.json',{checks:L.checks,evidence:E});}
process.exitCode=L.checks.some(c=>!c.passed)?1:0;
