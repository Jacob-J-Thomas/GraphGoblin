// Runs one explicitly selected finite command only after root's heavy-slot release.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {appendFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const O=dirname(fileURLToPath(import.meta.url)),QA=resolve('G:/ggq/gg-i5-d231-correction-qa/GraphGoblin'),OUT=join(O,'execution-01');
const [id,release]=process.argv.slice(2);if(release!=='--root-heavy-slot-released')throw Error('Explicit root heavy-slot release required');
mkdirSync(OUT,{recursive:true});const safeQuote=s=>"'"+s.replaceAll("'","''")+"'";
const matrix={
 'd232-ordinary':['--filter','@graphgoblin/web','exec','vitest','run','src/api/ApiKeyPanel.test.tsx','--retry=0','--reporter=verbose','--reporter=json','--outputFile='+join(OUT,'d232-ordinary.json')],
 'd232-mutant':['--filter','@graphgoblin/web','exec','vitest','run','src/api/ApiKeyPanel.test.tsx','-t','does not refresh an already accepted unchanged key','--retry=0','--reporter=verbose','--reporter=json','--outputFile='+join(OUT,'d232-mutant.json')],
 'independent-components':['--filter','@graphgoblin/web','exec','vitest','run','src/runs/owner-chat-recovery-witness.test.tsx','src/runs/owner-chat-recovery-budget.qa.test.tsx','src/app/owner-chat-request-generation.qa.test.tsx','--retry=0','--reporter=verbose','--reporter=json','--outputFile='+join(OUT,'independent-components.json')],
 'existing-auth':['--filter','@graphgoblin/web','exec','vitest','run','src/app/useOwnerChatClient.test.tsx','src/api/api-key-fetch.test.ts','src/api/ApiKeyPanel.test.tsx','src/api/api-key.test.tsx','--retry=0','--reporter=verbose','--reporter=json','--outputFile='+join(OUT,'existing-auth.json')],
 'authored-owner-chat':['--filter','@graphgoblin/web','exec','vitest','run','src/runs/RunInspectorPage.owner-chat.test.tsx','--retry=0','--reporter=verbose','--reporter=json','--outputFile='+join(OUT,'authored-owner-chat.json')],
 'typecheck':['--filter','@graphgoblin/web','typecheck'],
 'qa-lint':['--filter','@graphgoblin/web','exec','eslint','src/runs/owner-chat-recovery-witness.test.tsx','src/runs/owner-chat-recovery-budget.qa.test.tsx','src/app/owner-chat-request-generation.qa.test.tsx','e2e/owner-chat-cross-route.qa.spec.ts'],
 'build':['build','--filter=@graphgoblin/web...'],
 'browser-B1':['--filter','@graphgoblin/web','exec','playwright','test','e2e/owner-chat-cross-route.qa.spec.ts','--retries=0','--trace','on','--output',join(OUT,'output/playwright/B1'),'--reporter=list,json'],
 'browser-B2':['--filter','@graphgoblin/web','exec','playwright','test','e2e/claude-harness.spec.ts','--grep','Claude inference selection stays family-specific through publish and run','--retries=0','--trace','on','--output',join(OUT,'output/playwright/B2'),'--reporter=list,json'],
};
if(!Object.hasOwn(matrix,id))throw Error('Unknown finite invocation');const args=matrix[id],base=join(OUT,id);for(const suffix of ['.stdout.log','.stderr.log','.combined.log','.command.json'])if(existsSync(base+suffix))throw Error('New invocation namespace required');
const script=base+'.ps1';writeFileSync(script,"$ErrorActionPreference = 'Stop'\n$PSNativeCommandUseErrorActionPreference = $false\nSet-Location -LiteralPath "+safeQuote(QA)+"\n& pnpm.cmd "+args.map(safeQuote).join(' ')+"\nexit $LASTEXITCODE\n",{flag:'wx',encoding:'utf8'});
for(const suffix of ['.stdout.log','.stderr.log','.combined.log'])writeFileSync(base+suffix,'',{flag:'wx'});
const env={...process.env};for(const k of Object.keys(env))if(k.startsWith('ANTHROPIC_')||k.startsWith('OPENAI_')||k.startsWith('CLAUDE_')||k.startsWith('GIT_'))delete env[k];
const runtime='C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64',scratch=resolve('G:/ggq/gg-i5-d231-correction-qa-scratch');
env.PATH=runtime+';'+(process.env.PATH??process.env.Path??'');env.TEMP=scratch;env.TMP=scratch;env.GIT_OPTIONAL_LOCKS='0';env.GIT_NO_LAZY_FETCH='1';env.npm_config_offline='true';env.npm_config_verify_deps_before_run='false';env.npm_config_manage_package_manager_versions='false';env.PNPM_DISABLE_SELF_UPDATE_CHECK='1';env.TURBO_TELEMETRY_DISABLED='1';
if(id.startsWith('browser-')){env.GG_E2E_MAIN_PORT='0';env.GG_E2E_CONTROL_PORT='0';env.GG_E2E_WEB_DIST=join(QA,'apps/web/dist');env.GG_E2E_BROWSER_CHANNEL='msedge';env.PLAYWRIGHT_JSON_OUTPUT_NAME=base+'.json';}
const start=new Date().toISOString(),child=spawn('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',script],{cwd:QA,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
console.log(JSON.stringify({id,startedUtc:start,pid:child.pid,productHeavySlot:'root explicitly released',output:base+'.combined.log'}));
if(id.startsWith('browser-')){const observer=spawn('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',join(O,'observe-owned-browser.ps1'),'-TaskRootPid',String(child.pid),'-EvidenceBase',base],{cwd:QA,env,windowsHide:true,stdio:'ignore'});observer.on('error',e=>writeFileSync(base+'.observer-error.json',JSON.stringify({error:e.message})));}
child.stdout.on('data',b=>{appendFileSync(base+'.stdout.log',b);appendFileSync(base+'.combined.log',b);});child.stderr.on('data',b=>{appendFileSync(base+'.stderr.log',b);appendFileSync(base+'.combined.log',b);});
let failure=null;child.on('error',e=>{failure=e.message;});child.on('close',code=>{const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');const receipt={id,cwd:QA,argv:['pnpm.cmd',...args],startedUtc:start,finishedUtc:new Date().toISOString(),shellPid:child.pid,exitCode:code,spawnError:failure,stdout:{source:base+'.stdout.log',sha256:sha(base+'.stdout.log')},stderr:{source:base+'.stderr.log',sha256:sha(base+'.stderr.log')},combined:{source:base+'.combined.log',sha256:sha(base+'.combined.log')},retriesRequested:0,rootHeavySlotReleased:true,providerCalls:0};writeFileSync(base+'.command.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({id,exitCode:code,spawnError:failure,receipt:base+'.command.json'}));process.exitCode=failure?2:(code??1);});
