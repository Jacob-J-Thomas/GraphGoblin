import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';import {pathToFileURL,fileURLToPath} from 'node:url';import {redact} from './lib.mjs';
const scratch=path.dirname(fileURLToPath(import.meta.url));
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^GG_|^(JEV_API_KEY|LIVE|NODE_OPTIONS|NODE_V8_COVERAGE)$/i.test(k)));env.GG_TEST_PORT_START='7540';env.GG_TEST_PORT_COUNT='40';
async function run(name,bin,args){const p=spawn(bin,args,{cwd:process.cwd(),env,windowsHide:true,stdio:['ignore','pipe','pipe']});let s='';p.stdout.on('data',d=>s+=d);p.stderr.on('data',d=>s+=d);const code=await new Promise((r,j)=>{p.on('exit',r);p.on('error',j)});fs.writeFileSync(path.join(scratch,'evidence',`${name}.log.txt`),redact(`COMMAND: ${bin} ${args.join(' ')}\n${s}\nEXIT=${code}\n`));console.log(redact(name+': exit '+code+'\n'+s.split('\n').filter(l=>/DONE|CHECK FAIL|OBSERVE|BASE_HISTORY|files|Prepared|Error/.test(l)).join('\n')));if(code!==0)throw new Error(name+' failed');}
const mode=process.argv[2];
if(mode==='base'){
 await run('archive','git',['archive','--format=tar','--output',path.join(scratch,'base.tar'),'a4fee9a9','package.json','pnpm-lock.yaml','packages','apps/api']);fs.mkdirSync(path.join(scratch,'base'),{recursive:true});
 await run('extract','tar',['-xf',path.join(scratch,'base.tar'),'-C',path.join(scratch,'base')]);await run('build-base',process.execPath,[path.join(scratch,'build-base.mjs')]);
 const loader=pathToFileURL(path.join(scratch,'base-loader.mjs')).href;
 await run('copy-base-catalog',process.execPath,['--import',loader,path.join(scratch,'base/apps/api/dist/templates/copy-catalog.js')]);
 for(const n of ['base-history','base-missing'])await run(n,process.execPath,['--import',loader,path.join(scratch,n+'.mjs')]);
 for(const n of ['real-guards','verify-own'])await run(n+'-driver',process.execPath,[path.join(scratch,n+'.mjs')]);
}
if(mode==='sql')for(const n of ['sql-checks','verify-scope-bytes'])await run(n+'-driver',process.execPath,[path.join(scratch,n+'.mjs')]);
