import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
const root=process.cwd();
const out=path.join(root,'docs/qa/2026-10-28-wp-205-none');
const scratch=path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^GG_|^(JEV_API_KEY|LIVE|NODE_OPTIONS|NODE_V8_COVERAGE)$/i.test(k)));
env.GG_TEST_PORT_START='7540'; env.GG_TEST_PORT_COUNT='40';
env.TEMP=scratch; env.TMP=scratch;
function redact(s){for(const p of [os.homedir(),os.homedir().replaceAll('\\','/'),os.homedir().replaceAll('\\','\\\\')]) s=s.split(p).join('%USERPROFILE%');return s.split(os.hostname()).join('%COMPUTERNAME%').split(path.basename(os.homedir())).join('%USERNAME%').replace(/S-1-(?:\d+-)+\d+/g,'<SID>');}
async function run(name,command,extra={}){
  const p=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',`& pnpm.cmd ${command}; exit $LASTEXITCODE`],{cwd:root,env:{...env,...extra},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let text=''; p.stdout.on('data',d=>text+=d); p.stderr.on('data',d=>text+=d);
  const code=await new Promise((r,j)=>{p.on('exit',r);p.on('error',j)});
  text=redact(`COMMAND: pnpm.cmd ${command}\n${text}\nEXIT=${code}\n`);
  fs.writeFileSync(path.join(out,`review2-${name.replaceAll(':','-')}.log.txt`),text);
  console.log(name, 'exit',code, '\n'+text.split('\n').filter(l=>/Tests |Test Files |All files|Tasks:|FAIL |Error:|error TS|passed|fail|WARN|not up to date|OK|up to date|no-op/.test(l)).slice(-18).join('\n'));
}
const mode=process.argv[2];
if(mode==='gates'){
  for(const c of ['typecheck','lint','check:layers','check:deps','check:migrations','check:tokens','check:docs']) await run(c,c);
  await run('format','exec prettier --check '+process.argv.slice(3).map(s=>`"${s}"`).join(' '));
  await run('upgrade','test:upgrade');
}
if(mode==='units'){
  for(const pkg of ['contracts','domain','engine','api','web']) await run(`coverage-${pkg}`,`--filter @graphgoblin/${pkg} test:coverage${pkg==='api'?' --maxWorkers=2':''}`);
  await run('coverage-adapter-codex','--filter @graphgoblin/adapter-codex test:coverage --exclude src/termination.test.ts');
  await run('coverage-infrastructure','--filter @graphgoblin/infrastructure test:coverage --exclude src/process/scripts.test.ts --exclude src/process/script-recovery.test.ts --exclude src/claude/process.test.ts --exclude src/adversarial.test.ts');
}
if(mode==='browser') await run('edge-clean','--filter @graphgoblin/web exec playwright test e2e/model-effort.spec.ts e2e/model-picker.spec.ts e2e/claude-harness.spec.ts e2e/form-controls.spec.ts --output "'+path.join(scratch,'edge-results')+'"',{GG_E2E_MAIN_PORT:'6360',GG_E2E_CONTROL_PORT:'6361',GG_E2E_BROWSER_CHANNEL:'msedge'});

if(mode==='once') await run(process.argv[3],process.argv.slice(4).join(' '));

if(mode==='scan2'){
 await run('build','build');
 await run('coverage-adapter','--filter @graphgoblin/adapter-codex test:coverage --exclude src/termination.test.ts');
 await run('coverage-api','--filter @graphgoblin/api test:coverage --maxWorkers=2');
}