import {readFile,writeFile} from 'node:fs/promises';
const evidence=new URL('.',import.meta.url);
const log=await readFile(new URL('edge-full.log.txt',evidence),'utf8');
const tests=[];
for(const line of log.split(/\r?\n/)){
 const match=/^\s+(ok|x|-)\s+(\d+)\s+\[([^\]]+)\]\s+›\s+(.+?\.spec\.ts):(\d+):(\d+)\s+›\s+(.+?)(?:\s+\(([\d.]+)(ms|s|m|h)\))?$/.exec(line);
 if(!match)continue;
 const [,status,ordinal,project,file,lineNumber,column,title,duration,unit]=match;
 tests.push({ordinal:Number(ordinal),project,file:file.replaceAll('\\','/'),line:Number(lineNumber),column:Number(column),title,expected: file.endsWith('live.spec.ts')?'skipped: LIVE=0':'passed',actual:status==='ok'?'passed':status==='x'?'failed':'skipped',durationMs:duration?Number(duration)*({ms:1,s:1000,m:60000,h:3600000}[unit]):null});
}
const byFile={};
for(const t of tests){const f=byFile[t.file]??={passed:0,failed:0,skipped:0};f[t.actual]++;}
const result={source:'edge-full.log.txt',head:'3ffb23affa0148ce3eeccc7869f69b6da8dbaebb',total:tests.length,passed:tests.filter(t=>t.actual==='passed').length,failed:tests.filter(t=>t.actual==='failed').length,skipped:tests.filter(t=>t.actual==='skipped').length,byFile,tests};
await writeFile(new URL('edge-full-results.json',evidence),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({total:result.total,passed:result.passed,failed:result.failed,skipped:result.skipped,files:Object.keys(byFile).length}));
if(tests.length!==416)throw new Error('Result parser did not account for all 416 tests');
