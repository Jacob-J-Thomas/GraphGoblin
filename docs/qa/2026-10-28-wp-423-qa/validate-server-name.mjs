// No-turn CLI validation in an empty disposable CODEX_HOME. No login or provider request.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as L from './lib.mjs';
const dir=L.store('cli-name-validation');
fs.writeFileSync(path.join(dir,'config.toml'),'[mcp_servers.__proto__]\ncommand="qa423-command-that-does-not-exist"\nenabled=true\n');
const binary=path.join(L.ROOT,'node_modules/.pnpm/@openai+codex@0.160.0-win32-x64/node_modules/@openai/codex/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^GG_|^JEV_API_KEY$|API_KEY|TOKEN|^CODEX_HOME$|^NODE_OPTIONS$/i.test(k)));
const records=[];
for(const [name,extra] of [['baseline',[]],['empty-table',['--config','mcp_servers={}']],['disabled-by-name',['--config','mcp_servers.__proto__.enabled=false']]]){
  const args=['mcp','list','--json','--config','features.plugins=false','--config','features.apps=false',...extra];
  const result=spawnSync(binary,args,{cwd:dir,env:{...env,CODEX_HOME:dir},windowsHide:true,encoding:'utf8',timeout:15000});
  const record={name,args,status:result.status,error:result.error?.message,stdout:result.stdout,stderr:result.stderr};records.push(record);L.log('no-turn CLI name validation',record);
}
L.write('real-cli-name-validation.log.txt',records.map(JSON.stringify).join('\n'));
L.write('real-cli-name-validation.json',{version:'bundled pinned 0.160.0',store:dir,providerTurns:0,records});
