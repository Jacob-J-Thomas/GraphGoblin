import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '../../../apps/web/node_modules/@playwright/test/index.mjs';
import { Client } from '../../../apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../../../apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import * as L from './lib.mjs';
const E = {}; let api,client,browser;
const tag=Date.now();const store='native-script-replay-'+tag;
const marker=path.join(L.ROOT,'native-replay-effects-'+tag+'.jsonl');
const release=path.join(L.ROOT,'native-replay-release-'+tag);
const count=()=>fs.existsSync(marker)?fs.readFileSync(marker,'utf8').trim().split('\n').length:0;
try {
  api=await L.startApi(store,6660);
  const source=await L.run(api,await L.publish(api,L.loop('Native uncertain Replay',[
    L.scriptNode(path.join(L.RECORD,'effect.mjs'),['hold',marker,release]),
  ])));
  await L.until(()=>count()===1);
  await api.kill(); fs.writeFileSync(release,'exit original');
  api=await L.startApi(store,6660);
  const failed=await L.state(api,source.id,['failed']);
  const before=await L.events(api,source.id);
  const refused=await api.call('POST',`/runs/${source.id}/replay`,{nodeId:'script',observedSeq:failed.recovery.observedSeq});
  L.check('native uncertain script Replay refuses without consent',failed.failure.code==='SCRIPT_OUTCOME_UNCERTAIN'&&count()===1&&refused.status===409&&refused.body.code==='SCRIPT_CONSENT_REQUIRED',refused);
  const transport=new StdioClientTransport({command:process.execPath,args:[path.join(L.REPO,'apps/mcp/dist/main.js'),'--api-url',api.base],
    env:Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('GG_'))),stderr:'pipe'});
  client=new Client({name:'pr422r-script-replay',version:'1'});await client.connect(transport);E.mcpPid=transport.pid;
  const args={runId:source.id,nodeId:'script',observedSeq:failed.recovery.observedSeq,retryUncertainScript:true};
  const replay=await client.callTool({name:'replay_run',arguments:args});
  E.replay=replay;
  const body=replay.structuredContent??JSON.parse(replay.content.find(c=>c.type==='text').text);
  const fork=await L.state(api,body.id,['succeeded']);
  const after=await L.events(api,source.id); const forkEvents=await L.events(api,fork.id);
  L.check('MCP script Replay repeats one real effect as a separate linked run',!replay.isError&&count()===2&&fork.id!==source.id&&fork.versionId===failed.versionId&&forkEvents[0].replayOf?.runId===source.id&&forkEvents[0].replayOf?.nodeId==='script',{replay,fork,count:count()});
  L.check('script Replay preserves uncertain source and exact execution history',JSON.stringify(before)===JSON.stringify(after)&&(await api.get('/runs/'+source.id)).failure?.code==='SCRIPT_OUTCOME_UNCERTAIN');
  const repeat=await client.callTool({name:'replay_run',arguments:args});
  L.check('repeated consented MCP script Replay identifies the one fork',repeat.isError&&JSON.stringify(repeat).includes('RECOVERY_STALE')&&JSON.stringify(repeat).includes(fork.id),repeat);
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto(api.base+'/app/runs/'+fork.id);
  await page.locator('[data-status="succeeded"]').waitFor();
  E.inspectorText=await page.locator('body').innerText();
  L.check('fork inspector displays source lineage',E.inspectorText.includes(source.id),E.inspectorText);
  await page.screenshot({path:path.join(L.RECORD,'native-script-replay.png')});
  E.source={failed,before,after};E.fork={fork,events:forkEvents};E.refused=refused;E.replay=replay;E.repeat=repeat;
} catch(error){E.error=error.stack;L.check('native script Replay driver completed',false,String(error.stack));}
finally{await browser?.close();await client?.close();await L.cleanup();L.save('script-replay-results.json',{checks:L.checks,evidence:E});}
process.exitCode=L.checks.some(c=>!c.passed)?1:0;
