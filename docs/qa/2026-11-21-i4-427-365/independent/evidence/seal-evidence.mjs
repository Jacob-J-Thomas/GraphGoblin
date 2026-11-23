import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const outcomes=[
 {check:'offline-frozen-install',exit:0,log:'install.log'},
 {check:'native-source-attempt-1',exit:1,log:'native-source-attempt-1.log',accepted:false,reason:'fixture package path resolution before provider requests'},
 {check:'native-source-attempt-2',exit:0,log:'native-source-attempt-2.log',accepted:true,cases:2},
 ...[1,2,3,4,5,6].map(n=>({check:'public-native-attempt-'+n,exit:1,log:'public-native-attempt-'+n+'.log',accepted:false,reason:'retained fixture assertions/protocol assumptions; see REPORT.md'})),
 {check:'public-native-attempt-7',exit:0,log:'public-native-attempt-7.log',accepted:true,cases:6},
 {check:'SDK-sandbox-argv',exit:0,log:'sandbox-argv.log',accepted:true,cases:2,tier:'actual SDK, controlled argv recorder'},
 {check:'original-source-binding',exit:0,log:'source-binding.log'},
 {check:'final-source-and-browser-binding',exit:0,log:'final-binding.log',candidate:'8980c27c75e04d33cdcf48736c71db05e35175a3',browserSnapshots:4},
 {check:'optional-browser-eval',accepted:false,log:'output/playwright/historical-observation.log',reason:'Windows CLI quote handling; no acceptance claim'},
 {check:'fixture-cleanup',accepted:true,log:'cleanup-verification.json'},
];
await writeFile(join(root,'command-outcomes.json'),JSON.stringify({node:process.version,outcomes},null,2));
const cleanup=JSON.parse(await readFile(join(root,'cleanup-verification.json'),'utf8'));
assert.equal(cleanup.ownedNodeCodexProcesses.length,0);assert.equal(cleanup.ownedListeners.length,0);
const files=[];
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const p=join(dir,entry.name);if(entry.isDirectory())await walk(p);else if(entry.isFile()&&!['SHA256SUMS.json','seal.log'].includes(entry.name)){const bytes=await readFile(p);files.push({path:relative(root,p).replaceAll('\\','/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})}}}
await walk(root);files.sort((a,b)=>a.path.localeCompare(b.path));
const report=files.find(f=>f.path==='REPORT.md');assert(report);
await writeFile(join(root,'SHA256SUMS.json'),JSON.stringify({at:new Date().toISOString(),node:process.version,files},null,2));
console.log(JSON.stringify({reportSha256:report.sha256,files:files.length,totalBytes:files.reduce((n,f)=>n+f.bytes,0),candidate:'8980c27c75e04d33cdcf48736c71db05e35175a3',publicCases:6,argvCases:2,browserSnapshots:4,cleanup:'closed and verified'}));
